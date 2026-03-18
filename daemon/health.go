package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HealthChecker collects system metrics and service statuses.
type HealthChecker struct {
	mu       sync.RWMutex
	bootTime time.Time
	cached   *HealthSnapshot
	cachedAt time.Time
}

// HealthSnapshot is a point-in-time health reading.
type HealthSnapshot struct {
	CPU      float64         `json:"cpu"`
	Memory   float64         `json:"memory"`
	Disk     float64         `json:"disk"`
	Uptime   int64           `json:"uptime"`
	Services map[string]bool `json:"services"`
}

// ManagedServices are the systemd services we monitor.
var ManagedServices = []string{
	"caddy",
	"docker",
	"opencode-web",
	"sandbox-agent",
	"justavps-docker",
}

func NewHealthChecker() *HealthChecker {
	return &HealthChecker{
		bootTime: time.Now(),
	}
}

// Collect gathers current system health. Caches for 5 seconds.
func (h *HealthChecker) Collect() *HealthSnapshot {
	h.mu.RLock()
	if h.cached != nil && time.Since(h.cachedAt) < 5*time.Second {
		snap := *h.cached
		h.mu.RUnlock()
		return &snap
	}
	h.mu.RUnlock()

	snap := &HealthSnapshot{
		CPU:      getCPUUsage(),
		Memory:   getMemoryUsage(),
		Disk:     getDiskUsage(),
		Uptime:   int64(time.Since(h.bootTime).Seconds()),
		Services: getServiceStatuses(),
	}

	h.mu.Lock()
	h.cached = snap
	h.cachedAt = time.Now()
	h.mu.Unlock()

	return snap
}

// getCPUUsage returns CPU usage as 0.0-1.0 via /proc/loadavg.
func getCPUUsage() float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0
	}
	load, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	cpus := float64(runtime.NumCPU())
	if cpus == 0 {
		cpus = 1
	}
	usage := load / cpus
	if usage > 1 {
		usage = 1
	}
	return usage
}

// getMemoryUsage returns memory usage as 0.0-1.0 via /proc/meminfo.
func getMemoryUsage() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	var total, available uint64
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			total = parseMemInfoValue(line)
		} else if strings.HasPrefix(line, "MemAvailable:") {
			available = parseMemInfoValue(line)
		}
	}
	if total == 0 {
		return 0
	}
	return float64(total-available) / float64(total)
}

func parseMemInfoValue(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	val, _ := strconv.ParseUint(fields[1], 10, 64)
	return val
}

// getDiskUsage returns root partition usage as 0.0-1.0.
func getDiskUsage() float64 {
	out, err := exec.Command("df", "--output=pcent", "/").Output()
	if err != nil {
		return 0
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 2 {
		return 0
	}
	pct := strings.TrimSpace(lines[1])
	pct = strings.TrimSuffix(pct, "%")
	val, err := strconv.ParseFloat(pct, 64)
	if err != nil {
		return 0
	}
	return val / 100
}

// getServiceStatuses checks systemd services.
func getServiceStatuses() map[string]bool {
	statuses := make(map[string]bool, len(ManagedServices))
	for _, svc := range ManagedServices {
		statuses[svc] = isServiceActive(svc)
	}
	return statuses
}

func isServiceActive(name string) bool {
	cmd := exec.Command("systemctl", "is-active", "--quiet", fmt.Sprintf("%s.service", name))
	return cmd.Run() == nil
}
