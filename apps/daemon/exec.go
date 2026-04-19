// Process/Exec API — command execution and process management.
//
// Routes (all under /toolbox/process/):
//   POST /toolbox/process/execute        — run command (sync, capture output)
//   POST /toolbox/process/execute/stream  — run command (SSE streaming output)
//   POST /toolbox/process/code-run       — run code snippet in a language
//   GET  /toolbox/process/list           — list running processes
//   POST /toolbox/process/kill           — kill a process by PID
//   POST /toolbox/process/stdin          — send data to a tracked process (future)

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// NewToolboxProcess creates the HTTP mux for process routes.
func NewToolboxProcess() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /toolbox/process/execute", handleExecuteCommand)
	mux.HandleFunc("POST /toolbox/process/execute/stream", handleExecuteStream)
	mux.HandleFunc("POST /toolbox/process/code-run", handleCodeRun)
	mux.HandleFunc("GET /toolbox/process/list", handleListProcesses)
	mux.HandleFunc("POST /toolbox/process/kill", handleKillProcess)

	return mux
}

// ── Types ────────────────────────────────────────────────────────────────

type executeRequest struct {
	Command string            `json:"command"`
	Cwd     string            `json:"cwd"`
	Timeout int               `json:"timeout"` // seconds
	Env     map[string]string `json:"env"`
	User    string            `json:"user"`
}

type executeResult struct {
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
}

type codeRunRequest struct {
	Code     string            `json:"code"`
	Language string            `json:"language"`
	Timeout  int               `json:"timeout"`
	Env      map[string]string `json:"env"`
}

type processInfo struct {
	PID            int    `json:"pid"`
	Command        string `json:"command"`
	Args           string `json:"args"`
	Cwd            string `json:"cwd"`
	User           string `json:"user"`
	State          string `json:"state"`
	MemoryRSSBytes int64  `json:"memory_rss_bytes"`
	StartedAt      string `json:"started_at,omitempty"`
}

// ── Helpers ──────────────────────────────────────────────────────────────

func execError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
		"code":  code,
	})
}

func buildCommand(command, cwd string, timeout int, env map[string]string) (*exec.Cmd, context.CancelFunc) {
	timeoutDuration := time.Duration(timeout) * time.Second
	if timeoutDuration <= 0 {
		timeoutDuration = 60 * time.Second
	}
	if timeoutDuration > 3600*time.Second {
		timeoutDuration = 3600 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeoutDuration)
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", command)

	if cwd != "" {
		cmd.Dir = cwd
	}

	// Build environment: inherit current + add custom
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	return cmd, cancel
}

// ── POST /toolbox/process/execute — Synchronous execution ───────────────

func handleExecuteCommand(w http.ResponseWriter, r *http.Request) {
	var req executeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		execError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Command == "" {
		execError(w, 400, "BAD_REQUEST", "command is required")
		return
	}

	if req.Timeout == 0 {
		req.Timeout = 60
	}

	cmd, cancel := buildCommand(req.Command, req.Cwd, req.Timeout, req.Env)
	defer cancel()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start).Milliseconds()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if r.Context().Err() == context.DeadlineExceeded {
			execError(w, 408, "TIMEOUT", fmt.Sprintf("command timed out after %ds", req.Timeout))
			return
		} else {
			execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to execute: %v", err))
			return
		}
	}

	writeJSON(w, 200, executeResult{
		ExitCode:   exitCode,
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		DurationMs: duration,
	})
}

// ── POST /toolbox/process/execute/stream — SSE streaming execution ──────

func handleExecuteStream(w http.ResponseWriter, r *http.Request) {
	var req executeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		execError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Command == "" {
		execError(w, 400, "BAD_REQUEST", "command is required")
		return
	}

	if req.Timeout == 0 {
		req.Timeout = 60
	}

	cmd, cancel := buildCommand(req.Command, req.Cwd, req.Timeout, req.Env)
	defer cancel()

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to create stdout pipe: %v", err))
		return
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to create stderr pipe: %v", err))
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		execError(w, 500, "INTERNAL_ERROR", "streaming not supported")
		return
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to start: %v", err))
		return
	}

	sendSSE := func(event, data string) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		flusher.Flush()
	}

	// Stream stdout
	done := make(chan struct{})
	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024) // 1MB line buffer
		for scanner.Scan() {
			line := scanner.Text()
			data, _ := json.Marshal(map[string]string{"data": line + "\n"})
			sendSSE("stdout", string(data))
		}
		done <- struct{}{}
	}()

	// Stream stderr
	go func() {
		scanner := bufio.NewScanner(stderrPipe)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			data, _ := json.Marshal(map[string]string{"data": line + "\n"})
			sendSSE("stderr", string(data))
		}
		done <- struct{}{}
	}()

	// Wait for both pipes to close
	<-done
	<-done

	err = cmd.Wait()
	duration := time.Since(start).Milliseconds()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	exitData, _ := json.Marshal(map[string]any{
		"exit_code":   exitCode,
		"duration_ms": duration,
	})
	sendSSE("exit", string(exitData))
}

