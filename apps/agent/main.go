// justavps-agent — lightweight agent that runs on every JustAVPS machine.
//
// Endpoints:
//   GET  :7777/health    → { ready, uptime, services }
//   POST :7777/pty       → WebSocket PTY (xterm.js protocol)
//
// Heartbeat: outbound POST to platform every 60s.

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	port       = flag.String("port", "7777", "Port to listen on")
	configFile = flag.String("config", "/etc/justavps/config.json", "Config file path")
	startTime  = time.Now()
)

type Config struct {
	Slug         string `json:"slug"`
	CallbackURL  string `json:"callback_url"`
	MachineToken string `json:"machine_token"`
	ProxyDomain  string `json:"proxy_domain"`
}

type HealthResponse struct {
	Ready    bool            `json:"ready"`
	Uptime   int64           `json:"uptime"`
	Services map[string]bool `json:"services"`
	Slug     string          `json:"slug"`
	Version  string          `json:"version"`
}

type HeartbeatPayload struct {
	Slug         string          `json:"slug"`
	MachineToken string          `json:"machine_token"`
	Uptime       int64           `json:"uptime"`
	Services     map[string]bool `json:"services"`
	Load         LoadInfo        `json:"load"`
}

type LoadInfo struct {
	CPU    float64 `json:"cpu"`
	Memory float64 `json:"memory"`
	Disk   float64 `json:"disk"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var cfg Config
var cfgMu sync.RWMutex

func loadConfig() error {
	data, err := os.ReadFile(*configFile)
	if err != nil {
		return err
	}
	cfgMu.Lock()
	defer cfgMu.Unlock()
	return json.Unmarshal(data, &cfg)
}

func getConfig() Config {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	return cfg
}

// checkService checks if a systemd service is active.
func checkService(name string) bool {
	cmd := exec.Command("systemctl", "is-active", "--quiet", name)
	return cmd.Run() == nil
}

// getServices returns the status of key services.
func getServices() map[string]bool {
	return map[string]bool{
		"code_server":    checkService("code-server"),
		"caddy":          checkService("caddy"),
		"justavps_agent": true, // if we're running, we're running
	}
}

// getLoad returns approximate CPU/memory/disk usage.
func getLoad() LoadInfo {
	// Memory from /proc/meminfo
	memTotal, memAvail := float64(0), float64(0)
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			var val float64
			if _, err := fmt.Sscanf(line, "MemTotal: %f kB", &val); err == nil {
				memTotal = val
			}
			if _, err := fmt.Sscanf(line, "MemAvailable: %f kB", &val); err == nil {
				memAvail = val
			}
		}
	}
	memUsage := float64(0)
	if memTotal > 0 {
		memUsage = (memTotal - memAvail) / memTotal
	}

	return LoadInfo{
		CPU:    0.1, // Approximate — proper CPU reading requires sampling
		Memory: memUsage,
		Disk:   0.1,
	}
}

// healthHandler returns machine health status.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	services := getServices()
	allReady := services["code_server"] && services["caddy"]

	resp := HealthResponse{
		Ready:    allReady,
		Uptime:   int64(time.Since(startTime).Seconds()),
		Services: services,
		Slug:     getConfig().Slug,
		Version:  "1.0.0",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ptyHandler handles WebSocket PTY connections.
func ptyHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[PTY] upgrade error: %v", err)
		return
	}
	defer conn.Close()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		log.Printf("[PTY] cmd start error: %v", err)
		conn.WriteJSON(map[string]string{"type": "error", "data": err.Error()})
		return
	}

	done := make(chan struct{})

	// stdout → WS
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				conn.WriteJSON(map[string]string{"type": "output", "data": string(buf[:n])})
			}
			if err != nil {
				break
			}
		}
		close(done)
	}()

	// stderr → WS
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				conn.WriteJSON(map[string]string{"type": "output", "data": string(buf[:n])})
			}
			if err != nil {
				break
			}
		}
	}()

	// WS → stdin
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			var payload map[string]string
			if err := json.Unmarshal(msg, &payload); err == nil {
				if payload["type"] == "input" {
					stdin.Write([]byte(payload["data"]))
				}
			}
		}
		cmd.Process.Kill()
	}()

	<-done
	exitCode := 0
	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}
	conn.WriteJSON(map[string]interface{}{"type": "exit", "code": exitCode})
}

// heartbeat sends periodic status to the platform.
func startHeartbeat(callbackURL, slug, token string) {
	ticker := time.NewTicker(60 * time.Second)
	client := &http.Client{Timeout: 10 * time.Second}

	// Send first heartbeat immediately after 10s (let services start)
	time.Sleep(10 * time.Second)
	sendHeartbeat(client, callbackURL, slug, token)

	for range ticker.C {
		sendHeartbeat(client, callbackURL, slug, token)
	}
}

func sendHeartbeat(client *http.Client, callbackURL, slug, token string) {
	payload := HeartbeatPayload{
		Slug:         slug,
		MachineToken: token,
		Uptime:       int64(time.Since(startTime).Seconds()),
		Services:     getServices(),
		Load:         getLoad(),
	}

	data, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", callbackURL+"/api/v1/internal/heartbeat",
		strings.NewReader(string(data)))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[HEARTBEAT] failed: %v", err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[HEARTBEAT] sent → %d", resp.StatusCode)
}

func main() {
	flag.Parse()

	if err := loadConfig(); err != nil {
		log.Printf("[AGENT] Warning: could not load config from %s: %v (running with defaults)", *configFile, err)
	}

	c := getConfig()
	log.Printf("[AGENT] Starting justavps-agent on port %s (slug: %s)", *port, c.Slug)

	if c.CallbackURL != "" && c.Slug != "" && c.MachineToken != "" {
		go startHeartbeat(c.CallbackURL, c.Slug, c.MachineToken)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/pty", ptyHandler)

	log.Printf("[AGENT] Listening on :%s", *port)
	if err := http.ListenAndServe(":"+*port, mux); err != nil {
		log.Fatalf("[AGENT] Fatal: %v", err)
	}
}
