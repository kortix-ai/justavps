// Port proxy handler — proxies /_caddy_port/PORT/path to localhost:PORT/path.
//
// This handles services that bind to 127.0.0.1 (not 0.0.0.0).
// The CF Worker sends all port-forwarded traffic through Caddy on :80,
// Caddy strips /_caddy_port and forwards to the daemon, which proxies
// to the actual local service port.
//
// Flow: CF Worker → origin:80/_caddy_port/4096/path → Caddy → daemon → localhost:4096/path

package main

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func handlePortProxy(w http.ResponseWriter, r *http.Request) {
	// Path could be:
	//   /_caddy_port/PORT/path  (Caddy with handle — preserves prefix)
	//   /PORT/path              (Caddy with handle_path — strips prefix)
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/_caddy_port")
	path = strings.TrimPrefix(path, "/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 {
		http.Error(w, `{"error":"Missing port"}`, http.StatusBadRequest)
		return
	}

	port, err := strconv.Atoi(parts[0])
	if err != nil || port < 1 || port > 65535 {
		http.Error(w, `{"error":"Invalid port"}`, http.StatusBadRequest)
		return
	}

	// Build target path
	targetPath := "/"
	if len(parts) > 1 {
		targetPath = "/" + parts[1]
	}
	if r.URL.RawQuery != "" {
		targetPath += "?" + r.URL.RawQuery
	}

	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.URL.Path = targetPath
			req.URL.RawQuery = r.URL.RawQuery
			req.Host = target.Host
			// Forward original headers
			if xff := r.Header.Get("X-Forwarded-Host"); xff != "" {
				req.Header.Set("X-Forwarded-Host", xff)
			}
		},
		Transport: &http.Transport{
			DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, `{"error":"Port %d not reachable","details":"%s"}`, port, err.Error())
		},
	}

	// Handle WebSocket upgrades too
	if r.Header.Get("Upgrade") == "websocket" {
		proxy.ServeHTTP(w, r)
		return
	}

	proxy.ServeHTTP(w, r)
}
