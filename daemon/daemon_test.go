package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// Write a temp config
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	data := `{"slug":"test","callback_url":"http://localhost","machine_token":"mt_123","proxy_domain":"test.com"}`
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
	data := `{"callback_url":"http://localhost","machine_token":"mt_123"}`
	os.WriteFile(cfgPath, []byte(data), 0644)

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

func TestAPIHealth(t *testing.T) {
	cfg := &Config{Slug: "test", CallbackURL: "http://localhost", MachineToken: "mt_123", ProxyDomain: "test.com"}
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
	cfg := &Config{Slug: "my-machine", CallbackURL: "http://localhost", MachineToken: "mt_123", ProxyDomain: "kortix.cloud"}
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
	if result["proxy_domain"] != "kortix.cloud" {
		t.Errorf("expected proxy_domain 'kortix.cloud', got '%v'", result["proxy_domain"])
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
	// Start a mock server to receive heartbeats
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

func TestAuthProxyNoToken(t *testing.T) {
	cfg := &Config{Slug: "test", CallbackURL: "http://localhost:4100", MachineToken: "mt_123", ProxyDomain: "kortix.cloud", ProxyAuthSecret: "test-secret"}
	handler := NewAuthProxy(cfg, cfg.ProxyAuthSecret, 9999) // port doesn't matter — won't reach it

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Errorf("expected 401 without token, got %d", w.Code)
	}
}

func TestAuthProxyBrowserRedirect(t *testing.T) {
	cfg := &Config{Slug: "test-slug", CallbackURL: "http://localhost:4100", MachineToken: "mt_123", ProxyDomain: "kortix.cloud", ProxyAuthSecret: "test-secret"}
	handler := NewAuthProxy(cfg, cfg.ProxyAuthSecret, 9999)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept", "text/html")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 302 {
		t.Errorf("expected 302 redirect for browser, got %d", w.Code)
	}
	loc := w.Header().Get("Location")
	if loc == "" {
		t.Error("expected Location header")
	}
	if !containsStr(loc, "/api/proxy-auth") {
		t.Errorf("expected redirect to proxy-auth, got %s", loc)
	}
}
