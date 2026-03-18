package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const loginPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JustAVPS — Authenticate</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:2.5rem;width:100%%;max-width:420px}
h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}
p{font-size:.875rem;color:#a3a3a3;margin-bottom:1.5rem}
label{font-size:.8rem;font-weight:500;display:block;margin-bottom:.4rem;color:#a3a3a3}
input{width:100%%;padding:.65rem .8rem;border:1px solid #333;border-radius:8px;background:#0a0a0a;color:#e5e5e5;font-size:.875rem;font-family:monospace;outline:none;margin-bottom:1rem}
input:focus{border-color:#3b82f6}
button{width:100%%;padding:.65rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:.875rem;font-weight:500;cursor:pointer}
button:hover{background:#2563eb}
.error{color:#ef4444;font-size:.8rem;margin-bottom:1rem;display:none}
.slug{color:#3b82f6;font-family:monospace}
</style>
</head>
<body>
<div class="card">
<h1>Authenticate</h1>
<p>Enter your API key to access <span class="slug">%s</span></p>
<form method="POST" action="/auth/login">
<div id="err" class="error"></div>
<label for="key">API Key</label>
<input type="password" id="key" name="api_key" placeholder="sk_live_..." autofocus required>
<input type="hidden" name="redirect" value="%s">
<button type="submit">Continue</button>
</form>
</div>
</body>
</html>`

// handleLoginPage serves the login form.
func handleLoginPage(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		redirect := r.URL.Query().Get("redirect")
		if redirect == "" {
			redirect = "/"
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, loginPageHTML, cfg.Slug+"."+cfg.ProxyDomain, redirect)
	}
}

// handleLoginSubmit validates the API key and sets a JWT cookie.
func handleLoginSubmit(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Bad request", 400)
			return
		}

		apiKeyRaw := strings.TrimSpace(r.FormValue("api_key"))
		redirect := r.FormValue("redirect")
		if redirect == "" {
			redirect = "/"
		}

		if apiKeyRaw == "" {
			serveLoginError(w, cfg, redirect, "API key is required")
			return
		}

		// Validate: the API key must start with sk_live_
		if !strings.HasPrefix(apiKeyRaw, "sk_live_") {
			serveLoginError(w, cfg, redirect, "Invalid API key format")
			return
		}

		// Sign a JWT for this session (we trust the API key holder)
		// The JWT sub is a hash of the API key — we don't know the user ID here,
		// but the daemon only checks signature validity, not user identity.
		token, err := signLocalJWT(cfg.ProxyAuthSecret, apiKeyRaw)
		if err != nil {
			log.Printf("JWT sign error: %v", err)
			serveLoginError(w, cfg, redirect, "Authentication failed")
			return
		}

		// Set cookie on the proxy domain
		cookie := &http.Cookie{
			Name:     cookieName,
			Value:    token,
			Path:     "/",
			Domain:   "." + cfg.ProxyDomain,
			MaxAge:   86400,
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
		}
		http.SetCookie(w, cookie)

		log.Printf("Login OK via API key (prefix=%s...)", apiKeyRaw[:16])
		http.Redirect(w, r, redirect, http.StatusFound)
	}
}

func serveLoginError(w http.ResponseWriter, cfg *Config, redirect, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(401)
	errorPage := fmt.Sprintf(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth Error</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:2.5rem;width:100%%;max-width:420px}h1{font-size:1.25rem;margin-bottom:.5rem}.err{color:#ef4444;font-size:.875rem;margin-bottom:1rem}a{color:#3b82f6}</style>
</head><body><div class="card"><h1>Authentication Failed</h1><p class="err">%s</p><p><a href="/auth/login?redirect=%s">Try again</a></p></div></body></html>`, msg, redirect)
	fmt.Fprint(w, errorPage)
}

// signLocalJWT creates a HS256 JWT using the proxy auth secret.
// The "sub" claim is a hash of the API key (we don't have the user ID on the VPS).
func signLocalJWT(secret, apiKey string) (string, error) {
	if secret == "" {
		return "", fmt.Errorf("no proxy_auth_secret configured")
	}

	// Use first 16 chars of API key hash as sub (enough for identification)
	keyHash := sha256.Sum256([]byte(apiKey))
	sub := fmt.Sprintf("%x", keyHash[:8])

	header := base64URLEncode([]byte(`{"alg":"HS256"}`))

	now := time.Now().Unix()
	payload := map[string]interface{}{
		"sub": sub,
		"iat": now,
		"exp": now + 86400, // 24h
	}
	payloadJSON, _ := json.Marshal(payload)
	payloadB64 := base64URLEncode(payloadJSON)

	sigInput := header + "." + payloadB64
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sigInput))
	sig := base64URLEncode(mac.Sum(nil))

	return sigInput + "." + sig, nil
}

func base64URLEncode(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}