// ── POST /toolbox/process/code-run — Run code snippet ───────────────────

func handleCodeRun(w http.ResponseWriter, r *http.Request) {
	var req codeRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		execError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Code == "" {
		execError(w, 400, "BAD_REQUEST", "code is required")
		return
	}
	if req.Timeout == 0 {
		req.Timeout = 30
	}

	// Determine interpreter
	lang := strings.ToLower(req.Language)
	if lang == "" {
		lang = detectLanguage(req.Code)
	}

	var command string
	var needsTempFile bool
	var tempExt string

	switch lang {
	case "python", "python3", "py":
		command = fmt.Sprintf("python3 -c %s", shellQuote(req.Code))
	case "node", "javascript", "js", "typescript", "ts":
		command = fmt.Sprintf("node -e %s", shellQuote(req.Code))
	case "bash", "shell", "sh":
		command = fmt.Sprintf("/bin/bash -c %s", shellQuote(req.Code))
	case "ruby", "rb":
		command = fmt.Sprintf("ruby -e %s", shellQuote(req.Code))
	case "go", "golang":
		needsTempFile = true
		tempExt = ".go"
	default:
		// Default to bash
		command = fmt.Sprintf("/bin/bash -c %s", shellQuote(req.Code))
	}

	if needsTempFile {
		tmpDir, err := os.MkdirTemp("", "coderun-*")
		if err != nil {
			execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to create temp dir: %v", err))
			return
		}
		defer os.RemoveAll(tmpDir)

		tmpFile := filepath.Join(tmpDir, "main"+tempExt)
		if err := os.WriteFile(tmpFile, []byte(req.Code), 0644); err != nil {
			execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to write temp file: %v", err))
			return
		}

		switch lang {
		case "go", "golang":
			command = fmt.Sprintf("go run %s", tmpFile)
		}
	}

	cmd, cancel := buildCommand(command, "", req.Timeout, req.Env)
	defer cancel()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start).Milliseconds()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if r.Context().Err() == context.DeadlineExceeded {
			execError(w, 408, "TIMEOUT", fmt.Sprintf("code execution timed out after %ds", req.Timeout))
			return
		}
	}

	writeJSON(w, 200, executeResult{
		ExitCode:   exitCode,
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		DurationMs: duration,
	})
}

// shellQuote wraps a string in single quotes, escaping internal single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

// detectLanguage tries to guess the language from code content.
func detectLanguage(code string) string {
	trimmed := strings.TrimSpace(code)
	if strings.HasPrefix(trimmed, "#!/usr/bin/env python") || strings.HasPrefix(trimmed, "#!/usr/bin/python") {
		return "python"
	}
	if strings.HasPrefix(trimmed, "#!/usr/bin/env node") || strings.HasPrefix(trimmed, "#!/usr/bin/node") {
		return "node"
	}
	if strings.HasPrefix(trimmed, "#!/") {
		return "bash"
	}
	if strings.Contains(trimmed, "def ") || strings.Contains(trimmed, "import ") || strings.Contains(trimmed, "print(") {
		return "python"
	}
	if strings.Contains(trimmed, "console.log") || strings.Contains(trimmed, "const ") || strings.Contains(trimmed, "function ") {
		return "node"
	}
	if strings.HasPrefix(trimmed, "package ") {
		return "go"
	}
	return "bash"
}

// ── GET /toolbox/process/list — List running processes ──────────────────

func handleListProcesses(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" {
		// Fallback for non-Linux (e.g. macOS dev)
		handleListProcessesFallback(w, r)
		return
	}

	entries, err := os.ReadDir("/proc")
	if err != nil {
		execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("cannot read /proc: %v", err))
		return
	}

	processes := []processInfo{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue // Not a PID directory
		}

		proc := readProcInfo(pid)
		if proc == nil {
			continue
		}
		processes = append(processes, *proc)

		if len(processes) >= 500 {
			break
		}
	}

	writeJSON(w, 200, map[string]any{"processes": processes})
}

