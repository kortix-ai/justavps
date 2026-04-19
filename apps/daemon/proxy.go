// Reverse proxy router — the single HTTP front door on :80.
//
// Replaces Caddy entirely. Routes all inbound traffic:
//   /_terminal         → Standalone web terminal page (xterm.js UI)
//   /_pty              → WebSocket PTY handler (in-process)
//   /toolbox/files/*   → Filesystem API (in-process)
//   /toolbox/process/* → Process/Exec API (in-process)
//   /_port/PORT/path   → localhost:PORT/path (dynamic port forwarding)
//   /agent/*           → localhost:2468 (sandbox-agent, strip /agent prefix)
//   /daemon/*          → localhost:7777 (internal API, strip /daemon prefix)
//   /*                 → localhost:3456 (OpenCode IDE, default)

package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Upstream targets — all on localhost.
const (
	opencodeAddr     = "127.0.0.1:3456"
	sandboxAgentAddr = "127.0.0.1:2468"
	internalAPIAddr  = "127.0.0.1:7777"
)

// sharedTransport is reused across all reverse proxies.
var sharedTransport = &http.Transport{
	DialContext:         (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 20,
	IdleConnTimeout:     90 * time.Second,
}

// ProxyRouter implements http.Handler. Single ServeHTTP with path-based routing.
type ProxyRouter struct {
	cfg         *Config
	opencode    *httputil.ReverseProxy
	agent       *httputil.ReverseProxy
	daemon      *httputil.ReverseProxy
	toolboxFS   http.Handler
	toolboxExec http.Handler
}

func NewProxyRouter(cfg *Config) *ProxyRouter {
	return &ProxyRouter{
		cfg:         cfg,
		opencode:    newUpstreamProxy(opencodeAddr, ""),
		agent:       newUpstreamProxy(sandboxAgentAddr, "/agent"),
		daemon:      newUpstreamProxy(internalAPIAddr, "/daemon"),
		toolboxFS:   NewToolboxFS(),
		toolboxExec: NewToolboxProcess(),
	}
}

func (p *ProxyRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	switch {
	// Standalone web terminal page — serves xterm.js UI
	case path == "/_terminal":
		handleTerminalPage(w, r, p.cfg)

	// WebSocket PTY — dashboard terminal
	case path == "/_pty":
		handlePTY(w, r)

	// Toolbox Filesystem API (in-process)
	case strings.HasPrefix(path, "/toolbox/files"):
		p.toolboxFS.ServeHTTP(w, r)

	// Toolbox Process/Exec API (in-process)
	case strings.HasPrefix(path, "/toolbox/process"):
		p.toolboxExec.ServeHTTP(w, r)

	// Dynamic port forwarding: /_port/PORT/rest or /_caddy_port/PORT/rest (legacy)
	case strings.HasPrefix(path, "/_port/") || strings.HasPrefix(path, "/_caddy_port/"):
		handlePortProxy(w, r)

	// Sandbox Agent API
	case strings.HasPrefix(path, "/agent/") || path == "/agent":
		p.agent.ServeHTTP(w, r)

	// Internal daemon API exposed on public port
	case strings.HasPrefix(path, "/daemon/") || path == "/daemon":
		p.daemon.ServeHTTP(w, r)

	// Default — OpenCode IDE
	default:
		// Check if first path segment is a bare port number (e.g. /8080/foo)
		// This supports the CF Worker sending port traffic without /_port prefix
		seg := strings.TrimPrefix(path, "/")
		if idx := strings.Index(seg, "/"); idx > 0 {
			seg = seg[:idx]
		}
		if _, err := strconv.Atoi(seg); err == nil {
			handlePortProxy(w, r)
			return
		}
		p.opencode.ServeHTTP(w, r)
	}
}

// newUpstreamProxy creates a reverse proxy to a local upstream.
// stripPrefix removes the given prefix from the request path before forwarding.
func newUpstreamProxy(addr, stripPrefix string) *httputil.ReverseProxy {
	target, _ := url.Parse("http://" + addr)

	return &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			if stripPrefix != "" {
				req.URL.Path = strings.TrimPrefix(req.URL.Path, stripPrefix)
				if req.URL.Path == "" {
					req.URL.Path = "/"
				}
			}
			req.Host = target.Host
			// Preserve original host for apps that care
			if req.Header.Get("X-Forwarded-Host") == "" {
				req.Header.Set("X-Forwarded-Host", req.Host)
			}
		},
		Transport: sharedTransport,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("Proxy error → %s: %v", addr, err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, `{"error":"upstream %s not reachable","details":"%s"}`, addr, err.Error())
		},
	}
}
