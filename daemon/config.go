package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// Config is read from /etc/justavps/config.json (written by cloud-init).
type Config struct {
	Slug            string `json:"slug"`
	CallbackURL     string `json:"callback_url"`
	MachineToken    string `json:"machine_token"`
	ProxyDomain     string `json:"proxy_domain"`
	ProxyAuthSecret string `json:"proxy_auth_secret"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.Slug == "" {
		return nil, fmt.Errorf("config missing 'slug'")
	}
	if cfg.CallbackURL == "" {
		return nil, fmt.Errorf("config missing 'callback_url'")
	}
	if cfg.MachineToken == "" {
		return nil, fmt.Errorf("config missing 'machine_token'")
	}

	return &cfg, nil
}
