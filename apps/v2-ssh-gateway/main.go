package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

const defaultPort = 2222

type validationResponse struct {
	Valid      bool   `json:"valid"`
	MachineID  string `json:"machine_id"`
	TargetHost string `json:"target_host"`
	TargetPort int    `json:"target_port"`
	SSHUser    string `json:"ssh_user"`
	ExpiresAt  string `json:"expires_at"`
}

type gateway struct {
	apiURL     string
	apiToken   string
	port       int
	hostKey    ssh.Signer
	clientKey  ssh.Signer
	httpClient *http.Client
}

func main() {
	g, err := newGateway()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("JustAVPS V2 SSH gateway listening on :%d", g.port)
	if err := g.serve(); err != nil {
		log.Fatal(err)
	}
}

func newGateway() (*gateway, error) {
	apiURL := strings.TrimRight(env("V2_API_URL", "http://localhost:4200"), "/")
	apiToken := env("V2_API_TOKEN", env("V2_ADMIN_TOKEN", ""))
	if apiToken == "" {
		return nil, fmt.Errorf("V2_API_TOKEN or V2_ADMIN_TOKEN is required")
	}
	clientKey, err := signerFromEnv("V2_SSH_GATEWAY_PRIVATE_KEY")
	if err != nil {
		return nil, fmt.Errorf("load V2_SSH_GATEWAY_PRIVATE_KEY: %w", err)
	}
	hostKey, err := signerFromEnv("V2_SSH_GATEWAY_HOST_KEY")
	if err != nil {
		if !envBool("V2_SSH_GATEWAY_ALLOW_EPHEMERAL_HOST_KEY", false) {
			return nil, fmt.Errorf("load V2_SSH_GATEWAY_HOST_KEY: %w (set a stable host key, or set V2_SSH_GATEWAY_ALLOW_EPHEMERAL_HOST_KEY=true for throwaway local testing)", err)
		}
		log.Printf("V2_SSH_GATEWAY_HOST_KEY not set/invalid; generating ephemeral host key for throwaway testing: %v", err)
		_, priv, genErr := ed25519.GenerateKey(rand.Reader)
		if genErr != nil {
			return nil, genErr
		}
		hostKey, err = ssh.NewSignerFromKey(priv)
		if err != nil {
			return nil, err
		}
	}
	return &gateway{
		apiURL:     apiURL,
		apiToken:   apiToken,
		port:       envInt("V2_SSH_GATEWAY_PORT", defaultPort),
		hostKey:    hostKey,
		clientKey:  clientKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (g *gateway) serve() error {
	serverConfig := &ssh.ServerConfig{NoClientAuth: true}
	serverConfig.PasswordCallback = func(conn ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
		return nil, fmt.Errorf("password authentication is not supported; use a JustAVPS SSH token as the username")
	}
	serverConfig.AddHostKey(g.hostKey)

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", g.port))
	if err != nil {
		return err
	}
	defer listener.Close()
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept failed: %v", err)
			continue
		}
		go g.handleConn(conn, serverConfig)
	}
}

func (g *gateway) handleConn(raw net.Conn, serverConfig *ssh.ServerConfig) {
	defer raw.Close()
	serverConn, chans, reqs, err := ssh.NewServerConn(raw, serverConfig)
	if err != nil {
		log.Printf("handshake failed: %v", err)
		return
	}
	defer serverConn.Close()

	token := strings.TrimSpace(serverConn.User())
	validation, err := g.validateToken(serverConn.Conn.RemoteAddr().String(), token)
	if err != nil || !validation.Valid || validation.TargetHost == "" {
		log.Printf("invalid SSH token from %s: %v", serverConn.Conn.RemoteAddr(), err)
		return
	}
	if validation.TargetPort == 0 {
		validation.TargetPort = 22
	}
	if validation.SSHUser == "" {
		validation.SSHUser = "user"
	}

	clientConfig := &ssh.ClientConfig{
		User:            validation.SSHUser,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(g.clientKey)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         20 * time.Second,
	}
	target := net.JoinHostPort(validation.TargetHost, strconv.Itoa(validation.TargetPort))
	upstream, err := ssh.Dial("tcp", target, clientConfig)
	if err != nil {
		log.Printf("dial target %s for machine %s failed: %v", target, validation.MachineID, err)
		return
	}
	defer upstream.Close()

	go discardGlobalRequests(reqs)
	for ch := range chans {
		go forwardChannel(ch, upstream, validation.MachineID)
	}
}

func (g *gateway) validateToken(remote, token string) (*validationResponse, error) {
	if token == "" {
		return nil, fmt.Errorf("empty token")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	url := fmt.Sprintf("%s/internal/ssh/validate?token=%s", g.apiURL, token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+g.apiToken)
	req.Header.Set("X-JustAVPS-SSH-Gateway-Remote", remote)
	res, err := g.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("api validation failed: %s %s", res.Status, strings.TrimSpace(string(body)))
	}
	var out validationResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func discardGlobalRequests(reqs <-chan *ssh.Request) {
	for req := range reqs {
		if req.WantReply {
			_ = req.Reply(false, nil)
		}
	}
}

func forwardChannel(newChannel ssh.NewChannel, upstream *ssh.Client, machineID string) {
	clientChannel, clientReqs, err := newChannel.Accept()
	if err != nil {
		log.Printf("accept channel failed for %s: %v", machineID, err)
		return
	}
	defer clientChannel.Close()

	upstreamChannel, upstreamReqs, err := upstream.OpenChannel(newChannel.ChannelType(), newChannel.ExtraData())
	if err != nil {
		log.Printf("open upstream channel failed for %s: %v", machineID, err)
		return
	}
	defer upstreamChannel.Close()

	go proxyRequests(clientReqs, upstreamChannel)
	go proxyRequests(upstreamReqs, clientChannel)
	go func() { _, _ = io.Copy(upstreamChannel, clientChannel) }()
	_, _ = io.Copy(clientChannel, upstreamChannel)
}

type requestSender interface {
	SendRequest(name string, wantReply bool, payload []byte) (bool, error)
}

func proxyRequests(reqs <-chan *ssh.Request, dest requestSender) {
	for req := range reqs {
		ok, err := dest.SendRequest(req.Type, req.WantReply, req.Payload)
		if req.WantReply {
			_ = req.Reply(err == nil && ok, nil)
		}
	}
}

func signerFromEnv(key string) (ssh.Signer, error) {
	value := os.Getenv(key)
	if value == "" {
		path := os.Getenv(key + "_FILE")
		if path == "" {
			return nil, fmt.Errorf("%s or %s_FILE is required", key, key)
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		return ssh.ParsePrivateKey(contents)
	}
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil && strings.Contains(string(decoded), "PRIVATE KEY") {
		value = string(decoded)
	}
	return ssh.ParsePrivateKey([]byte(value))
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}
