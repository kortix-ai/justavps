// Self-updater — downloads a new daemon binary and restarts via systemd.
//
// Flow:
//   1. Heartbeat response includes { update: { version, url } }
//   2. Daemon compares version to current (main.version)
//   3. Downloads new binary to /tmp/justavps-daemon-update
//   4. Validates it runs (--version check)
//   5. Atomically replaces /usr/local/bin/justavps-daemon
//   6. Triggers systemd restart (daemon stops, systemd starts new binary)
//
// Safety:
//   - Only updates if new version differs from current
//   - Validates the downloaded binary before replacing
//   - Keeps old binary as .bak for rollback
//   - Cooldown prevents update storms (min 60s between attempts)
//   - Logs everything for debugging

package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	daemonBinaryPath = "/usr/local/bin/justavps-daemon"
	updateTmpPath    = "/tmp/justavps-daemon-update"
	updateCooldown   = 60 * time.Second
)

// UpdateInstruction is received from the platform heartbeat response.
type UpdateInstruction struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

// Updater handles daemon self-updates.
type Updater struct {
	mu              sync.Mutex
	lastAttempt     time.Time
	updating        bool
	skippedVersion  string
}

func NewUpdater() *Updater {
	return &Updater{}
}

// MaybeUpdate checks if an update is needed and performs it.
// Called from the heartbeat goroutine — runs the update in background.
func (u *Updater) MaybeUpdate(instruction UpdateInstruction) {
	if instruction.Version == "" || instruction.URL == "" {
		return
	}

	// Same version — skip
	if instruction.Version == version {
		return
	}

	u.mu.Lock()
	if instruction.Version == u.skippedVersion {
		u.mu.Unlock()
		return
	}
	if u.updating || time.Since(u.lastAttempt) < updateCooldown {
		u.mu.Unlock()
		return
	}
	u.updating = true
	u.lastAttempt = time.Now()
	u.mu.Unlock()

	go func() {
		defer func() {
			u.mu.Lock()
			u.updating = false
			u.mu.Unlock()
		}()

		log.Printf("[UPDATE] Starting update: %s → %s", version, instruction.Version)

		if err := u.performUpdate(instruction); err != nil {
			log.Printf("[UPDATE] Failed: %v", err)
			return
		}

		log.Printf("[UPDATE] Success — restarting daemon")
		u.restart()
	}()
}

func (u *Updater) performUpdate(inst UpdateInstruction) error {
	// 1. Download new binary
	log.Printf("[UPDATE] Downloading %s", inst.URL)
	if err := downloadFile(inst.URL, updateTmpPath); err != nil {
		return fmt.Errorf("download: %w", err)
	}

	// 2. Make executable
	if err := os.Chmod(updateTmpPath, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// 3. Validate — the new binary should respond to --version AND match expected version
	out, err := exec.Command(updateTmpPath, "--version").CombinedOutput()
	if err != nil {
		os.Remove(updateTmpPath)
		return fmt.Errorf("validation failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	versionOutput := strings.TrimSpace(string(out))
	log.Printf("[UPDATE] Validated new binary: %s", versionOutput)

	if !strings.Contains(versionOutput, inst.Version) {
		os.Remove(updateTmpPath)
		u.mu.Lock()
		u.skippedVersion = inst.Version
		u.mu.Unlock()
		return fmt.Errorf("version mismatch: expected %s, binary reports %s — aborting update (will not retry this version)", inst.Version, versionOutput)
	}

	// 4. Backup current binary
	backupPath := daemonBinaryPath + ".bak"
	if err := copyFile(daemonBinaryPath, backupPath); err != nil {
		log.Printf("[UPDATE] Warning: backup failed: %v (continuing anyway)", err)
	}

	// 5. Atomic replace — rename tmp → target
	if err := os.Rename(updateTmpPath, daemonBinaryPath); err != nil {
		// Rename across filesystems fails, fall back to copy
		if err2 := copyFile(updateTmpPath, daemonBinaryPath); err2 != nil {
			return fmt.Errorf("replace binary: %w", err2)
		}
		os.Remove(updateTmpPath)
	}

	if err := os.Chmod(daemonBinaryPath, 0755); err != nil {
		return fmt.Errorf("chmod final: %w", err)
	}

	return nil
}

func (u *Updater) restart() {
	// systemctl restart justavps-daemon
	// This kills the current process. systemd will start the new binary.
	cmd := exec.Command("systemctl", "restart", "justavps-daemon")
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("[UPDATE] systemctl restart failed: %v (output: %s)", err, strings.TrimSpace(string(out)))
		// Fallback: exit and let systemd Restart=always handle it
		log.Printf("[UPDATE] Falling back to exit(0) for systemd restart")
		os.Exit(0)
	}
}

func downloadFile(url, dest string) error {
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	n, err := io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	log.Printf("[UPDATE] Downloaded %d bytes", n)
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
