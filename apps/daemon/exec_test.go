package main

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
)

// helper: creates the toolbox process handler and makes a request
func execRequest(method, path string, body io.Reader) *httptest.ResponseRecorder {
	handler := NewToolboxProcess()
	req := httptest.NewRequest(method, path, body)
	if body != nil && method == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func decodeExecJSON(t *testing.T, body io.Reader) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.NewDecoder(body).Decode(&result); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	return result
}

// ── Execute Command Tests ───────────────────────────────────────────────

func TestExecuteCommandSimple(t *testing.T) {
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(`{"command":"echo hello"}`))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	if int(result["exit_code"].(float64)) != 0 {
		t.Errorf("expected exit_code 0, got %v", result["exit_code"])
	}
	stdout := result["stdout"].(string)
	if !strings.Contains(stdout, "hello") {
		t.Errorf("expected stdout to contain 'hello', got '%s'", stdout)
	}
	if result["duration_ms"].(float64) < 0 {
		t.Errorf("expected non-negative duration")
	}
}

func TestExecuteCommandStderr(t *testing.T) {
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(`{"command":"echo err_msg >&2"}`))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	stderr := result["stderr"].(string)
	if !strings.Contains(stderr, "err_msg") {
		t.Errorf("expected stderr to contain 'err_msg', got '%s'", stderr)
	}
}

func TestExecuteCommandExitCode(t *testing.T) {
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(`{"command":"exit 42"}`))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	if int(result["exit_code"].(float64)) != 42 {
		t.Errorf("expected exit_code 42, got %v", result["exit_code"])
	}
}

func TestExecuteCommandWithCwd(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/cwd-test.txt", []byte("x"), 0644)

	body := `{"command":"ls cwd-test.txt","cwd":"` + dir + `"}`
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	if int(result["exit_code"].(float64)) != 0 {
		t.Errorf("expected exit_code 0 with cwd, got %v (stderr: %s)", result["exit_code"], result["stderr"])
	}
}

func TestExecuteCommandWithEnv(t *testing.T) {
	body := `{"command":"echo $MY_TEST_VAR","env":{"MY_TEST_VAR":"test_value_123"}}`
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	stdout := result["stdout"].(string)
	if !strings.Contains(stdout, "test_value_123") {
		t.Errorf("expected stdout to contain 'test_value_123', got '%s'", stdout)
	}
}

func TestExecuteCommandTimeout(t *testing.T) {
	body := `{"command":"sleep 10","timeout":1}`
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	// Should return 408 timeout or 200 with signal exit code
	if w.Code != 408 && w.Code != 200 {
		t.Fatalf("expected 408 or 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestExecuteCommandEmptyCommand(t *testing.T) {
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(`{"command":""}`))
	if w.Code != 400 {
		t.Fatalf("expected 400 for empty command, got %d", w.Code)
	}
}

func TestExecuteCommandInvalidJSON(t *testing.T) {
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(`{invalid`))
	if w.Code != 400 {
		t.Fatalf("expected 400 for invalid JSON, got %d", w.Code)
	}
}

func TestExecuteCommandMultiLine(t *testing.T) {
	body := `{"command":"echo line1 && echo line2 && echo line3"}`
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeExecJSON(t, w.Body)
	stdout := result["stdout"].(string)
	if !strings.Contains(stdout, "line1") || !strings.Contains(stdout, "line2") || !strings.Contains(stdout, "line3") {
		t.Errorf("expected all 3 lines in stdout, got '%s'", stdout)
	}
}

func TestExecuteCommandPipe(t *testing.T) {
	body := `{"command":"echo 'abc def ghi' | wc -w"}`
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeExecJSON(t, w.Body)
	stdout := strings.TrimSpace(result["stdout"].(string))
	if stdout != "3" {
		t.Errorf("expected word count '3', got '%s'", stdout)
	}
}

// ── Execute Stream Tests ────────────────────────────────────────────────