func readProcInfo(pid int) *processInfo {
	// Read /proc/[pid]/stat
	statPath := fmt.Sprintf("/proc/%d/stat", pid)
	statData, err := os.ReadFile(statPath)
	if err != nil {
		return nil
	}

	// Parse stat — format: pid (comm) state ppid ...
	statStr := string(statData)
	// Find the command name in parentheses
	openParen := strings.Index(statStr, "(")
	closeParen := strings.LastIndex(statStr, ")")
	if openParen < 0 || closeParen < 0 {
		return nil
	}

	comm := statStr[openParen+1 : closeParen]
	rest := strings.Fields(statStr[closeParen+2:])
	if len(rest) < 2 {
		return nil
	}
	state := rest[0]

	// Skip kernel threads (state Z = zombie, X = dead)
	if state == "Z" || state == "X" {
		return nil
	}

	// Read /proc/[pid]/cmdline
	cmdlinePath := fmt.Sprintf("/proc/%d/cmdline", pid)
	cmdlineData, _ := os.ReadFile(cmdlinePath)
	cmdline := strings.ReplaceAll(string(cmdlineData), "\x00", " ")
	cmdline = strings.TrimSpace(cmdline)
	if cmdline == "" {
		cmdline = "[" + comm + "]" // Kernel thread
	}

	// Read /proc/[pid]/cwd
	cwdPath := fmt.Sprintf("/proc/%d/cwd", pid)
	cwd, _ := os.Readlink(cwdPath)

	// Read /proc/[pid]/status for memory and user info
	statusPath := fmt.Sprintf("/proc/%d/status", pid)
	statusData, _ := os.ReadFile(statusPath)
	var rssKb int64
	var userName string
	for _, line := range strings.Split(string(statusData), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				rssKb, _ = strconv.ParseInt(fields[1], 10, 64)
			}
		}
		if strings.HasPrefix(line, "Uid:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				uid := fields[1]
				if u, err := user.LookupId(uid); err == nil {
					userName = u.Username
				} else {
					userName = uid
				}
			}
		}
	}

	return &processInfo{
		PID:            pid,
		Command:        cmdline,
		Args:           cmdline,
		Cwd:            cwd,
		User:           userName,
		State:          state,
		MemoryRSSBytes: rssKb * 1024,
	}
}

// handleListProcessesFallback uses `ps` for non-Linux systems (macOS dev).
func handleListProcessesFallback(w http.ResponseWriter, r *http.Request) {
	cmd := exec.Command("ps", "aux")
	out, err := cmd.Output()
	if err != nil {
		execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("ps failed: %v", err))
		return
	}

	lines := strings.Split(string(out), "\n")
	processes := []processInfo{}

	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue // Skip header
		}
		fields := strings.Fields(line)
		if len(fields) < 11 {
			continue
		}
		pid, _ := strconv.Atoi(fields[1])
		cmdStr := strings.Join(fields[10:], " ")

		processes = append(processes, processInfo{
			PID:     pid,
			Command: cmdStr,
			Args:    cmdStr,
			User:    fields[0],
			State:   fields[7],
		})
	}

	writeJSON(w, 200, map[string]any{"processes": processes})
}

// ── POST /toolbox/process/kill — Kill a process ─────────────────────────

func handleKillProcess(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PID    int    `json:"pid"`
		Signal string `json:"signal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		execError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if body.PID <= 0 {
		execError(w, 400, "BAD_REQUEST", "valid pid is required")
		return
	}

	// Safety: don't allow killing PID 1 or our own process
	if body.PID == 1 || body.PID == os.Getpid() {
		execError(w, 403, "PERMISSION_DENIED", "cannot kill system or daemon process")
		return
	}

	sig := syscall.SIGTERM
	switch strings.ToUpper(body.Signal) {
	case "SIGKILL", "KILL":
		sig = syscall.SIGKILL
	case "SIGINT", "INT":
		sig = syscall.SIGINT
	case "SIGHUP", "HUP":
		sig = syscall.SIGHUP
	case "SIGTERM", "TERM", "":
		sig = syscall.SIGTERM
	default:
		execError(w, 400, "BAD_REQUEST", "unsupported signal: "+body.Signal)
		return
	}

	proc, err := os.FindProcess(body.PID)
	if err != nil {
		execError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("process %d not found", body.PID))
		return
	}

	if err := proc.Signal(sig); err != nil {
		if err == os.ErrProcessDone {
			execError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("process %d already exited", body.PID))
		} else {
			execError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to signal process: %v", err))
		}
		return
	}

	sigName := body.Signal
	if sigName == "" {
		sigName = "SIGTERM"
	}

	log.Printf("[EXEC] Killed PID %d with %s", body.PID, sigName)
	writeJSON(w, 200, map[string]any{
		"killed": true,
		"pid":    body.PID,
		"signal": sigName,
	})
}
