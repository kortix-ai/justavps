package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const cookieName = "__justavps_proxy"

// jwtPayload represents the decoded JWT claims.
type jwtPayload struct {
	Sub string `json:"sub"` // user ID
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

// verifyJWTCookie checks the __justavps_proxy cookie for a valid HS256 JWT.
// Returns the user ID if valid, empty string if not.
func verifyJWTCookie(r *http.Request, secret string) (string, error) {
	// Try cookie first
	token := ""
	if c, err := r.Cookie(cookieName); err == nil {
		token = c.Value
	}
	// Fall back to Authorization: Bearer header
	if token == "" {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = auth[7:]
		}
	}
	// Fall back to ?token= query param
	if token == "" {
		token = r.URL.Query().Get("token")
	}

	if token == "" {
		return "", fmt.Errorf("no auth token")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid JWT format")
	}

	// Verify HMAC-SHA256 signature
	sigInput := parts[0] + "." + parts[1]
	expectedSig, err := base64URLDecode(parts[2])
	if err != nil {
		return "", fmt.Errorf("invalid signature encoding")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sigInput))
	computedSig := mac.Sum(nil)

	if !hmac.Equal(expectedSig, computedSig) {
		return "", fmt.Errorf("invalid signature")
	}

	// Decode payload
	payloadBytes, err := base64URLDecode(parts[1])
	if err != nil {
		return "", fmt.Errorf("invalid payload encoding")
	}

	var payload jwtPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return "", fmt.Errorf("invalid payload JSON")
	}

	// Check expiry
	if payload.Exp > 0 && time.Now().Unix() > payload.Exp {
		return "", fmt.Errorf("token expired")
	}

	if payload.Sub == "" {
		return "", fmt.Errorf("missing sub claim")
	}

	return payload.Sub, nil
}

func base64URLDecode(s string) ([]byte, error) {
	// Add padding
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.URLEncoding.DecodeString(s)
}
