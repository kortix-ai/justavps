// Port watcher — detects new listening ports and notifies users.
//
// Polls /proc/net/tcp every 2 seconds for new listening sockets.
// When a new port appears:
//   1. Writes a notification to /run/justavps/port-events (FIFO pipe)
//   2. Logs the public URL for the port
//
// The shell profile script (/etc/profile.d/justavps-ports.sh) reads
// from the event pipe to display real-time notifications in active terminals.
//
// Skips system ports (sshd on 22, daemon on 80/7777) and ephemeral ports (>49151).

package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"strings"
	"sync"
	"time"
)

// PortWatcher monitors for new listening ports and publishes events.
type PortWatcher struct {
	cfg          *Config
	knownPorts   map[int]bool
	mu           sync.Mutex
	eventDir     string
	pollInterval time.Duration
}

// PortEvent represents a detected port change.
type PortEvent struct {
	Port   int
	Action string // "open" or "close"
	URL    string
	Time   time.Time
}

// System ports that should never trigger notifications.
var systemPorts = map[int]bool{
	22:   true, // SSH
	80:   true, // Daemon public
	7777: true, // Daemon internal API
	2468: true, // Sandbox agent
}

func NewPortWatcher(cfg *Config) *PortWatcher {
	return &PortWatcher{
		cfg:          cfg,
		knownPorts:   make(map[int]bool),
		eventDir:     "/run/justavps",
		pollInterval: 2 * time.Second,
	}
}

// Run starts the port watcher loop. Blocks until context is cancelled.
func (pw *PortWatcher) Run(ctx context.Context) {
	// Ensure event directory exists
	os.MkdirAll(pw.eventDir, 0755)

	// Seed known ports on startup (don't notify for already-open ports)
	if ports, err := pw.scanPorts(); err == nil {
		pw.mu.Lock()
		for _, p := range ports {
			pw.knownPorts[p] = true
		}
		pw.mu.Unlock()
		log.Printf("[ports] Initial scan: %d listening ports", len(ports))
	}

	ticker := time.NewTicker(pw.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pw.poll()
		}
	}
}

func (pw *PortWatcher) poll() {
	ports, err := pw.scanPorts()
	if err != nil {
		return
	}

	currentPorts := make(map[int]bool, len(ports))
	for _, p := range ports {
		currentPorts[p] = true
	}

	pw.mu.Lock()
	defer pw.mu.Unlock()

	// Detect new ports
	for _, p := range ports {
		if !pw.knownPorts[p] {
			event := PortEvent{
				Port:   p,
				Action: "open",
				URL:    pw.cfg.PortURL(p),
				Time:   time.Now(),
			}
			pw.notify(event)
		}
	}

	// Detect closed ports
	for p := range pw.knownPorts {
		if !currentPorts[p] {
			event := PortEvent{
				Port:   p,
				Action: "close",
				URL:    pw.cfg.PortURL(p),
				Time:   time.Now(),
			}
			pw.notify(event)
		}
	}

	pw.knownPorts = currentPorts
}

func (pw *PortWatcher) notify(event PortEvent) {
	if event.Action == "open" {
		log.Printf("[ports] New port %d → %s", event.Port, event.URL)
	} else {
		log.Printf("[ports] Port %d closed", event.Port)
	}

	// Write event to file for shell integration to read
	eventFile := filepath.Join(pw.eventDir, "port-events")
	line := fmt.Sprintf("%s %s %d %s\n", event.Time.Format(time.RFC3339), event.Action, event.Port, event.URL)

	f, err := os.OpenFile(eventFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(line)

	// Trim file if too large (keep last 100 events)
	trimEventFile(eventFile, 100)
}

// scanPorts reads /proc/net/tcp and returns listening port numbers.
func (pw *PortWatcher) scanPorts() ([]int, error) {
	return scanListeningPorts("/proc/net/tcp")
}

// scanListeningPorts parses a /proc/net/tcp format file and returns listening ports.
// Exported for testing.
func scanListeningPorts(path string) ([]int, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var ports []int
	scanner := bufio.NewScanner(f)
	scanner.Scan() // skip header line

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		// Column 3 (index 3) is the state: 0A = LISTEN
		state := fields[3]
		if state != "0A" {
			continue
		}

		// Column 1 (index 1) is local_address in hex: IP:PORT
		localAddr := fields[1]
		parts := strings.Split(localAddr, ":")
		if len(parts) != 2 {
			continue
		}

		portHex := parts[1]
		portBytes, err := hex.DecodeString(portHex)
		if err != nil || len(portBytes) != 2 {
			continue
		}
		port := int(portBytes[0])<<8 | int(portBytes[1])

		// Skip system ports and ephemeral range
		if systemPorts[port] || port > 49151 || port == 0 {
			continue
		}

		ports = append(ports, port)
	}

	return ports, nil
}

func trimEventFile(path string, maxLines int) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) <= maxLines {
		return
	}
	trimmed := strings.Join(lines[len(lines)-maxLines:], "\n") + "\n"
	os.WriteFile(path, []byte(trimmed), 0644)
}

// GetListeningPorts returns currently known listening ports (thread-safe).
func (pw *PortWatcher) GetListeningPorts() []int {
	pw.mu.Lock()
	defer pw.mu.Unlock()
	ports := make([]int, 0, len(pw.knownPorts))
	for p := range pw.knownPorts {
		ports = append(ports, p)
	}
	return ports
}
