package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// ProxyServer is the main entry point for all web traffic.
// cloudflared → ProxyServer (:7777) → auth check → reverse proxy to code-server (:8080)
//
// Routes:
//   /health, /services, /info → daemon API (no auth)
//   /daemon/*                 → daemon API (no auth, for platform internal use)
//   everything else           → auth check → reverse proxy to code-server

// NewAuthProxy creates the HTTP handler with auth middleware + reverse proxy.
func NewAuthProxy(cfg *Config, proxyAuthSecret string, codeServerPort int) http.Handler {
	// Target: code-server on localhost
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", codeServerPort))
	proxy := httputil.NewSingleHostReverseProxy(target)

	// Custom director to preserve WebSocket headers
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		// Preserve Host header for WebSocket upgrades
		req.Host = req.URL.Host
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for daemon API endpoints
		if isDaemonAPIPath(r.URL.Path) {
			return // Let the mux handle it
		}

		// Verify JWT cookie
		userID, err := verifyJWTCookie(r, proxyAuthSecret)
		if err != nil {
			log.Printf("Auth failed: %s (path=%s secret_len=%d cookie=%v header=%v)",
				err.Error(), r.URL.Path, len(proxyAuthSecret),
				r.Header.Get("Cookie") != "", r.Header.Get("Authorization") != "")
			// Browser request → redirect to platform login
			if isBrowserReq(r) {
				redirectURL := fmt.Sprintf("https://%s.%s%s", cfg.Slug, cfg.ProxyDomain, r.URL.RequestURI())
				loginURL := fmt.Sprintf("%s/api/proxy-auth?redirect=%s", cfg.CallbackURL, url.QueryEscape(redirectURL))
				http.Redirect(w, r, loginURL, http.StatusFound)
				return
			}
			// API request → 401
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintf(w, `{"error":"Authentication required: %s"}`, err.Error())
			return
		}

		log.Printf("Auth OK: user=%s path=%s", userID[:8], r.URL.Path)

		// Forward to code-server
		proxy.ServeHTTP(w, r)
	})
}

func isDaemonAPIPath(path string) bool {
	switch {
	case path == "/health":
		return true
	case path == "/services":
		return true
	case path == "/info":
		return true
	case len(path) > 10 && path[:10] == "/services/":
		return true
	default:
		return false
	}
}

func isBrowserReq(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return accept == "" || // No Accept header — assume browser
		contains(accept, "text/html") ||
		contains(accept, "*/*")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
