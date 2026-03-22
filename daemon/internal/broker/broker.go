// Package broker implements the shared origin broker for proxying requests to machines.
package broker

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	HeaderTargetIP     = "X-Kortix-Target-Ip"
	HeaderTargetPort   = "X-Kortix-Target-Port"
	HeaderTargetPath   = "X-Kortix-Target-Path"
	HeaderMachineID    = "X-Kortix-Machine-Id"
	HeaderMachineSlug  = "X-Kortix-Machine-Slug"
	HeaderOriginalHost = "X-Kortix-Original-Host"
	HeaderRequestTS    = "X-Kortix-Request-Ts"
	HeaderRequestNonce = "X-Kortix-Request-Nonce"
	HeaderSignature    = "X-Kortix-Signature"
)

type Config struct {
	ListenAddr        string
	HTTPSListenAddr   string
	SharedSecret      string
	TLSCertPath       string
	TLSKeyPath        string
	AllowedClockSkew  time.Duration
	NonceTTL          time.Duration
	ProxyDialTimeout  time.Duration
	IdleConnTimeout   time.Duration
	ReadHeaderTimeout time.Duration
}

type verifiedRequest struct {
	TargetIP     string
	TargetPort   int
	TargetPath   string
	MachineID    string
	MachineSlug  string
	OriginalHost string
	Timestamp    string
	Nonce        string
	Signature    string
}

type Broker struct {
	config    Config
	transport *http.Transport
	dialer    websocket.Dialer
	upgrader  websocket.Upgrader
	nonces    sync.Map
}

func New(config Config) *Broker {
	if config.ListenAddr == "" {
		config.ListenAddr = ":80"
	}
	if config.HTTPSListenAddr == "" {
		config.HTTPSListenAddr = ":443"
	}
	if config.AllowedClockSkew <= 0 {
		config.AllowedClockSkew = 30 * time.Second
	}
	if config.NonceTTL <= 0 {
		config.NonceTTL = 2 * time.Minute
	}
	if config.ProxyDialTimeout <= 0 {
		config.ProxyDialTimeout = 5 * time.Second
	}
	if config.IdleConnTimeout <= 0 {
		config.IdleConnTimeout = 90 * time.Second
	}
	if config.ReadHeaderTimeout <= 0 {
		config.ReadHeaderTimeout = 10 * time.Second
	}

	transport := &http.Transport{
		DialContext:         (&net.Dialer{Timeout: config.ProxyDialTimeout}).DialContext,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     config.IdleConnTimeout,
	}

	return &Broker{
		config:    config,
		transport: transport,
		dialer: websocket.Dialer{
			HandshakeTimeout: config.ProxyDialTimeout,
			NetDialContext:   (&net.Dialer{Timeout: config.ProxyDialTimeout}).DialContext,
		},
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (b *Broker) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", b.handleHealthz)
	mux.HandleFunc("/healthz", b.handleHealthz)
	mux.HandleFunc("/_broker_proxy", b.handleProxy)
	return mux
}

func (b *Broker) Server() *http.Server {
	return &http.Server{
		Addr:              b.config.ListenAddr,
		Handler:           b.Handler(),
		ReadHeaderTimeout: b.config.ReadHeaderTimeout,
	}
}

func (b *Broker) TLSServer() *http.Server {
	if b.config.TLSCertPath == "" || b.config.TLSKeyPath == "" {
		return nil
	}

	return &http.Server{
		Addr:              b.config.HTTPSListenAddr,
		Handler:           b.Handler(),
		ReadHeaderTimeout: b.config.ReadHeaderTimeout,
	}
}

func (b *Broker) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func (b *Broker) handleProxy(w http.ResponseWriter, r *http.Request) {
	verified, err := b.verifyRequest(r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "invalid broker signature", err)
		return
	}

	if websocket.IsWebSocketUpgrade(r) {
		b.handleWebSocketProxy(w, r, verified)
		return
	}

	b.handleHTTPProxy(w, r, verified)
}

func (b *Broker) handleHTTPProxy(w http.ResponseWriter, r *http.Request, verified verifiedRequest) {
	targetURL := fmt.Sprintf("http://%s:80%s", verified.TargetIP, verified.TargetPath)

	headers := stripHopByHopHeaders(r.Header)
	headers.Del(HeaderTargetIP)
	headers.Del(HeaderTargetPort)
	headers.Del(HeaderTargetPath)
	headers.Del(HeaderMachineID)
	headers.Del(HeaderMachineSlug)
	headers.Del(HeaderOriginalHost)
	headers.Del(HeaderRequestTS)
	headers.Del(HeaderRequestNonce)
	headers.Del(HeaderSignature)
	headers.Set("X-Forwarded-Host", verified.OriginalHost)
	headers.Set("X-Forwarded-Proto", "https")

	if realIP := r.Header.Get("CF-Connecting-IP"); realIP != "" {
		headers.Set("X-Real-IP", realIP)
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "failed to create upstream request", err)
		return
	}
	req.Header = headers
	req.ContentLength = r.ContentLength

	resp, err := b.transport.RoundTrip(req)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "broker upstream request failed", err)
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (b *Broker) handleWebSocketProxy(w http.ResponseWriter, r *http.Request, verified verifiedRequest) {
	pathURL, err := url.Parse(verified.TargetPath)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid websocket target path", err)
		return
	}
	upstreamURL := url.URL{
		Scheme:   "ws",
		Host:     net.JoinHostPort(verified.TargetIP, "80"),
		Path:     pathURL.Path,
		RawQuery: pathURL.RawQuery,
	}

	upstreamHeaders := http.Header{}
	upstreamHeaders.Set("X-Forwarded-Host", verified.OriginalHost)
	upstreamHeaders.Set("X-Forwarded-Proto", "https")
	if realIP := r.Header.Get("CF-Connecting-IP"); realIP != "" {
		upstreamHeaders.Set("X-Real-IP", realIP)
	}

	upstreamConn, resp, err := b.dialer.Dial(upstreamURL.String(), upstreamHeaders)
	if err != nil {
		if resp != nil {
			writeJSONError(w, http.StatusBadGateway, fmt.Sprintf("upstream websocket dial failed with %d", resp.StatusCode), err)
			return
		}
		writeJSONError(w, http.StatusBadGateway, "upstream websocket dial failed", err)
		return
	}
	defer upstreamConn.Close()

	clientConn, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	errCh := make(chan error, 2)
	go pipeWebSocket(errCh, clientConn, upstreamConn)
	go pipeWebSocket(errCh, upstreamConn, clientConn)

	if err := <-errCh; err != nil && !isNormalWSError(err) {
		log.Printf("[BROKER] websocket proxy ended with error: %v", err)
	}
}

