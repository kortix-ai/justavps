package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Config is read from /etc/justavps/config.json (written by cloud-init).
type Config struct {
	Slug         string `json:"slug"`
	CallbackURL  string `json:"callback_url"`
	MachineToken string `json:"machine_token"`
	ProxyDomain  string `json:"proxy_domain"`      // e.g. "kortix.cloud" — used for port URL generation
	PortURLTmpl  string `json:"port_url_template"` // e.g. "http://{{port}}--uuid.localhost:4200/"
}

// PortURLTemplate returns the URL template for accessing a port on this machine.
// Example: https://{{port}}--xoydduba.kortix.cloud
func (c *Config) PortURLTemplate() string {
	if c.PortURLTmpl != "" {
		return c.PortURLTmpl
	}
	domain := c.ProxyDomain
	if domain == "" {
		domain = "kortix.cloud"
	}
	return "https://{{port}}--" + c.Slug + "." + domain
}

// PortURL returns the public URL for a specific port on this machine.
func (c *Config) PortURL(port int) string {
	tmpl := c.PortURLTemplate()
	url := strings.ReplaceAll(tmpl, "{{port}}", fmt.Sprintf("%d", port))
	url = strings.ReplaceAll(url, "{port}", fmt.Sprintf("%d", port))
	return url
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
