package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HealthChecker struct {
	mu       sync.RWMutex
	bootTime time.Time
	cached   *HealthSnapshot
	cachedAt time.Time

	// Network rate tracking
	prevNetBytes   map[string][2]uint64 // iface -> [rx, tx]
	prevNetTime    time.Time
	lastNetRateIn  float64
	lastNetRateOut float64
}

type HealthSnapshot struct {
	CPU      float64         `json:"cpu"`
	Memory   float64         `json:"memory"`
	Disk     float64         `json:"disk"`
	Uptime   int64           `json:"uptime"`
	Services map[string]bool `json:"services"`
	Network  NetworkStats    `json:"network"`
	Security SecurityStatus  `json:"security"`
}

// NetworkStats — network I/O and connection counters.
type NetworkStats struct {
	BytesIn     uint64  `json:"bytes_in"`      // total bytes received (cumulative)
	BytesOut    uint64  `json:"bytes_out"`     // total bytes sent (cumulative)
	RateIn      float64 `json:"rate_in"`       // bytes/sec inbound (since last check)
	RateOut     float64 `json:"rate_out"`      // bytes/sec outbound (since last check)
	Connections int     `json:"connections"`   // current established TCP connections
}

// SecurityStatus — integrity checks for security services.
// If any of these go false after initial setup, it means tampering.
type SecurityStatus struct {
	UFWActive      bool `json:"ufw_active"`
	Fail2banActive bool `json:"fail2ban_active"`
	SSHKeyOnly     bool `json:"ssh_key_only"` // PasswordAuthentication no
}

// ManagedServices — systemd services we monitor and allow restart of.
var ManagedServices = []string{
	"docker",
}

func NewHealthChecker() *HealthChecker {
	return &HealthChecker{
		bootTime:     time.Now(),
		prevNetBytes: make(map[string][2]uint64),
		prevNetTime:  time.Now(),
	}
}

// Collect gathers system health. Cached for 5 seconds.
func (h *HealthChecker) Collect() *HealthSnapshot {
	h.mu.RLock()
	if h.cached != nil && time.Since(h.cachedAt) < 5*time.Second {
		snap := *h.cached
		h.mu.RUnlock()
		return &snap
	}
	h.mu.RUnlock()

	netStats := h.collectNetworkStats()

	snap := &HealthSnapshot{
		CPU:      getCPUUsage(),
		Memory:   getMemoryUsage(),
		Disk:     getDiskUsage(),
		Uptime:   int64(time.Since(h.bootTime).Seconds()),
		Services: getServiceStatuses(),
		Network:  netStats,
		Security: collectSecurityStatus(),
	}

	h.mu.Lock()
	h.cached = snap
	h.cachedAt = time.Now()
	h.mu.Unlock()

	return snap
}

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

// ─── Network stats from /proc/net/dev ────────────────────────────────────

func (h *HealthChecker) collectNetworkStats() NetworkStats {
	stats := NetworkStats{
		Connections: countEstablishedTCP(),
	}

	// Read /proc/net/dev for byte counters
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return stats
	}
	defer f.Close()

	now := time.Now()
	currentBytes := make(map[string][2]uint64)
	var totalRx, totalTx uint64

	scanner := bufio.NewScanner(f)
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		if lineNum <= 2 {
			continue // skip header lines
		}
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		if iface == "lo" {
			continue // skip loopback
		}

		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		totalRx += rx
		totalTx += tx
		currentBytes[iface] = [2]uint64{rx, tx}
	}

	stats.BytesIn = totalRx
	stats.BytesOut = totalTx

	// Calculate rates from previous sample
	h.mu.RLock()
	elapsed := now.Sub(h.prevNetTime).Seconds()
	prevBytes := h.prevNetBytes
	h.mu.RUnlock()

	if elapsed > 0 && len(prevBytes) > 0 {
		var prevTotalRx, prevTotalTx uint64
		for _, v := range prevBytes {
			prevTotalRx += v[0]
			prevTotalTx += v[1]
		}
		if totalRx >= prevTotalRx {
			stats.RateIn = float64(totalRx-prevTotalRx) / elapsed
		}
		if totalTx >= prevTotalTx {
			stats.RateOut = float64(totalTx-prevTotalTx) / elapsed
		}
	}

	// Store current sample for next rate calculation
	h.mu.Lock()
	h.prevNetBytes = currentBytes
	h.prevNetTime = now
	h.lastNetRateIn = stats.RateIn
	h.lastNetRateOut = stats.RateOut
	h.mu.Unlock()

	return stats
}

// countEstablishedTCP counts ESTABLISHED TCP connections from /proc/net/tcp.
// State 01 = ESTABLISHED in hex.
func countEstablishedTCP() int {
	count := 0
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		first := true
		for scanner.Scan() {
			if first {
				first = false
				continue // skip header
			}
			fields := strings.Fields(scanner.Text())
			if len(fields) >= 4 && fields[3] == "01" {
				count++
			}
		}
		f.Close()
	}
	return count
}

// ─── Security integrity checks ──────────────────────────────────────────

func collectSecurityStatus() SecurityStatus {
	return SecurityStatus{
		UFWActive:      isUFWActive(),
		Fail2banActive: isServiceActive("fail2ban"),
		SSHKeyOnly:     isSSHKeyOnly(),
	}
}

// isUFWActive checks if UFW is active via `ufw status`.
func isUFWActive() bool {
	out, err := exec.Command("ufw", "status").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "Status: active")
}

// isSSHKeyOnly checks that PasswordAuthentication is disabled in sshd_config.
func isSSHKeyOnly() bool {
	data, err := os.ReadFile("/etc/ssh/sshd_config")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "PasswordAuthentication") {
			fields := strings.Fields(trimmed)
			if len(fields) >= 2 && strings.ToLower(fields[1]) == "no" {
				return true
			}
			return false
		}
	}
	// If not explicitly set, OpenSSH defaults to yes — not secure
	return false
}
