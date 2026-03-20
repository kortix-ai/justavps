// Standalone web terminal page — serves a complete xterm.js terminal at /_terminal.
//
// This page loads xterm.js from CDN and connects to the /_pty WebSocket
// endpoint on the same host. Auth is handled by the CF Worker before
// the request reaches the daemon.
//
// The page is designed to work both embedded (in an iframe on the dashboard)
// and standalone (opened in a new tab for a full terminal experience).
//
// Localhost URLs (localhost:PORT, 127.0.0.1:PORT, 0.0.0.0:PORT) are
// automatically rewritten to public port-forwarded URLs (PORT--slug.domain).

package main

import (
	"fmt"
	"net/http"
	"strings"
)

func buildTerminalHTML(slug, domain string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terminal</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%%;overflow:hidden;background:#09090b}
#terminal{height:100%%;width:100%%}
.xterm{height:100%%!important}

/* Status bar — only shown standalone (not in iframe) */
#status-bar{
  display:none;
  position:fixed;top:0;left:0;right:0;
  height:32px;
  background:#18181b;
  border-bottom:1px solid #27272a;
  padding:0 12px;
  align-items:center;
  gap:8px;
  z-index:10;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:12px;
  color:#a1a1aa;
}
#status-bar .dots{display:flex;gap:6px}
#status-bar .dot{width:10px;height:10px;border-radius:50%%}
#status-bar .dot-red{background:#ef4444cc}
#status-bar .dot-yellow{background:#eab308cc}
#status-bar .dot-green{background:#22c55ecc}
#status-bar .badge{
  display:inline-flex;align-items:center;gap:4px;
  padding:2px 8px;border-radius:4px;
  font-size:10px;font-weight:500;
}
#status-bar .badge.connected{background:#22c55e22;color:#4ade80}
#status-bar .badge.disconnected{background:#27272a;color:#71717a}
#status-bar .spacer{flex:1}
#status-bar button{
  background:transparent;border:none;color:#71717a;
  cursor:pointer;padding:4px;border-radius:4px;
  font-size:12px;
}
#status-bar button:hover{color:#e4e4e7;background:#27272a}

body.standalone #status-bar{display:flex}
body.standalone #terminal{height:calc(100%% - 32px);margin-top:32px}
</style>
</head>
<body>

<div id="status-bar">
  <div class="dots">
    <div class="dot dot-red"></div>
    <div class="dot dot-yellow"></div>
    <div class="dot dot-green"></div>
  </div>
  <div id="badge" class="badge disconnected">Connecting...</div>
  <div class="spacer"></div>
  <button id="reconnect-btn" title="Reconnect" style="display:none">↻ Reconnect</button>
</div>

<div id="terminal"></div>

<script type="module">
import{Terminal}from'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
import{FitAddon}from'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';
import{WebLinksAddon}from'https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/+esm';

// ── Port forwarding config (injected by daemon) ────────────────────────
const SLUG = '%s';
const DOMAIN = '%s';

