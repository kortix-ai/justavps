// justavps-daemon — The on-machine platform agent.
//
// Responsibilities:
//   - Health monitoring (CPU, memory, disk, services)
//   - Heartbeat reporting (POST to platform every 30s)
//   - Local API on /health, /services, /info, /services/{name}/restart
//
// Traffic flow (direct IP proxy — no tunnels):
//   CF Worker authenticates all requests and proxies to VPS_IP:port directly.
//   The daemon does NOT handle auth or proxy traffic.
//   Port 7777 is only accessible from platform IPs (Hetzner Firewall).
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
	port := flag.Int("port", 7777, "API port")
	showVersion := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("justavps-daemon %s (built %s)\n", version, buildTime)
		os.Exit(0)
	}

	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[justavps-daemon] ")

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config from %s: %v", *configPath, err)
	}
	log.Printf("Loaded config: slug=%s callback=%s", cfg.Slug, cfg.CallbackURL)

	health := NewHealthChecker()
	heartbeat := NewHeartbeater(cfg, health)

	// HTTP handler: daemon API routes only (no auth, no proxy)
	mux := http.NewServeMux()

	apiServer := NewAPIServer(cfg, health, *port)
	mux.HandleFunc("GET /health", apiServer.handleHealth)
	mux.HandleFunc("GET /services", apiServer.handleServices)
	mux.HandleFunc("POST /services/{name}/restart", apiServer.handleServiceRestart)
	mux.HandleFunc("GET /info", apiServer.handleInfo)

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: mux,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go heartbeat.Run(ctx)

	go func() {
		log.Printf("Listening on :%d (health + heartbeat only, no auth/proxy)", *port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()
	server.Shutdown(shutCtx)
	log.Println("Daemon stopped.")
}
