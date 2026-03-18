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

func TestLoadConfigIgnoresUnknownFields(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	// Old configs may still have proxy_domain / proxy_auth_secret — should not fail
	data := `{"slug":"test","callback_url":"http://localhost","machine_token":"mt_123","proxy_domain":"old.com","proxy_auth_secret":"old-secret"}`
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
}

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
	// proxy_domain no longer returned (removed — auth is at CF Worker edge)
	if _, exists := result["proxy_domain"]; exists {
		t.Error("proxy_domain should not be in info response (removed)")
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