func TestExecuteStream(t *testing.T) {
	body := `{"command":"echo stream_line_1 && echo stream_line_2"}`
	w := execRequest("POST", "/toolbox/process/execute/stream", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	ct := w.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Errorf("expected Content-Type text/event-stream, got '%s'", ct)
	}

	responseBody := w.Body.String()
	if !strings.Contains(responseBody, "event: stdout") {
		t.Errorf("expected SSE stdout events, got: %s", responseBody)
	}
	if !strings.Contains(responseBody, "event: exit") {
		t.Errorf("expected SSE exit event, got: %s", responseBody)
	}
	if !strings.Contains(responseBody, "stream_line_1") {
		t.Errorf("expected stream_line_1 in output")
	}
}

func TestExecuteStreamStderr(t *testing.T) {
	body := `{"command":"echo stderr_test >&2"}`
	w := execRequest("POST", "/toolbox/process/execute/stream", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	responseBody := w.Body.String()
	if !strings.Contains(responseBody, "event: stderr") {
		t.Errorf("expected SSE stderr event, got: %s", responseBody)
	}
	if !strings.Contains(responseBody, "stderr_test") {
		t.Errorf("expected 'stderr_test' in stderr output")
	}
}

// ── Code Run Tests ──────────────────────────────────────────────────────

func TestCodeRunBash(t *testing.T) {
	body := `{"code":"echo 'bash_output_42'","language":"bash"}`
	w := execRequest("POST", "/toolbox/process/code-run", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	stdout := result["stdout"].(string)
	if !strings.Contains(stdout, "bash_output_42") {
		t.Errorf("expected stdout to contain 'bash_output_42', got '%s'", stdout)
	}
	if int(result["exit_code"].(float64)) != 0 {
		t.Errorf("expected exit_code 0, got %v", result["exit_code"])
	}
}

func TestCodeRunAutoDetectBash(t *testing.T) {
	body := `{"code":"#!/bin/bash\necho auto_bash"}`
	w := execRequest("POST", "/toolbox/process/code-run", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeExecJSON(t, w.Body)
	stdout := result["stdout"].(string)
	if !strings.Contains(stdout, "auto_bash") {
		t.Errorf("expected 'auto_bash' in stdout, got '%s'", stdout)
	}
}

func TestCodeRunEmptyCode(t *testing.T) {
	body := `{"code":"","language":"bash"}`
	w := execRequest("POST", "/toolbox/process/code-run", strings.NewReader(body))
	if w.Code != 400 {
		t.Fatalf("expected 400 for empty code, got %d", w.Code)
	}
}

func TestCodeRunWithEnv(t *testing.T) {
	body := `{"code":"echo $CODE_RUN_VAR","language":"bash","env":{"CODE_RUN_VAR":"env_works"}}`
	w := execRequest("POST", "/toolbox/process/code-run", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	if !strings.Contains(result["stdout"].(string), "env_works") {
		t.Errorf("expected env_works in stdout")
	}
}

func TestCodeRunExitCode(t *testing.T) {
	body := `{"code":"exit 7","language":"bash"}`
	w := execRequest("POST", "/toolbox/process/code-run", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeExecJSON(t, w.Body)
	if int(result["exit_code"].(float64)) != 7 {
		t.Errorf("expected exit_code 7, got %v", result["exit_code"])
	}
}

// ── List Processes Tests ────────────────────────────────────────────────

func TestListProcesses(t *testing.T) {
	w := execRequest("GET", "/toolbox/process/list", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeExecJSON(t, w.Body)
	processes, ok := result["processes"].([]any)
	if !ok {
		t.Fatal("expected processes array")
	}
	if len(processes) == 0 {
		t.Error("expected at least 1 process (ourselves)")
	}

	// Verify process entries have required fields
	proc := processes[0].(map[string]any)
	if _, ok := proc["pid"]; !ok {
		t.Error("process entry missing 'pid'")
	}
	if _, ok := proc["command"]; !ok {
		t.Error("process entry missing 'command'")
	}
}

// ── Kill Process Tests ──────────────────────────────────────────────────

func TestKillProcessProtectedPID1(t *testing.T) {
	body := `{"pid":1,"signal":"SIGTERM"}`
	w := execRequest("POST", "/toolbox/process/kill", strings.NewReader(body))
	if w.Code != 403 {
		t.Fatalf("expected 403 for PID 1, got %d", w.Code)
	}
}

func TestKillProcessProtectedSelf(t *testing.T) {
	pid := os.Getpid()
	body := `{"pid":` + strings.TrimSpace(func() string { s, _ := json.Marshal(pid); return string(s) }()) + `,"signal":"SIGTERM"}`
	w := execRequest("POST", "/toolbox/process/kill", strings.NewReader(body))
	if w.Code != 403 {
		t.Fatalf("expected 403 for own PID, got %d", w.Code)
	}
}

func TestKillProcessInvalidPID(t *testing.T) {
	body := `{"pid":0,"signal":"SIGTERM"}`
	w := execRequest("POST", "/toolbox/process/kill", strings.NewReader(body))
	if w.Code != 400 {
		t.Fatalf("expected 400 for PID 0, got %d", w.Code)
	}
}

func TestKillProcessInvalidSignal(t *testing.T) {
	body := `{"pid":99999,"signal":"SIGFOO"}`
	w := execRequest("POST", "/toolbox/process/kill", strings.NewReader(body))
	if w.Code != 400 {
		t.Fatalf("expected 400 for invalid signal, got %d", w.Code)
	}
}

func TestKillProcessNonexistent(t *testing.T) {
	// PID 99999999 almost certainly doesn't exist
	body := `{"pid":99999999,"signal":"SIGTERM"}`
	w := execRequest("POST", "/toolbox/process/kill", strings.NewReader(body))
	// Should return 404 or 500 (process not found or signal error)
	if w.Code != 404 && w.Code != 500 {
		t.Fatalf("expected 404 or 500 for nonexistent PID, got %d", w.Code)
	}
}

// ── Shell Quoting Tests ─────────────────────────────────────────────────

func TestShellQuote(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello", "'hello'"},
		{"hello world", "'hello world'"},
		{"it's", "'it'\"'\"'s'"},
		{"", "''"},
	}

	for _, tt := range tests {
		result := shellQuote(tt.input)
		if result != tt.expected {
			t.Errorf("shellQuote(%q) = %q, expected %q", tt.input, result, tt.expected)
		}
	}
}

// ── Language Detection Tests ────────────────────────────────────────────

func TestDetectLanguage(t *testing.T) {
	tests := []struct {
		code     string
		expected string
	}{
		{"#!/usr/bin/env python3\nprint('hi')", "python"},
		{"#!/usr/bin/env node\nconsole.log('hi')", "node"},
		{"#!/bin/bash\necho hi", "bash"},
		{"print('hello')", "python"},
		{"console.log('hello')", "node"},
		{"package main", "go"},
		{"echo hello", "bash"},
	}

	for _, tt := range tests {
		result := detectLanguage(tt.code)
		if result != tt.expected {
			t.Errorf("detectLanguage(%q) = %q, expected %q", tt.code[:min(len(tt.code), 30)], result, tt.expected)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ── Execute + Filesystem Integration E2E ────────────────────────────────

func TestExecPlusFilesystemE2E(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("skipping on non-unix")
	}

	dir := t.TempDir()

	// 1. Create a file using exec
	body := `{"command":"echo 'created via exec' > ` + dir + `/exec-created.txt"}`
	w := execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("exec failed: %d %s", w.Code, w.Body.String())
	}

	// 2. Verify via filesystem API
	fsHandler := NewToolboxFS()
	req := httptest.NewRequest("GET", "/toolbox/files/exists?path="+dir+"/exec-created.txt", nil)
	wFs := httptest.NewRecorder()
	fsHandler.ServeHTTP(wFs, req)

	result := decodeExecJSON(t, wFs.Body)
	if result["exists"] != true {
		t.Error("file created via exec should exist")
	}

	// 3. Read the file via filesystem download
	req = httptest.NewRequest("GET", "/toolbox/files/download?path="+dir+"/exec-created.txt", nil)
	wFs = httptest.NewRecorder()
	fsHandler.ServeHTTP(wFs, req)

	content := strings.TrimSpace(wFs.Body.String())
	if content != "created via exec" {
		t.Errorf("expected 'created via exec', got '%s'", content)
	}

	// 4. Use exec to count files
	body = `{"command":"ls ` + dir + ` | wc -l"}`
	w = execRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	result = decodeExecJSON(t, w.Body)
	count := strings.TrimSpace(result["stdout"].(string))
	if count != "1" {
		t.Errorf("expected 1 file, got '%s'", count)
	}
}
