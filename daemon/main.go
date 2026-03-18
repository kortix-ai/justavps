// justavps-daemon — The on-machine platform agent.
//
// Responsibilities:
//   - Auth gateway: JWT cookie verification → reverse proxy to code-server
//   - Heartbeat reporting (POST to platform every 30s)
//   - Health monitoring (CPU, memory, disk, services)
//   - Local API on /health, /services, /info
//
// Traffic flow:
//   cloudflared tunnel → daemon :7777 → auth check → code-server :8080
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
	port := flag.Int("port", 7777, "Proxy + API port")
	codeServerPort := flag.Int("code-server-port", 8080, "code-server port to proxy to")
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

	// Build the HTTP handler: daemon API routes + auth proxy for everything else
	mux := http.NewServeMux()

	// Daemon API routes (no auth required — internal use)
	apiServer := NewAPIServer(cfg, health, *port)
	mux.HandleFunc("GET /health", apiServer.handleHealth)
	mux.HandleFunc("GET /services", apiServer.handleServices)
	mux.HandleFunc("POST /services/{name}/restart", apiServer.handleServiceRestart)
	mux.HandleFunc("GET /info", apiServer.handleInfo)

	// Auth reverse proxy for everything else → code-server
	authProxy := NewAuthProxy(cfg, cfg.ProxyAuthSecret, *codeServerPort)
	mux.Handle("/", authProxy)

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: mux,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go heartbeat.Run(ctx)

	go func() {
		log.Printf("Listening on :%d (proxy → localhost:%d, auth: %s)",
			*port, *codeServerPort, func() string {
				if cfg.ProxyAuthSecret != "" {
					return "JWT"
				}
				return "DISABLED"
			}())
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
