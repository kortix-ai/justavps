package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// ── Config tests ─────────────────────────────────────────────────────────

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	data := `{"slug":"test","callback_url":"http://localhost","machine_token":"mt_123"}`
	if err := os.WriteFile(cfgPath, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Slug != "test" {
		t.Errorf("expected slug 'test', got '%s'", cfg.Slug)
	}
	if cfg.CallbackURL != "http://localhost" {
		t.Errorf("expected callback_url 'http://localhost', got '%s'", cfg.CallbackURL)
	}
	if cfg.MachineToken != "mt_123" {
		t.Errorf("expected machine_token 'mt_123', got '%s'", cfg.MachineToken)
	}
}

func TestLoadConfigMissingSlug(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	os.WriteFile(cfgPath, []byte(`{"callback_url":"http://localhost","machine_token":"mt_123"}`), 0644)
	_, err := LoadConfig(cfgPath)
	if err == nil {
		t.Error("expected error for missing slug")
	}
}

func TestLoadConfigMissingFile(t *testing.T) {
	_, err := LoadConfig("/nonexistent/config.json")
	if err == nil {
		t.Error("expected error for missing file")
	}
}

func TestLoadConfigIgnoresUnknownFields(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	data := `{"slug":"test","callback_url":"http://localhost","machine_token":"mt_123","proxy_domain":"old.com"}`
	os.WriteFile(cfgPath, []byte(data), 0644)

	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Slug != "test" {
		t.Errorf("expected slug 'test', got '%s'", cfg.Slug)
	}
}

// ── API tests ────────────────────────────────────────────────────────────

func TestAPIHealth(t *testing.T) {
	cfg := &Config{Slug: "test", CallbackURL: "http://localhost", MachineToken: "mt_123"}
	health := NewHealthChecker()
	api := NewAPIServer(cfg, health, 0)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	api.server.Handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var result map[string]any
	json.NewDecoder(w.Body).Decode(&result)
	if result["status"] != "ok" {
		t.Errorf("expected status 'ok', got '%v'", result["status"])
	}
}

func TestAPIInfo(t *testing.T) {
	cfg := &Config{Slug: "my-machine", CallbackURL: "http://localhost", MachineToken: "mt_123"}
	health := NewHealthChecker()
	api := NewAPIServer(cfg, health, 0)

	req := httptest.NewRequest("GET", "/info", nil)
	w := httptest.NewRecorder()
	api.server.Handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var result map[string]any
	json.NewDecoder(w.Body).Decode(&result)
	if result["slug"] != "my-machine" {
		t.Errorf("expected slug 'my-machine', got '%v'", result["slug"])
	}
	if _, exists := result["proxy_domain"]; exists {
		t.Error("proxy_domain should not be in info response")
	}
}

func TestAPIServices(t *testing.T) {
	cfg := &Config{Slug: "test", CallbackURL: "http://localhost", MachineToken: "mt_123"}
	health := NewHealthChecker()
	api := NewAPIServer(cfg, health, 0)

	req := httptest.NewRequest("GET", "/services", nil)
	w := httptest.NewRecorder()
	api.server.Handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var result map[string]any
	json.NewDecoder(w.Body).Decode(&result)
	services, ok := result["services"].([]any)
	if !ok {
		t.Fatal("expected services array")
	}
	if len(services) == 0 {
		t.Error("expected at least one service")
	}
}

func TestAPIServiceRestartForbidden(t *testing.T) {
	cfg := &Config{Slug: "test", CallbackURL: "http://localhost", MachineToken: "mt_123"}
	health := NewHealthChecker()
	api := NewAPIServer(cfg, health, 0)

	req := httptest.NewRequest("POST", "/services/sshd/restart", nil)
	w := httptest.NewRecorder()
	api.server.Handler.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Errorf("expected 403 for non-managed service, got %d", w.Code)
	}
}

func TestHeartbeatPayload(t *testing.T) {
	received := make(chan heartbeatPayload, 1)
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p heartbeatPayload
		json.NewDecoder(r.Body).Decode(&p)
		received <- p
		w.WriteHeader(200)
	}))
	defer mock.Close()

	cfg := &Config{Slug: "hb-test", CallbackURL: mock.URL, MachineToken: "mt_hb"}
	health := NewHealthChecker()
	hb := NewHeartbeater(cfg, health)
	hb.send()

	p := <-received
	if p.Slug != "hb-test" {
		t.Errorf("expected slug 'hb-test', got '%s'", p.Slug)
	}
	if p.MachineToken != "mt_hb" {
		t.Errorf("expected token 'mt_hb', got '%s'", p.MachineToken)
	}
}

// ── ProxyRouter tests ────────────────────────────────────────────────────

func TestProxyRouterPTY(t *testing.T) {
	router := NewProxyRouter()
	// /_pty without WebSocket upgrade should get 400 from gorilla/websocket
	req := httptest.NewRequest("GET", "/_pty", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Errorf("expected 400 for non-WS /_pty request, got %d", w.Code)
	}
}

func TestProxyRouterPortProxy(t *testing.T) {
	router := NewProxyRouter()
	// /_port/59999/test — port not listening, expect 502 (bad gateway)
	req := httptest.NewRequest("GET", "/_port/59999/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	// Port proxy returns 502 when target unreachable
	if w.Code != 502 {
		t.Errorf("expected 502 for unreachable port, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestProxyRouterLegacyCaddyPort(t *testing.T) {
	router := NewProxyRouter()
	// /_caddy_port/59999/test — legacy path, should also work
	req := httptest.NewRequest("GET", "/_caddy_port/59999/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 502 {
		t.Errorf("expected 502 for unreachable port via legacy path, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestProxyRouterPortProxyInvalid(t *testing.T) {
	router := NewProxyRouter()
	// /_port/abc — invalid port number
	req := httptest.NewRequest("GET", "/_port/abc/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Errorf("expected 400 for invalid port, got %d", w.Code)
	}
}

func TestProxyRouterAgent(t *testing.T) {
	router := NewProxyRouter()
	// /agent/health — sandbox agent not running, expect 502
	req := httptest.NewRequest("GET", "/agent/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 502 {
		t.Errorf("expected 502 for unreachable agent, got %d", w.Code)
	}
}

func TestProxyRouterDefault(t *testing.T) {
	router := NewProxyRouter()
	// / — OpenCode not running, expect 502
	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 502 {
		t.Errorf("expected 502 for unreachable opencode, got %d", w.Code)
	}
}

func TestManagedServicesMinimal(t *testing.T) {
	if len(ManagedServices) != 1 || ManagedServices[0] != "docker" {
		t.Errorf("ManagedServices should only contain 'docker', got %v", ManagedServices)
	}
}
