// justavps-daemon — The on-machine platform agent.
//
// Responsibilities:
//   - Heartbeat reporting (POST to platform every 30s)
//   - Health monitoring (CPU, memory, disk, services)
//   - Local API on :7777 (health, services, info)
//   - Stage reporting (cloud-init calls daemon to report progress)
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
	port := flag.Int("port", 7777, "Local API port")
	showVersion := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("justavps-daemon %s (built %s)\n", version, buildTime)
		os.Exit(0)
	}

	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[justavps-daemon] ")

	// Load config
	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config from %s: %v", *configPath, err)
	}
	log.Printf("Loaded config: slug=%s callback=%s", cfg.Slug, cfg.CallbackURL)

	// Create health checker
	health := NewHealthChecker()

	// Create heartbeat sender
	heartbeat := NewHeartbeater(cfg, health)

	// Create API server
	api := NewAPIServer(cfg, health, *port)

	// Context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start heartbeat loop
	go heartbeat.Run(ctx)

	// Start API server
	go func() {
		if err := api.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API server error: %v", err)
		}
	}()

	log.Printf("Daemon running: heartbeat=30s api=:%d", *port)

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()
	api.Shutdown(shutCtx)

	log.Println("Daemon stopped.")
}
