package main

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestScanListeningPorts(t *testing.T) {
	// Create a mock /proc/net/tcp file
	dir := t.TempDir()
	mockFile := filepath.Join(dir, "tcp")

	// Format: sl local_address rem_address st ...
	// State 0A = LISTEN
	// Port 1F90 = 8080, port 0CEA = 3306, port 0016 = 22 (should be skipped), port 0050 = 80 (should be skipped)
	content := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 00000000:0CEA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12346 1 0000000000000000 100 0 0 10 0
   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0
   3: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12348 1 0000000000000000 100 0 0 10 0
   4: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12349 1 0000000000000000 100 0 0 10 0
   5: 0100007F:1000 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 12350 1 0000000000000000 100 0 0 10 0
`
	// Port 0BB8 = 3000, state 0A = LISTEN → should be included
	// Port 1000 = 4096, state 01 = ESTABLISHED → should NOT be included
	// Port 0016 = 22 → system port, should be skipped
	// Port 0050 = 80 → system port, should be skipped

	if err := os.WriteFile(mockFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	ports, err := scanListeningPorts(mockFile)
	if err != nil {
		t.Fatal(err)
	}

	sort.Ints(ports)

	expected := []int{3000, 3306, 8080}
	if len(ports) != len(expected) {
		t.Fatalf("expected %d ports, got %d: %v", len(expected), len(ports), ports)
	}
	for i, p := range expected {
		if ports[i] != p {
			t.Errorf("ports[%d] = %d, expected %d", i, ports[i], p)
		}
	}
}

func TestScanListeningPortsEmpty(t *testing.T) {
	dir := t.TempDir()
	mockFile := filepath.Join(dir, "tcp")
	content := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
`
	os.WriteFile(mockFile, []byte(content), 0644)

	ports, err := scanListeningPorts(mockFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(ports) != 0 {
		t.Errorf("expected 0 ports, got %d: %v", len(ports), ports)
	}
}

func TestScanListeningPortsSkipsEphemeral(t *testing.T) {
	dir := t.TempDir()
	mockFile := filepath.Join(dir, "tcp")
	// Port C000 = 49152 (ephemeral, should be skipped)
	// Port C001 = 49153 (ephemeral, should be skipped)
	content := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:C000 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 00000000:C001 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 100 0 0 10 0
`
	os.WriteFile(mockFile, []byte(content), 0644)

	ports, err := scanListeningPorts(mockFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(ports) != 0 {
		t.Errorf("expected 0 ports (ephemeral skipped), got %d: %v", len(ports), ports)
	}
}

func TestPortWatcherGetListeningPorts(t *testing.T) {
	cfg := &Config{Slug: "test-slug", ProxyDomain: "kortix.cloud"}
	pw := NewPortWatcher(cfg)

	// No ports initially
	ports := pw.GetListeningPorts()
	if len(ports) != 0 {
		t.Errorf("expected 0 ports initially, got %d", len(ports))
	}
}

func TestConfigPortURL(t *testing.T) {
	cfg := &Config{Slug: "abc123", ProxyDomain: "kortix.cloud"}

	url := cfg.PortURL(3000)
	expected := "https://3000--abc123.kortix.cloud"
	if url != expected {
		t.Errorf("PortURL(3000) = %q, expected %q", url, expected)
	}

	tmpl := cfg.PortURLTemplate()
	expectedTmpl := "https://{{port}}--abc123.kortix.cloud"
	if tmpl != expectedTmpl {
		t.Errorf("PortURLTemplate() = %q, expected %q", tmpl, expectedTmpl)
	}
}

func TestConfigPortURLDefaultDomain(t *testing.T) {
	cfg := &Config{Slug: "xyz789"}

	url := cfg.PortURL(8080)
	expected := "https://8080--xyz789.kortix.cloud"
	if url != expected {
		t.Errorf("PortURL(8080) = %q, expected %q", url, expected)
	}
}

func TestTrimEventFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "events")

	// Write 200 lines
	var content string
	for i := 0; i < 200; i++ {
		content += "line\n"
	}
	os.WriteFile(path, []byte(content), 0644)

	trimEventFile(path, 50)

	data, _ := os.ReadFile(path)
	lines := len(splitNonEmpty(string(data)))
	if lines != 50 {
		t.Errorf("expected 50 lines after trim, got %d", lines)
	}
}

func splitNonEmpty(s string) []string {
	var result []string
	for _, line := range splitLines(s) {
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
