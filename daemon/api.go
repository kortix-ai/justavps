// Internal API server on :7777 — health, services, info.
// Used by the platform heartbeat and for debugging.
// Also reachable via public :80 at /daemon/* (ProxyRouter strips prefix).

package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

type APIServer struct {
	cfg    *Config
	health *HealthChecker
	server *http.Server
}

func NewAPIServer(cfg *Config, health *HealthChecker, port int) *APIServer {
	mux := http.NewServeMux()

	s := &APIServer{
		cfg:    cfg,
		health: health,
		server: &http.Server{
			Addr:         fmt.Sprintf("127.0.0.1:%d", port),
			Handler:      mux,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 10 * time.Minute,
		},
	}

	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /services", s.handleServices)
	mux.HandleFunc("POST /services/{name}/restart", s.handleServiceRestart)
	mux.HandleFunc("GET /info", s.handleInfo)
	mux.HandleFunc("POST /exec", s.handleExec)

	return s
}

func (s *APIServer) Start() error {
	return s.server.ListenAndServe()
}

func (s *APIServer) Shutdown(ctx context.Context) {
	s.server.Shutdown(ctx)
}

// GET /health
func (s *APIServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	snap := s.health.Collect()
	writeJSON(w, 200, map[string]any{
		"status": "ok",
		"uptime": snap.Uptime,
		"load": map[string]float64{
			"cpu":    snap.CPU,
			"memory": snap.Memory,
			"disk":   snap.Disk,
		},
	})
}

// GET /services
func (s *APIServer) handleServices(w http.ResponseWriter, r *http.Request) {
	snap := s.health.Collect()

	type svcInfo struct {
		Name   string `json:"name"`
		Active bool   `json:"active"`
		Status string `json:"status"`
	}

	services := make([]svcInfo, 0, len(snap.Services))
	for name, active := range snap.Services {
		status := "inactive"
		if active {
			status = "running"
		}
		services = append(services, svcInfo{Name: name, Active: active, Status: status})
	}

	writeJSON(w, 200, map[string]any{"services": services})
}

// POST /services/{name}/restart
func (s *APIServer) handleServiceRestart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeJSON(w, 400, map[string]string{"error": "missing service name"})
		return
	}

	allowed := false
	for _, svc := range ManagedServices {
		if svc == name {
			allowed = true
			break
		}
	}
	if !allowed {
		writeJSON(w, 403, map[string]string{"error": fmt.Sprintf("service '%s' is not managed", name)})
		return
	}

	cmd := exec.Command("systemctl", "restart", fmt.Sprintf("%s.service", name))
	output, err := cmd.CombinedOutput()
	if err != nil {
		writeJSON(w, 500, map[string]string{
			"error":  fmt.Sprintf("restart failed: %v", err),
			"output": strings.TrimSpace(string(output)),
		})
		return
	}

	log.Printf("Restarted service: %s", name)
	writeJSON(w, 200, map[string]string{"status": "restarted", "service": name})
}

// GET /info
func (s *APIServer) handleInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"slug":           s.cfg.Slug,
		"ip":             getOutboundIP(),
		"daemon_version": version,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func getOutboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "unknown"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

// POST /exec — run a command on the host machine.
// Secured by HMAC-SHA256 signature over the request body using the machine token.
// The JustAVPS platform signs requests before proxying them here.
func (s *APIServer) handleExec(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 8192))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "failed to read body"})
		return
	}

	signature := r.Header.Get("X-Signature")
	if signature == "" {
		writeJSON(w, 401, map[string]string{"error": "missing signature"})
		return
	}

	if !verifyHMAC(body, signature, s.cfg.MachineToken) {
		writeJSON(w, 401, map[string]string{"error": "invalid signature"})
		return
	}

	var req struct {
		Command   string  `json:"command"`
		Timeout   int     `json:"timeout"`
		Timestamp float64 `json:"timestamp"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
		return
	}

	if req.Command == "" {
		writeJSON(w, 400, map[string]string{"error": "missing command"})
		return
	}

	nowMs := float64(time.Now().UnixMilli())
	if math.Abs(nowMs-req.Timestamp) > 30_000 {
		writeJSON(w, 401, map[string]string{"error": "request expired"})
		return
	}

	timeout := time.Duration(req.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	if timeout > 10*time.Minute {
		timeout = 10 * time.Minute
	}

	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	start := time.Now()
	cmd := exec.CommandContext(ctx, "bash", "-c", req.Command)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	durationMs := time.Since(start).Milliseconds()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	log.Printf("[EXEC] command=%q exit=%d duration=%dms", truncate(req.Command, 100), exitCode, durationMs)

	writeJSON(w, 200, map[string]any{
		"exit_code":   exitCode,
		"stdout":      stdout.String(),
		"stderr":      stderr.String(),
		"duration_ms": durationMs,
	})
}

func verifyHMAC(body []byte, signature string, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
