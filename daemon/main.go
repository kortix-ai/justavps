// justavps-daemon — The ONLY process on a JustAVPS machine.
//
// Single binary that handles everything:
//   - Public HTTP on :80     (reverse proxy, PTY, port forwarding)
//   - Internal API on :7777  (health, services, info — platform only)
//   - Health monitoring      (CPU, memory, disk, systemd services)
//   - Heartbeat              (POST to platform every 30s)
//
// Replaces Caddy entirely. Zero external dependencies.
//
// Routing on :80:
//   /_pty              → WebSocket PTY (dashboard terminal)
//   /_port/PORT/path   → reverse proxy to localhost:PORT/path
//   /agent/*           → reverse proxy to localhost:2468 (sandbox-agent)
//   /daemon/*          → reverse proxy to localhost:7777 (internal API)
//   /*                 → reverse proxy to localhost:3456 (OpenCode IDE)
//
// Usage:
//   justavps-daemon --config /etc/justavps/config.json

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var (
	version   = "dev"
	buildTime = "unknown"
)

func main() {
	configPath := flag.String("config", "/etc/justavps/config.json", "Path to config file")
	publicPort := flag.Int("port", 80, "Public HTTP port")
	apiPort := flag.Int("api-port", 7777, "Internal API port")
	showVersion := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("justavps-daemon %s (built %s)\n", version, buildTime)
		os.Exit(0)
	}

	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[justavps] ")

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}
	log.Printf("Machine %s starting (daemon %s)", cfg.Slug, version)

	health := NewHealthChecker()
	updater := NewUpdater()
	heartbeat := NewHeartbeater(cfg, health, updater)

	// ── Port forwarding setup — shell integration + port watcher ─────────
	if err := SetupPortForwarding(cfg); err != nil {
		log.Printf("WARNING: port forwarding setup failed: %v", err)
	}
	portWatcher := NewPortWatcher(cfg)

	// ── Public server :80 — the single front door ────────────────────────
	proxy := NewProxyRouter(cfg)
	publicServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", *publicPort),
		Handler: proxy,
	}

	// ── Internal API :7777 — health, services, info ──────────────────────
	apiServer := NewAPIServer(cfg, health, *apiPort)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go heartbeat.Run(ctx)
	go portWatcher.Run(ctx)

	go func() {
		log.Printf("Listening :%d (public) :%d (api)", *publicPort, *apiPort)
		if err := publicServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Public server: %v", err)
		}
	}()

	go func() {
		if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API server: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()
	publicServer.Shutdown(shutCtx)
	apiServer.Shutdown(shutCtx)
	log.Println("Stopped.")
}
