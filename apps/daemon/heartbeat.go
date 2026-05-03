package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

const heartbeatInterval = 30 * time.Second

// Heartbeater sends periodic health reports to the JustAVPS platform.
type Heartbeater struct {
	cfg     *Config
	health  *HealthChecker
	updater *Updater
	client  *http.Client
}

type heartbeatPayload struct {
	Slug          string          `json:"slug"`
	MachineToken  string          `json:"machine_token"`
	DaemonVersion string          `json:"daemon_version"`
	Uptime        int64           `json:"uptime"`
	Services      map[string]bool `json:"services"`
	Load          loadPayload     `json:"load"`
	Network       networkPayload  `json:"network"`
	Security      securityPayload `json:"security"`
}

type loadPayload struct {
	CPU    float64 `json:"cpu"`
	Memory float64 `json:"memory"`
	Disk   float64 `json:"disk"`
}

type networkPayload struct {
	BytesIn     uint64  `json:"bytes_in"`
	BytesOut    uint64  `json:"bytes_out"`
	RateIn      float64 `json:"rate_in"`
	RateOut     float64 `json:"rate_out"`
	Connections int     `json:"connections"`
}

type securityPayload struct {
	UFWActive      bool `json:"ufw_active"`
	Fail2banActive bool `json:"fail2ban_active"`
	SSHKeyOnly     bool `json:"ssh_key_only"`
}

// heartbeatResponse is the platform's response to a heartbeat.
type heartbeatResponse struct {
	Ack    bool               `json:"ack"`
	Update *UpdateInstruction `json:"update,omitempty"`
}

func NewHeartbeater(cfg *Config, health *HealthChecker, updater *Updater) *Heartbeater {
	return &Heartbeater{
		cfg:     cfg,
		health:  health,
		updater: updater,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

// Run sends heartbeats every 30 seconds until ctx is cancelled.
func (h *Heartbeater) Run(ctx context.Context) {
	// Send first heartbeat immediately
	h.send()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.send()
		}
	}
}

// RunTelemetry sends OTEL-shaped sandbox metrics to the V2 telemetry API.
func (h *Heartbeater) RunTelemetry(ctx context.Context) {
	if strings.TrimSpace(h.cfg.TelemetryURL) == "" {
		return
	}

	h.sendTelemetryLog("info", "daemon", "justavps-daemon telemetry online")
	h.sendTelemetry()

	interval := time.Duration(h.cfg.TelemetryIntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.sendTelemetry()
		}
	}
}

func (h *Heartbeater) send() {
	snap := h.health.Collect()

	payload := heartbeatPayload{
		Slug:          h.cfg.Slug,
		MachineToken:  h.cfg.MachineToken,
		DaemonVersion: version,
		Uptime:        snap.Uptime,
		Services:      snap.Services,
		Load: loadPayload{
			CPU:    snap.CPU,
			Memory: snap.Memory,
			Disk:   snap.Disk,
		},
		Network: networkPayload{
			BytesIn:     snap.Network.BytesIn,
			BytesOut:    snap.Network.BytesOut,
			RateIn:      snap.Network.RateIn,
			RateOut:     snap.Network.RateOut,
			Connections: snap.Network.Connections,
		},
		Security: securityPayload{
			UFWActive:      snap.Security.UFWActive,
			Fail2banActive: snap.Security.Fail2banActive,
			SSHKeyOnly:     snap.Security.SSHKeyOnly,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Heartbeat marshal error: %v", err)
		return
	}

	url := fmt.Sprintf("%s/api/v1/internal/heartbeat", h.cfg.CallbackURL)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		log.Printf("Heartbeat request error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		log.Printf("Heartbeat failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("Heartbeat rejected: %d", resp.StatusCode)
		return
	}

	// Parse response for update instructions
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}

	var hbResp heartbeatResponse
	if err := json.Unmarshal(respBody, &hbResp); err != nil {
		return
	}

	if hbResp.Update != nil {
		h.updater.MaybeUpdate(*hbResp.Update)
	}
}

func (h *Heartbeater) telemetryEndpoint(suffix string) string {
	return strings.TrimRight(h.cfg.TelemetryURL, "/") + suffix
}

func (h *Heartbeater) sendTelemetryRequest(path string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal telemetry: %w", err)
	}
	req, err := http.NewRequest("POST", h.telemetryEndpoint(path), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create telemetry request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if h.cfg.TelemetryToken != "" {
		req.Header.Set("X-JustAVPS-Telemetry-Token", h.cfg.TelemetryToken)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("send telemetry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("telemetry rejected: %d", resp.StatusCode)
	}
	return nil
}

func (h *Heartbeater) sendTelemetry() {
	snap := h.health.Collect()
	payload := map[string]any{
		"machine_id":     h.cfg.MachineID,
		"machine_token":  h.cfg.MachineToken,
		"daemon_version": version,
		"source":         "daemon",
		"uptime":         snap.Uptime,
		"services":       snap.Services,
		"load": map[string]float64{
			"cpu":    snap.CPU,
			"memory": snap.Memory,
			"disk":   snap.Disk,
		},
		"network": map[string]any{
			"bytes_in":    snap.Network.BytesIn,
			"bytes_out":   snap.Network.BytesOut,
			"rate_in":     snap.Network.RateIn,
			"rate_out":    snap.Network.RateOut,
			"connections": snap.Network.Connections,
		},
		"security": snap.Security,
		"resource_attributes": map[string]string{
			"service.name":            "justavps-daemon",
			"justavps.machine.id":     h.cfg.MachineID,
			"justavps.daemon.version": version,
		},
	}
	if err := h.sendTelemetryRequest("/metrics", payload); err != nil {
		log.Printf("Telemetry metrics failed: %v", err)
	}
}

func (h *Heartbeater) sendTelemetryLog(level, source, message string) {
	if strings.TrimSpace(h.cfg.TelemetryURL) == "" {
		return
	}
	payload := map[string]any{
		"machine_id":    h.cfg.MachineID,
		"machine_token": h.cfg.MachineToken,
		"source":        source,
		"logs": []map[string]any{{
			"severity": level,
			"source":   source,
			"stream":   "daemon",
			"body":     message,
		}},
		"resource_attributes": map[string]string{
			"service.name":            "justavps-daemon",
			"justavps.machine.id":     h.cfg.MachineID,
			"justavps.daemon.version": version,
		},
	}
	if err := h.sendTelemetryRequest("/logs", payload); err != nil {
		log.Printf("Telemetry log failed: %v", err)
	}
}

// ReportStage sends a provisioning stage update to the platform.
func (h *Heartbeater) ReportStage(stage, message string) error {
	payload := map[string]string{
		"slug":          h.cfg.Slug,
		"machine_token": h.cfg.MachineToken,
		"stage":         stage,
		"message":       message,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal stage: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/internal/stage", h.cfg.CallbackURL)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create stage request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("send stage: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("stage rejected: %d", resp.StatusCode)
	}

	log.Printf("Stage reported: %s — %s", stage, message)
	return nil
}
