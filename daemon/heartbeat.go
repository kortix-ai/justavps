package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

const heartbeatInterval = 30 * time.Second

// Heartbeater sends periodic health reports to the JustAVPS platform.
type Heartbeater struct {
	cfg    *Config
	health *HealthChecker
	client *http.Client
}

type heartbeatPayload struct {
	Slug         string          `json:"slug"`
	MachineToken string          `json:"machine_token"`
	Uptime       int64           `json:"uptime"`
	Services     map[string]bool `json:"services"`
	Load         loadPayload     `json:"load"`
}

type loadPayload struct {
	CPU    float64 `json:"cpu"`
	Memory float64 `json:"memory"`
	Disk   float64 `json:"disk"`
}

func NewHeartbeater(cfg *Config, health *HealthChecker) *Heartbeater {
	return &Heartbeater{
		cfg:    cfg,
		health: health,
		client: &http.Client{Timeout: 10 * time.Second},
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

func (h *Heartbeater) send() {
	snap := h.health.Collect()

	payload := heartbeatPayload{
		Slug:         h.cfg.Slug,
		MachineToken: h.cfg.MachineToken,
		Uptime:       snap.Uptime,
		Services:     snap.Services,
		Load: loadPayload{
			CPU:    snap.CPU,
			Memory: snap.Memory,
			Disk:   snap.Disk,
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