// ── Localhost URL rewriting ─────────────────────────────────────────────
// Matches: http://localhost:PORT, http://127.0.0.1:PORT, http://0.0.0.0:PORT
// Also matches bare localhost:PORT without protocol
const LOCAL_URL_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})([\/\w\-.~:?#[\]@!$&'()*+,;=]*)?/g;

function rewriteLocalUrl(match, port, path) {
  const p = parseInt(port, 10);
  if (p <= 0 || p > 65535 || p === 22 || p === 80 || p === 7777) return null;
  return 'https://' + p + '--' + SLUG + '.' + DOMAIN + (path || '');
}

// Custom link provider that detects localhost URLs and opens the port-forwarded URL
class LocalhostLinkProvider {
  provideLinks(y, callback) {
    const term = window._term;
    if (!term) { callback(undefined); return; }
    const line = term.buffer.active.getLine(y - 1);
    if (!line) { callback(undefined); return; }
    const text = line.translateToString(true);
    const links = [];
    let m;
    LOCAL_URL_RE.lastIndex = 0;
    while ((m = LOCAL_URL_RE.exec(text)) !== null) {
      const url = rewriteLocalUrl(m[0], m[1], m[2]);
      if (!url) continue;
      links.push({
        range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
        text: url,
        activate: () => window.open(url, '_blank'),
        tooltip: url,
      });
    }
    callback(links.length > 0 ? links : undefined);
  }
}

// Detect if we're in an iframe
const inIframe = window.self !== window.top;
if (!inIframe) document.body.classList.add('standalone');

const badge = document.getElementById('badge');
const reconnectBtn = document.getElementById('reconnect-btn');

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  lineHeight: 1.2,
  scrollback: 10000,
  allowProposedApi: true,
  theme: {
    background: '#09090b',
    foreground: '#e4e4e7',
    cursor: '#a1a1aa',
    cursorAccent: '#09090b',
    selectionBackground: 'rgba(161, 161, 170, 0.3)',
    black: '#09090b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#e4e4e7',
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#fafafa',
  },
});
window._term = term;

const fit = new FitAddon();
term.loadAddon(fit);
term.loadAddon(new WebLinksAddon());
// Register localhost URL rewriting (Port → PORT--SLUG.DOMAIN)
if (SLUG && DOMAIN) {
  term.registerLinkProvider(new LocalhostLinkProvider());
}
term.open(document.getElementById('terminal'));
fit.fit();

let ws = null;
let connected = false;

function setConnected(state) {
  connected = state;
  badge.className = 'badge ' + (state ? 'connected' : 'disconnected');
  badge.textContent = state ? 'Connected' : 'Disconnected';
  reconnectBtn.style.display = state ? 'none' : 'inline-block';
}

function sendResize() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

function connect() {
  if (ws) { try { ws.close(); } catch {} }

  // Build WebSocket URL — same host, /_pty path
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl = proto + '//' + location.host + '/_pty';

  // Forward any token from our URL params (CF Worker auth)
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) wsUrl += '?token=' + encodeURIComponent(token);

  badge.textContent = 'Connecting...';
  badge.className = 'badge disconnected';

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setConnected(true);
    sendResize();
    term.focus();
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') term.write(msg.data);
      else if (msg.type === 'error') term.write('\r\n\x1b[31m' + msg.data + '\x1b[0m\r\n');
      else if (msg.type === 'exit') {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        setConnected(false);
      }
    } catch { term.write(e.data); }
  };

  ws.onclose = () => setConnected(false);
  ws.onerror = () => {
    term.write('\r\n\x1b[31mConnection failed.\x1b[0m\r\n');
    setConnected(false);
  };

  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });
}

// Auto-fit on resize
const ro = new ResizeObserver(() => {
  try { fit.fit(); sendResize(); } catch {}
});
ro.observe(document.getElementById('terminal'));

// Reconnect button
reconnectBtn.addEventListener('click', () => {
  term.clear();
  connect();
});

// Listen for resize messages from parent (iframe integration)
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'focus') term.focus();
});

// Initial connection
connect();
</script>
</body>
</html>`, slug, domain)
}

func handleTerminalPage(w http.ResponseWriter, r *http.Request, cfg *Config) {
	domain := cfg.ProxyDomain
	if domain == "" {
		domain = "kortix.cloud"
	}
	// Sanitize slug for safe embedding in JS string literal
	slug := strings.ReplaceAll(cfg.Slug, "'", "")
	slug = strings.ReplaceAll(slug, "\\", "")
	domain = strings.ReplaceAll(domain, "'", "")
	domain = strings.ReplaceAll(domain, "\\", "")

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	// Allow iframe embedding from any origin (the dashboard embeds this)
	w.Header().Set("X-Frame-Options", "ALLOWALL")
	w.Header().Del("X-Frame-Options")
	w.Write([]byte(buildTerminalHTML(slug, domain)))
}