func pipeWebSocket(errCh chan<- error, src, dst *websocket.Conn) {
	for {
		messageType, data, err := src.ReadMessage()
		if err != nil {
			errCh <- err
			return
		}
		if err := dst.WriteMessage(messageType, data); err != nil {
			errCh <- err
			return
		}
	}
}

func isNormalWSError(err error) bool {
	if errors.Is(err, io.EOF) {
		return true
	}
	if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "close")
}

func (b *Broker) verifyRequest(r *http.Request) (verifiedRequest, error) {
	v := verifiedRequest{
		TargetIP:     strings.TrimSpace(r.Header.Get(HeaderTargetIP)),
		TargetPath:   strings.TrimSpace(r.Header.Get(HeaderTargetPath)),
		MachineID:    strings.TrimSpace(r.Header.Get(HeaderMachineID)),
		MachineSlug:  strings.TrimSpace(r.Header.Get(HeaderMachineSlug)),
		OriginalHost: strings.TrimSpace(r.Header.Get(HeaderOriginalHost)),
		Timestamp:    strings.TrimSpace(r.Header.Get(HeaderRequestTS)),
		Nonce:        strings.TrimSpace(r.Header.Get(HeaderRequestNonce)),
		Signature:    strings.TrimSpace(r.Header.Get(HeaderSignature)),
	}

	port, err := strconv.Atoi(strings.TrimSpace(r.Header.Get(HeaderTargetPort)))
	if err != nil || port < 1 || port > 65535 {
		return v, errors.New("invalid target port")
	}
	v.TargetPort = port

	if net.ParseIP(v.TargetIP) == nil {
		return v, errors.New("invalid target ip")
	}
	if v.TargetPath == "" || !strings.HasPrefix(v.TargetPath, "/") {
		return v, errors.New("invalid target path")
	}
	if v.MachineID == "" || v.MachineSlug == "" || v.OriginalHost == "" || v.Timestamp == "" || v.Nonce == "" || v.Signature == "" {
		return v, errors.New("missing required headers")
	}

	ts, err := strconv.ParseInt(v.Timestamp, 10, 64)
	if err != nil {
		return v, errors.New("invalid timestamp")
	}
	requestTime := time.Unix(ts, 0)
	now := time.Now()
	if requestTime.Before(now.Add(-b.config.AllowedClockSkew)) || requestTime.After(now.Add(b.config.AllowedClockSkew)) {
		return v, errors.New("expired timestamp")
	}

	if _, loaded := b.nonces.LoadOrStore(v.Nonce, requestTime.Add(b.config.NonceTTL)); loaded {
		return v, errors.New("replayed nonce")
	}
	b.cleanupExpiredNonces(now)

	canonical := strings.Join([]string{
		v.Timestamp,
		v.Nonce,
		v.MachineID,
		v.MachineSlug,
		v.TargetIP,
		strconv.Itoa(v.TargetPort),
		v.OriginalHost,
		v.TargetPath,
	}, "\n")
	expected := signBrokerPayload(b.config.SharedSecret, canonical)
	provided, err := hex.DecodeString(v.Signature)
	if err != nil {
		return v, errors.New("invalid signature encoding")
	}
	if subtle.ConstantTimeCompare(expected, provided) != 1 {
		return v, errors.New("signature mismatch")
	}

	return v, nil
}

func (b *Broker) cleanupExpiredNonces(now time.Time) {
	b.nonces.Range(func(key, value any) bool {
		expiresAt, ok := value.(time.Time)
		if ok && now.After(expiresAt) {
			b.nonces.Delete(key)
		}
		return true
	})
}

func signBrokerPayload(secret, payload string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}

func stripHopByHopHeaders(headers http.Header) http.Header {
	clean := http.Header{}
	for name, values := range headers {
		switch strings.ToLower(name) {
		case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade":
			continue
		default:
			for _, value := range values {
				clean.Add(name, value)
			}
		}
	}
	return clean
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func writeJSONError(w http.ResponseWriter, status int, message string, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, fmt.Sprintf(`{"error":%q,"details":%q}`, message, err.Error()))
}

func (b *Broker) Shutdown(_ context.Context) error {
	b.transport.CloseIdleConnections()
	return nil
}
