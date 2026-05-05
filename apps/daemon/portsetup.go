// Port forwarding setup — generates shell integration scripts.
//
// On daemon startup, writes /etc/profile.d/justavps-ports.sh and /usr/local/bin/porturl.
// These provide:
//   - JUSTAVPS_PORT_URL env var (URL template for port forwarding)
//   - `porturl` command to print the public URL for a given port
//   - Login banner showing port URL pattern
//   - Optional background port notification watcher
//
// Works for SSH, web terminal, and any interactive shell session.

package main

import (
	"log"
	"os"
	"strings"
)

// SetupPortForwarding writes shell integration scripts to the filesystem.
// Called once at daemon startup.
func SetupPortForwarding(cfg *Config) error {
	template := cfg.PortURLTemplate()

	// Write /etc/profile.d/justavps-ports.sh — sourced on every login
	profileScript := generateProfileScript(cfg.Slug, template)
	if err := os.MkdirAll("/etc/profile.d", 0755); err != nil {
		return err
	}
	if err := os.WriteFile("/etc/profile.d/justavps-ports.sh", []byte(profileScript), 0644); err != nil {
		return err
	}

	// Write /usr/local/bin/porturl — standalone CLI command
	porturlScript := generatePorturlScript(cfg.Slug, template)
	if err := os.WriteFile("/usr/local/bin/porturl", []byte(porturlScript), 0755); err != nil {
		return err
	}

	// Ensure event directory exists
	os.MkdirAll("/run/justavps", 0755)

	log.Printf("[ports] Shell integration installed (slug=%s, template=%s)", cfg.Slug, template)
	return nil
}

