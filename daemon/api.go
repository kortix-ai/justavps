package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// APIServer exposes a local HTTP API on port 7777.
// Used by the platform and for local debugging.
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
			Addr:         fmt.Sprintf(":%d", port),
			Handler:      mux,
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 10 * time.Second,
		},
	}

	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /services", s.handleServices)
	mux.HandleFunc("POST /services/{name}/restart", s.handleServiceRestart)
	mux.HandleFunc("GET /info", s.handleInfo)

	return s
}

func (s *APIServer) Start() error {
	log.Printf("API server listening on %s", s.server.Addr)
	return s.server.ListenAndServe()
}

func (s *APIServer) Shutdown(ctx context.Context) {
	s.server.Shutdown(ctx)
}

// GET /health — Quick health check
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

// GET /services — List managed service statuses
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

// POST /services/{name}/restart — Restart a systemd service
func (s *APIServer) handleServiceRestart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeJSON(w, 400, map[string]string{"error": "missing service name"})
		return
	}

	// Only allow restarting managed services
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
	writeJSON(w, 200, map[string]string{
		"status":  "restarted",
		"service": name,
	})
}

// GET /info — Machine identity and network info
func (s *APIServer) handleInfo(w http.ResponseWriter, r *http.Request) {
	ip := getOutboundIP()

	writeJSON(w, 200, map[string]any{
		"slug":           s.cfg.Slug,
		"ip":             ip,
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
