package broker

import (
	"encoding/hex"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestVerifyRequestAcceptsValidSignature(t *testing.T) {
	b := New(Config{SharedSecret: "secret", AllowedClockSkew: 30 * time.Second})
	now := time.Now()
	req := httptest.NewRequest("GET", "http://broker/_broker_proxy", nil)
	ts := strconv.FormatInt(now.Unix(), 10)
	nonce := "nonce-1"
	path := "/_port/3000/health?x=1"
	canonical := strings.Join([]string{ts, nonce, "machine-1", "slug-1", "203.0.113.10", "3000", "3000--slug-1.kortix-dev.cloud", path}, "\n")
	sig := hex.EncodeToString(signBrokerPayload("secret", canonical))
	req.Header.Set(HeaderTargetIP, "203.0.113.10")
	req.Header.Set(HeaderTargetPort, "3000")
	req.Header.Set(HeaderTargetPath, path)
	req.Header.Set(HeaderMachineID, "machine-1")
	req.Header.Set(HeaderMachineSlug, "slug-1")
	req.Header.Set(HeaderOriginalHost, "3000--slug-1.kortix-dev.cloud")
	req.Header.Set(HeaderRequestTS, ts)
	req.Header.Set(HeaderRequestNonce, nonce)
	req.Header.Set(HeaderSignature, sig)

	verified, err := b.verifyRequest(req)
	if err != nil {
		t.Fatalf("expected request to verify, got error: %v", err)
	}
	if verified.TargetIP != "203.0.113.10" || verified.TargetPort != 3000 || verified.TargetPath != path {
		t.Fatalf("unexpected verified request: %+v", verified)
	}
}

func TestVerifyRequestRejectsReplayedNonce(t *testing.T) {
	b := New(Config{SharedSecret: "secret", AllowedClockSkew: time.Hour})
	now := time.Now()
	b.nonces.Store("nonce-1", now.Add(time.Minute))
	req := httptest.NewRequest("GET", "http://broker/_broker_proxy", nil)
	ts := strconv.FormatInt(now.Unix(), 10)
	path := "/"
	canonical := strings.Join([]string{ts, "nonce-1", "machine-1", "slug-1", "203.0.113.10", "80", "slug-1.kortix-dev.cloud", path}, "\n")
	sig := hex.EncodeToString(signBrokerPayload("secret", canonical))
	req.Header.Set(HeaderTargetIP, "203.0.113.10")
	req.Header.Set(HeaderTargetPort, "80")
	req.Header.Set(HeaderTargetPath, path)
	req.Header.Set(HeaderMachineID, "machine-1")
	req.Header.Set(HeaderMachineSlug, "slug-1")
	req.Header.Set(HeaderOriginalHost, "slug-1.kortix-dev.cloud")
	req.Header.Set(HeaderRequestTS, ts)
	req.Header.Set(HeaderRequestNonce, "nonce-1")
	req.Header.Set(HeaderSignature, sig)

	if _, err := b.verifyRequest(req); err == nil || !strings.Contains(err.Error(), "replayed nonce") {
		t.Fatalf("expected replay error, got %v", err)
	}
}