func generateProfileScript(slug, template string) string {
	script := `# JustAVPS port forwarding integration
# Sourced automatically on login — provides port URL helpers and notifications.
#
# Services on this machine are accessible via:
#   __TEMPLATE_DISPLAY__
#
# Commands:
#   porturl PORT     — Print the public URL for a port
#   porturl          — List all currently listening ports with URLs
#   portwatch        — Watch for new ports in the background (auto-notify)

export JUSTAVPS_SLUG="__SLUG__"
export JUSTAVPS_PORT_URL_TEMPLATE="__TEMPLATE__"

# ── porturl command ──────────────────────────────────────────────────────
porturl() {
  if [ -n "$1" ]; then
    _port="$1"
    printf '%s\n' "$JUSTAVPS_PORT_URL_TEMPLATE" | sed "s/{{port}}/$_port/g; s/{port}/$_port/g"
    return
  fi

  # No arg — list all listening ports
  echo "Listening ports on __SLUG__:"
  echo ""
  ss -tlnp 2>/dev/null | awk -v tmpl="$JUSTAVPS_PORT_URL_TEMPLATE" 'NR>1 {
    split($4, a, ":");
    port = a[length(a)];
    if (port+0 > 0 && port+0 < 49152 && port != 22 && port != 53 && port != 80 && port != 7777 && port != 2468) {
      url = tmpl
      gsub(/\{\{port\}\}/, port, url)
      gsub(/\{port\}/, port, url)
      printf "  \033[1;36m%-6s\033[0m → %s", port, url
      printf "\n"
    }
  }'
  echo ""
}

# ── portwatch — background port notification ─────────────────────────────
portwatch() {
  events="/run/justavps/port-events"
  last_size=0
  [ -f "$events" ] && last_size=$(wc -c < "$events" 2>/dev/null || echo 0)

  echo -e "\033[90m[portwatch] Watching for new ports... (Ctrl+C to stop)\033[0m"

  while true; do
    sleep 2
    [ -f "$events" ] || continue
    cur_size=$(wc -c < "$events" 2>/dev/null || echo 0)
    if [ "$cur_size" -gt "$last_size" ]; then
      tail -c +"$((last_size + 1))" "$events" 2>/dev/null | while IFS=' ' read -r ts action port url rest; do
        if [ "$action" = "open" ]; then
          echo -e "\033[1;32m⚡ Port $port is now available:\033[0m $url"
        elif [ "$action" = "close" ]; then
          echo -e "\033[90m   Port $port closed\033[0m"
        fi
      done
      last_size=$cur_size
    fi
  done
}

# ── Login banner ─────────────────────────────────────────────────────────
# Only show for interactive shells, not scripts/scp
if [ -n "$PS1" ] && [ -z "$JUSTAVPS_BANNER_SHOWN" ]; then
  export JUSTAVPS_BANNER_SHOWN=1

  echo ""
  echo -e "  \033[1;37m⚡ JustAVPS\033[0m — \033[90m__SLUG__\033[0m"
  echo -e "  \033[90m─────────────────────────────────────────\033[0m"
  echo -e "  \033[37mPorts:\033[0m  __TEMPLATE_DISPLAY__"
  echo -e "  \033[37mHelp:\033[0m   \033[33mporturl\033[0m \033[90m[PORT]\033[0m  — get public URL"
  echo ""

  # Show currently active ports if any
  _active_ports=$(ss -tlnp 2>/dev/null | awk 'NR>1 {
    split($4, a, ":");
    port = a[length(a)];
    if (port+0 > 0 && port+0 < 49152 && port != 22 && port != 53 && port != 80 && port != 7777 && port != 2468) print port
  }' | sort -nu | head -5)

  if [ -n "$_active_ports" ]; then
    echo -e "  \033[90mActive ports:\033[0m"
    for _p in $_active_ports; do
      echo -e "    \033[1;36m$_p\033[0m → $(porturl $_p)"
    done
    echo ""
  fi

  # ── Auto-start portwatch in background ──────────────────────────────
  # Silently watches for new ports and prints notifications inline.
  # Killed automatically when the shell exits (subshell + disown).
  _portwatch_events="/run/justavps/port-events"
  (
    _pw_last=0
    [ -f "$_portwatch_events" ] && _pw_last=$(wc -c < "$_portwatch_events" 2>/dev/null || echo 0)
    while kill -0 $$ 2>/dev/null; do
      sleep 2
      [ -f "$_portwatch_events" ] || continue
      _pw_cur=$(wc -c < "$_portwatch_events" 2>/dev/null || echo 0)
      if [ "$_pw_cur" -gt "$_pw_last" ]; then
        tail -c +"$((_pw_last + 1))" "$_portwatch_events" 2>/dev/null | while IFS=' ' read -r _ts _action _port _url _rest; do
          if [ "$_action" = "open" ]; then
            echo -e "\r\033[1;32m⚡ Port $_port is now available:\033[0m $_url"
          fi
        done
        _pw_last=$_pw_cur
      fi
    done
  ) &
  disown $! 2>/dev/null
fi
`
	script = strings.ReplaceAll(script, "__SLUG__", slug)
	script = strings.ReplaceAll(script, "__TEMPLATE__", template)
	script = strings.ReplaceAll(script, "__TEMPLATE_DISPLAY__", strings.ReplaceAll(strings.ReplaceAll(template, "{{port}}", "PORT"), "{port}", "PORT"))
	return script
}

func generatePorturlScript(slug, template string) string {
	script := `#!/bin/bash
# porturl — Print the public URL for a port on this JustAVPS machine.
#
# Usage:
#   porturl 3000       → __EXAMPLE__
#   porturl            → list all listening ports with URLs

SLUG="__SLUG__"
TEMPLATE="__TEMPLATE__"

if [ -n "$1" ]; then
  url="$TEMPLATE"
  url="${url//\{\{port\}\}/$1}"
  url="${url//\{port\}/$1}"
  echo "$url"
  exit 0
fi

# List all listening ports
echo "Listening ports on ${SLUG}:"
echo ""
ss -tlnp 2>/dev/null | awk -v slug="$SLUG" -v tmpl="$TEMPLATE" 'NR>1 {
  split($4, a, ":");
  port = a[length(a)];
  if (port+0 > 0 && port+0 < 49152 && port != 22 && port != 53 && port != 80 && port != 7777 && port != 2468) {
    url = tmpl
    gsub(/\{\{port\}\}/, port, url)
    gsub(/\{port\}/, port, url)
    printf "  \033[1;36m%-6s\033[0m → %s", port, url
    printf "\n"
  }
}'
echo ""
`
	script = strings.ReplaceAll(script, "__SLUG__", slug)
	script = strings.ReplaceAll(script, "__TEMPLATE__", template)
	script = strings.ReplaceAll(script, "__EXAMPLE__", strings.ReplaceAll(strings.ReplaceAll(template, "{{port}}", "3000"), "{port}", "3000"))
	return script
}
