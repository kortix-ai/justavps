// Dynamic port proxy — forwards /_port/PORT/path to localhost:PORT/path.
//
// Handles services bound to 127.0.0.1 that aren't directly reachable from outside.
// CF Worker routes port-specific requests here via the daemon's :80 listener.
//
// Paths accepted:
//   /_port/PORT/path         (canonical)
//   /_caddy_port/PORT/path   (legacy compat)
//   /PORT/path               (bare — caught by ProxyRouter fallback)

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
	// Strip known prefixes to get PORT/path
	path := r.URL.Path
	path = strings.TrimPrefix(path, "/_caddy_port")
	path = strings.TrimPrefix(path, "/_port")
	path = strings.TrimPrefix(path, "/")

	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, `{"error":"missing port"}`, http.StatusBadRequest)
		return
	}

	port, err := strconv.Atoi(parts[0])
	if err != nil || port < 1 || port > 65535 {
		http.Error(w, `{"error":"invalid port"}`, http.StatusBadRequest)
		return
	}

	targetPath := "/"
	if len(parts) > 1 {
		targetPath = "/" + parts[1]
	}

	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.URL.Path = targetPath
			req.URL.RawQuery = r.URL.RawQuery
			req.Host = target.Host
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
			fmt.Fprintf(w, `{"error":"port %d not reachable","details":"%s"}`, port, err.Error())
		},
	}

	proxy.ServeHTTP(w, r)
}
