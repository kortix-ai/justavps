package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// helper: creates the toolbox FS handler and makes a request
func fsRequest(method, path string, body io.Reader) *httptest.ResponseRecorder {
	handler := NewToolboxFS()
	req := httptest.NewRequest(method, path, body)
	if body != nil && method == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func fsRequestWithContentType(method, path, ct string, body io.Reader) *httptest.ResponseRecorder {
	handler := NewToolboxFS()
	req := httptest.NewRequest(method, path, body)
	req.Header.Set("Content-Type", ct)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func decodeJSON(t *testing.T, body io.Reader) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.NewDecoder(body).Decode(&result); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	return result
}

// ── List Files Tests ────────────────────────────────────────────────────

func TestListFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello"), 0644)
	os.Mkdir(filepath.Join(dir, "subdir"), 0755)

	w := fsRequest("GET", "/toolbox/files?path="+dir, nil)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	entries, ok := result["entries"].([]any)
	if !ok {
		t.Fatal("expected entries array")
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	// Verify we have both a file and a dir
	foundFile, foundDir := false, false
	for _, e := range entries {
		entry := e.(map[string]any)
		if entry["name"] == "hello.txt" && entry["type"] == "file" {
			foundFile = true
			if entry["size"].(float64) != 5 {
				t.Errorf("expected size 5, got %v", entry["size"])
			}
		}
		if entry["name"] == "subdir" && entry["type"] == "dir" {
			foundDir = true
		}
	}
	if !foundFile {
		t.Error("did not find hello.txt in listing")
	}
	if !foundDir {
		t.Error("did not find subdir in listing")
	}
}

func TestListFilesDefaultPath(t *testing.T) {
	// Should default to /root — may or may not exist depending on system
	w := fsRequest("GET", "/toolbox/files", nil)
	// We accept either 200 (dir exists) or 404 (dir doesn't exist)
	if w.Code != 200 && w.Code != 404 {
		t.Fatalf("expected 200 or 404, got %d", w.Code)
	}
}

func TestListFilesNotADir(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "file.txt")
	os.WriteFile(filePath, []byte("x"), 0644)

	w := fsRequest("GET", "/toolbox/files?path="+filePath, nil)
	if w.Code != 400 {
		t.Fatalf("expected 400 for file path, got %d", w.Code)
	}
}

func TestListFilesNotFound(t *testing.T) {
	w := fsRequest("GET", "/toolbox/files?path=/nonexistent/path/xyz123", nil)
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestListFilesDepth(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a", "b"), 0755)
	os.WriteFile(filepath.Join(dir, "a", "b", "deep.txt"), []byte("deep"), 0644)
	os.WriteFile(filepath.Join(dir, "top.txt"), []byte("top"), 0644)

	// Depth 1 — only top level
	w := fsRequest("GET", "/toolbox/files?path="+dir+"&depth=1", nil)
	result := decodeJSON(t, w.Body)
	entries := result["entries"].([]any)
	if len(entries) != 2 { // top.txt + a/
		t.Fatalf("depth=1: expected 2 entries, got %d", len(entries))
	}

	// Depth 3 — includes nested
	w = fsRequest("GET", "/toolbox/files?path="+dir+"&depth=3", nil)
	result = decodeJSON(t, w.Body)
	entries = result["entries"].([]any)
	if len(entries) < 4 { // top.txt + a/ + a/b/ + a/b/deep.txt
		t.Fatalf("depth=3: expected at least 4 entries, got %d", len(entries))
	}
}

// ── File Info Tests ─────────────────────────────────────────────────────

func TestFileInfo(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "info-test.txt")
	os.WriteFile(filePath, []byte("info content"), 0644)

	w := fsRequest("GET", "/toolbox/files/info?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	if result["name"] != "info-test.txt" {
		t.Errorf("expected name 'info-test.txt', got '%v'", result["name"])
	}
	if result["type"] != "file" {
		t.Errorf("expected type 'file', got '%v'", result["type"])
	}
	if result["size"].(float64) != 12 {
		t.Errorf("expected size 12, got %v", result["size"])
	}
	if result["path"] != filePath {
		t.Errorf("expected path '%s', got '%v'", filePath, result["path"])
	}
}

func TestFileInfoDir(t *testing.T) {
	dir := t.TempDir()

	w := fsRequest("GET", "/toolbox/files/info?path="+dir, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeJSON(t, w.Body)
	if result["type"] != "dir" {
		t.Errorf("expected type 'dir', got '%v'", result["type"])
	}
}

func TestFileInfoNotFound(t *testing.T) {
	w := fsRequest("GET", "/toolbox/files/info?path=/nonexistent/file.xyz", nil)
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestFileInfoMissingPath(t *testing.T) {
	w := fsRequest("GET", "/toolbox/files/info", nil)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── File Exists Tests ───────────────────────────────────────────────────

func TestFileExists(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "exists.txt")
	os.WriteFile(filePath, []byte("x"), 0644)

	w := fsRequest("GET", "/toolbox/files/exists?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	result := decodeJSON(t, w.Body)
	if result["exists"] != true {
		t.Errorf("expected exists=true, got %v", result["exists"])
	}
	if result["type"] != "file" {
		t.Errorf("expected type='file', got %v", result["type"])
	}
}

func TestFileExistsDir(t *testing.T) {
	dir := t.TempDir()

	w := fsRequest("GET", "/toolbox/files/exists?path="+dir, nil)
	result := decodeJSON(t, w.Body)
	if result["exists"] != true {
		t.Errorf("expected exists=true, got %v", result["exists"])
	}
	if result["type"] != "dir" {
		t.Errorf("expected type='dir', got %v", result["type"])
	}
}

func TestFileExistsNotFound(t *testing.T) {
	w := fsRequest("GET", "/toolbox/files/exists?path=/nonexistent/xyz123", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200 (not 404), got %d", w.Code)
	}
	result := decodeJSON(t, w.Body)
	if result["exists"] != false {
		t.Errorf("expected exists=false, got %v", result["exists"])
	}
}

// ── Download File Tests ─────────────────────────────────────────────────

func TestDownloadFile(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "download.txt")
	content := "Hello, this is download content!"
	os.WriteFile(filePath, []byte(content), 0644)

	w := fsRequest("GET", "/toolbox/files/download?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	body := w.Body.String()
	if body != content {
		t.Errorf("expected content '%s', got '%s'", content, body)
	}

	// Check headers
	cd := w.Header().Get("Content-Disposition")
	if !strings.Contains(cd, "download.txt") {
		t.Errorf("expected Content-Disposition to contain filename, got '%s'", cd)
	}
	cl := w.Header().Get("Content-Length")
	if cl != fmt.Sprintf("%d", len(content)) {
		t.Errorf("expected Content-Length %d, got '%s'", len(content), cl)
	}
}

func TestDownloadFileBinary(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "binary.bin")
	binaryData := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}
	os.WriteFile(filePath, binaryData, 0644)

	w := fsRequest("GET", "/toolbox/files/download?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	if !bytes.Equal(w.Body.Bytes(), binaryData) {
		t.Errorf("binary content mismatch")
	}
}

func TestDownloadFileNotFound(t *testing.T) {
	w := fsRequest("GET", "/toolbox/files/download?path=/nonexistent/file.txt", nil)
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDownloadFileDir(t *testing.T) {
	dir := t.TempDir()
	w := fsRequest("GET", "/toolbox/files/download?path="+dir, nil)
	if w.Code != 400 {
		t.Fatalf("expected 400 for directory download, got %d", w.Code)
	}
}

// ── Upload File Tests ───────────────────────────────────────────────────

func TestUploadFile(t *testing.T) {
	dir := t.TempDir()
	targetPath := filepath.Join(dir, "uploaded.txt")
	content := "uploaded content here"

	w := fsRequestWithContentType(
		"POST",
		"/toolbox/files/upload?path="+targetPath,
		"application/octet-stream",
		strings.NewReader(content),
	)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify file was written
	data, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("failed to read uploaded file: %v", err)
	}
	if string(data) != content {
		t.Errorf("expected content '%s', got '%s'", content, string(data))
	}

	// Check response
	result := decodeJSON(t, bytes.NewReader(w.Body.Bytes()))
	if result["path"] != targetPath {
		t.Errorf("expected path '%s', got '%v'", targetPath, result["path"])
	}
	if int(result["size"].(float64)) != len(content) {
		t.Errorf("expected size %d, got %v", len(content), result["size"])
	}
}

func TestUploadFileCreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	targetPath := filepath.Join(dir, "a", "b", "c", "deep.txt")

	w := fsRequestWithContentType(
		"POST",
		"/toolbox/files/upload?path="+targetPath,
		"application/octet-stream",
		strings.NewReader("deep content"),
	)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("failed to read deep file: %v", err)
	}
	if string(data) != "deep content" {
		t.Errorf("expected 'deep content', got '%s'", string(data))
	}
}

func TestUploadFileOverwriteFalse(t *testing.T) {
	dir := t.TempDir()
	targetPath := filepath.Join(dir, "exists.txt")
	os.WriteFile(targetPath, []byte("original"), 0644)

	w := fsRequestWithContentType(
		"POST",
		"/toolbox/files/upload?path="+targetPath+"&overwrite=false",
		"application/octet-stream",
		strings.NewReader("new content"),
	)
	if w.Code != 409 {
		t.Fatalf("expected 409 for overwrite=false on existing file, got %d", w.Code)
	}

	// Verify original content unchanged
	data, _ := os.ReadFile(targetPath)
	if string(data) != "original" {
		t.Errorf("original content was changed!")
	}
}

func TestUploadFileWithMode(t *testing.T) {
	dir := t.TempDir()
	targetPath := filepath.Join(dir, "exec.sh")

	w := fsRequestWithContentType(
		"POST",
		"/toolbox/files/upload?path="+targetPath+"&mode=755",
		"application/octet-stream",
		strings.NewReader("#!/bin/bash\necho hi"),
	)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	info, _ := os.Stat(targetPath)
	mode := fmt.Sprintf("%o", info.Mode().Perm())
	if mode != "755" {
		t.Errorf("expected mode 755, got %s", mode)
	}
}

func TestUploadFileMultipart(t *testing.T) {
	dir := t.TempDir()
	targetPath := filepath.Join(dir, "multipart.txt")
	content := "multipart content"

	// Build multipart form
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, _ := writer.CreateFormFile("file", "multipart.txt")
	part.Write([]byte(content))
	writer.Close()

	handler := NewToolboxFS()
	req := httptest.NewRequest("POST", "/toolbox/files/upload?path="+targetPath, &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(targetPath)
	if string(data) != content {
		t.Errorf("expected '%s', got '%s'", content, string(data))
	}
}

// ── Bulk Upload Tests ───────────────────────────────────────────────────

func TestBulkUpload(t *testing.T) {
	dir := t.TempDir()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Add two files
	part1, _ := writer.CreateFormFile("file", "one.txt")
	part1.Write([]byte("content one"))
	part2, _ := writer.CreateFormFile("file", "two.txt")
	part2.Write([]byte("content two"))
	writer.Close()

	handler := NewToolboxFS()
	req := httptest.NewRequest("POST", "/toolbox/files/bulk-upload?path="+dir, &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	uploaded := result["uploaded"].([]any)
	if len(uploaded) != 2 {
		t.Fatalf("expected 2 uploaded files, got %d", len(uploaded))
	}

	// Verify both files exist
	d1, _ := os.ReadFile(filepath.Join(dir, "one.txt"))
	d2, _ := os.ReadFile(filepath.Join(dir, "two.txt"))
	if string(d1) != "content one" {
		t.Errorf("one.txt content mismatch")
	}
	if string(d2) != "content two" {
		t.Errorf("two.txt content mismatch")
	}
}

// ── Bulk Download Tests ─────────────────────────────────────────────────

func TestBulkDownload(t *testing.T) {
	dir := t.TempDir()
	f1 := filepath.Join(dir, "a.txt")
	f2 := filepath.Join(dir, "b.txt")
	os.WriteFile(f1, []byte("aaa"), 0644)
	os.WriteFile(f2, []byte("bbb"), 0644)

	body := fmt.Sprintf(`{"paths":["%s","%s"]}`, f1, f2)

	w := fsRequestWithContentType("POST", "/toolbox/files/bulk-download", "application/json", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/zip" {
		t.Fatalf("expected Content-Type application/zip, got '%s'", ct)
	}

	// Parse the zip
	reader, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("failed to read zip: %v", err)
	}
	if len(reader.File) != 2 {
		t.Fatalf("expected 2 files in zip, got %d", len(reader.File))
	}
}

func TestBulkDownloadEmptyPaths(t *testing.T) {
	w := fsRequestWithContentType("POST", "/toolbox/files/bulk-download", "application/json", strings.NewReader(`{"paths":[]}`))
	if w.Code != 400 {
		t.Fatalf("expected 400 for empty paths, got %d", w.Code)
	}
}

// ── Create Folder Tests ─────────────────────────────────────────────────

func TestCreateFolder(t *testing.T) {
	dir := t.TempDir()
	newDir := filepath.Join(dir, "newdir")

	w := fsRequest("POST", "/toolbox/files/folder?path="+newDir, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	if result["created"] != true {
		t.Errorf("expected created=true, got %v", result["created"])
	}

	info, err := os.Stat(newDir)
	if err != nil {
		t.Fatalf("directory was not created")
	}
	if !info.IsDir() {
		t.Fatalf("path is not a directory")
	}
}

func TestCreateFolderNested(t *testing.T) {
	dir := t.TempDir()
	nestedDir := filepath.Join(dir, "a", "b", "c")

	w := fsRequest("POST", "/toolbox/files/folder?path="+nestedDir, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(nestedDir); err != nil {
		t.Fatalf("nested directory was not created")
	}
}

func TestCreateFolderAlreadyExists(t *testing.T) {
	dir := t.TempDir()

	w := fsRequest("POST", "/toolbox/files/folder?path="+dir, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	result := decodeJSON(t, w.Body)
	if result["created"] != false {
		t.Errorf("expected created=false for existing dir, got %v", result["created"])
	}
}

func TestCreateFolderWithMode(t *testing.T) {
	dir := t.TempDir()
	newDir := filepath.Join(dir, "modedir")

	w := fsRequest("POST", "/toolbox/files/folder?path="+newDir+"&mode=700", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	info, _ := os.Stat(newDir)
	mode := fmt.Sprintf("%o", info.Mode().Perm())
	if mode != "700" {
		t.Errorf("expected mode 700, got %s", mode)
	}
}

// ── Delete File Tests ───────────────────────────────────────────────────

func TestDeleteFile(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "delete-me.txt")
	os.WriteFile(filePath, []byte("x"), 0644)

	w := fsRequest("DELETE", "/toolbox/files?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	if result["deleted"] != true {
		t.Errorf("expected deleted=true")
	}

	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Errorf("file still exists after deletion")
	}
}

func TestDeleteEmptyDir(t *testing.T) {
	dir := t.TempDir()
	emptyDir := filepath.Join(dir, "empty")
	os.Mkdir(emptyDir, 0755)

	w := fsRequest("DELETE", "/toolbox/files?path="+emptyDir, nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteNonEmptyDirWithoutRecursive(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "nonempty")
	os.Mkdir(subDir, 0755)
	os.WriteFile(filepath.Join(subDir, "file.txt"), []byte("x"), 0644)

	w := fsRequest("DELETE", "/toolbox/files?path="+subDir, nil)
	if w.Code != 400 {
		t.Fatalf("expected 400 for non-empty dir without recursive, got %d", w.Code)
	}
}

func TestDeleteNonEmptyDirRecursive(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "nonempty")
	os.MkdirAll(filepath.Join(subDir, "deep"), 0755)
	os.WriteFile(filepath.Join(subDir, "deep", "file.txt"), []byte("x"), 0644)

	w := fsRequest("DELETE", "/toolbox/files?path="+subDir+"&recursive=true", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(subDir); !os.IsNotExist(err) {
		t.Errorf("directory still exists after recursive deletion")
	}
}

func TestDeleteNotFound(t *testing.T) {
	w := fsRequest("DELETE", "/toolbox/files?path=/nonexistent/file.xyz", nil)
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteProtectedPaths(t *testing.T) {
	w := fsRequest("DELETE", "/toolbox/files?path=/&recursive=true", nil)
	if w.Code != 403 {
		t.Fatalf("expected 403 for /, got %d", w.Code)
	}

	w = fsRequest("DELETE", "/toolbox/files?path=/root&recursive=true", nil)
	if w.Code != 403 {
		t.Fatalf("expected 403 for /root, got %d", w.Code)
	}
}

// ── Move/Rename Tests ───────────────────────────────────────────────────

func TestMoveFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.txt")
	dst := filepath.Join(dir, "dest.txt")
	os.WriteFile(src, []byte("move me"), 0644)

	w := fsRequest("POST", fmt.Sprintf("/toolbox/files/move?source=%s&destination=%s", src, dst), nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Source should not exist
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("source file still exists")
	}

	// Dest should exist with correct content
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("destination file not found: %v", err)
	}
	if string(data) != "move me" {
		t.Errorf("expected 'move me', got '%s'", string(data))
	}

	result := decodeJSON(t, w.Body)
	if result["source"] != src {
		t.Errorf("response source mismatch")
	}
	if result["destination"] != dst {
		t.Errorf("response destination mismatch")
	}
}

func TestMoveFileCreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "a", "b", "dst.txt")
	os.WriteFile(src, []byte("x"), 0644)

	w := fsRequest("POST", fmt.Sprintf("/toolbox/files/move?source=%s&destination=%s", src, dst), nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(dst); err != nil {
		t.Fatalf("destination file not found after move with parent dir creation")
	}
}

func TestMoveFileSourceNotFound(t *testing.T) {
	dir := t.TempDir()
	w := fsRequest("POST", fmt.Sprintf("/toolbox/files/move?source=/nonexistent/xyz&destination=%s/dst.txt", dir), nil)
	if w.Code != 404 {
		t.Fatalf("expected 404 for missing source, got %d", w.Code)
	}
}

// ── Find Text Tests ─────────────────────────────────────────────────────

func TestFindText(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello world\ngoodbye world\nhello again"), 0644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("no match here"), 0644)

	w := fsRequest("GET", "/toolbox/files/find?path="+dir+"&pattern=hello", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	matches := result["matches"].([]any)
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches for 'hello', got %d", len(matches))
	}

	// Verify first match
	m1 := matches[0].(map[string]any)
	if !strings.HasSuffix(m1["file"].(string), "a.txt") {
		t.Errorf("expected match in a.txt, got %s", m1["file"])
	}
	if int(m1["line"].(float64)) != 1 {
		t.Errorf("expected line 1, got %v", m1["line"])
	}
}

func TestFindTextWithInclude(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "code.go"), []byte("func main() {}"), 0644)
	os.WriteFile(filepath.Join(dir, "code.py"), []byte("def main(): pass"), 0644)

	w := fsRequest("GET", "/toolbox/files/find?path="+dir+"&pattern=main&include=*.go", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeJSON(t, w.Body)
	matches := result["matches"].([]any)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match with include=*.go, got %d", len(matches))
	}
}

func TestFindTextInvalidRegex(t *testing.T) {
	dir := t.TempDir()
	w := fsRequest("GET", "/toolbox/files/find?path="+dir+"&pattern=[invalid", nil)
	if w.Code != 400 {
		t.Fatalf("expected 400 for invalid regex, got %d", w.Code)
	}
}

func TestFindTextMaxResults(t *testing.T) {
	dir := t.TempDir()
	// Create a file with many matches
	var content strings.Builder
	for i := 0; i < 200; i++ {
		content.WriteString(fmt.Sprintf("match line %d\n", i))
	}
	os.WriteFile(filepath.Join(dir, "many.txt"), []byte(content.String()), 0644)

	w := fsRequest("GET", "/toolbox/files/find?path="+dir+"&pattern=match&max_results=5", nil)
	result := decodeJSON(t, w.Body)
	matches := result["matches"].([]any)
	if len(matches) != 5 {
		t.Fatalf("expected 5 matches with max_results=5, got %d", len(matches))
	}
	if result["truncated"] != true {
		t.Errorf("expected truncated=true")
	}
}

// ── Replace Text Tests ──────────────────────────────────────────────────

func TestReplaceText(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "replace.txt")
	os.WriteFile(filePath, []byte("hello world\nhello universe\ngoodbye"), 0644)

	body := fmt.Sprintf(`{"files":["%s"],"pattern":"hello","new_value":"hi"}`, filePath)
	w := fsRequestWithContentType("POST", "/toolbox/files/replace", "application/json", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify file content changed
	data, _ := os.ReadFile(filePath)
	if !strings.Contains(string(data), "hi world") {
		t.Errorf("expected 'hi world' in replaced content, got '%s'", string(data))
	}
	if !strings.Contains(string(data), "hi universe") {
		t.Errorf("expected 'hi universe' in replaced content")
	}
	if !strings.Contains(string(data), "goodbye") {
		t.Errorf("expected 'goodbye' unchanged")
	}

	result := decodeJSON(t, w.Body)
	results := result["results"].([]any)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	r := results[0].(map[string]any)
	if int(r["replacements"].(float64)) < 2 {
		t.Errorf("expected at least 2 replacements, got %v", r["replacements"])
	}
}

func TestReplaceTextNoMatch(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "noreplace.txt")
	os.WriteFile(filePath, []byte("nothing to replace"), 0644)

	body := fmt.Sprintf(`{"files":["%s"],"pattern":"xyz_no_match","new_value":"abc"}`, filePath)
	w := fsRequestWithContentType("POST", "/toolbox/files/replace", "application/json", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	result := decodeJSON(t, w.Body)
	results := result["results"].([]any)
	r := results[0].(map[string]any)
	if int(r["replacements"].(float64)) != 0 {
		t.Errorf("expected 0 replacements, got %v", r["replacements"])
	}
}

// ── Set Permissions Tests ───────────────────────────────────────────────

func TestSetPermissions(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "perms.txt")
	os.WriteFile(filePath, []byte("x"), 0644)

	body := `{"mode":"755"}`
	w := fsRequestWithContentType("POST", "/toolbox/files/permissions?path="+filePath, "application/json", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	info, _ := os.Stat(filePath)
	mode := fmt.Sprintf("%o", info.Mode().Perm())
	if mode != "755" {
		t.Errorf("expected mode 755, got %s", mode)
	}

	result := decodeJSON(t, w.Body)
	if result["mode"] != "755" {
		t.Errorf("expected response mode '755', got '%v'", result["mode"])
	}
}

func TestSetPermissionsNotFound(t *testing.T) {
	body := `{"mode":"755"}`
	w := fsRequestWithContentType("POST", "/toolbox/files/permissions?path=/nonexistent/xyz", "application/json", strings.NewReader(body))
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ── Upload → Download Roundtrip E2E ─────────────────────────────────────

func TestUploadDownloadRoundtrip(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "roundtrip.txt")
	content := "This is a roundtrip test!\nLine 2.\nLine 3 with special chars: àéîöü 中文 🎉"

	// Upload
	w := fsRequestWithContentType(
		"POST", "/toolbox/files/upload?path="+filePath,
		"application/octet-stream",
		strings.NewReader(content),
	)
	if w.Code != 200 {
		t.Fatalf("upload failed: %d %s", w.Code, w.Body.String())
	}

	// Download
	w = fsRequest("GET", "/toolbox/files/download?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("download failed: %d %s", w.Code, w.Body.String())
	}

	if w.Body.String() != content {
		t.Errorf("roundtrip content mismatch:\nexpected: %q\ngot: %q", content, w.Body.String())
	}
}

func TestUploadDownloadBinaryRoundtrip(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "roundtrip.bin")
	// Create all possible byte values
	content := make([]byte, 256)
	for i := 0; i < 256; i++ {
		content[i] = byte(i)
	}

	w := fsRequestWithContentType(
		"POST", "/toolbox/files/upload?path="+filePath,
		"application/octet-stream",
		bytes.NewReader(content),
	)
	if w.Code != 200 {
		t.Fatalf("upload failed: %d", w.Code)
	}

	w = fsRequest("GET", "/toolbox/files/download?path="+filePath, nil)
	if w.Code != 200 {
		t.Fatalf("download failed: %d", w.Code)
	}

	if !bytes.Equal(w.Body.Bytes(), content) {
		t.Errorf("binary roundtrip content mismatch")
	}
}

// ── Full Lifecycle E2E ──────────────────────────────────────────────────

func TestFullLifecycleE2E(t *testing.T) {
	dir := t.TempDir()

	// 1. Create folder
	newDir := filepath.Join(dir, "project")
	w := fsRequest("POST", "/toolbox/files/folder?path="+newDir, nil)
	if w.Code != 200 {
		t.Fatalf("create folder failed: %d", w.Code)
	}

	// 2. Upload file into it
	filePath := filepath.Join(newDir, "main.go")
	code := `package main

import "fmt"

func main() {
	fmt.Println("hello world")
}
`
	w = fsRequestWithContentType("POST", "/toolbox/files/upload?path="+filePath, "application/octet-stream", strings.NewReader(code))
	if w.Code != 200 {
		t.Fatalf("upload failed: %d", w.Code)
	}

	// 3. Check exists
	w = fsRequest("GET", "/toolbox/files/exists?path="+filePath, nil)
	result := decodeJSON(t, w.Body)
	if result["exists"] != true {
		t.Fatal("file should exist after upload")
	}

	// 4. Get info
	w = fsRequest("GET", "/toolbox/files/info?path="+filePath, nil)
	result = decodeJSON(t, w.Body)
	if result["name"] != "main.go" {
		t.Errorf("info: expected name 'main.go', got '%v'", result["name"])
	}

	// 5. List directory
	w = fsRequest("GET", "/toolbox/files?path="+newDir, nil)
	result = decodeJSON(t, w.Body)
	entries := result["entries"].([]any)
	if len(entries) != 1 {
		t.Errorf("expected 1 entry, got %d", len(entries))
	}

	// 6. Download and verify
	w = fsRequest("GET", "/toolbox/files/download?path="+filePath, nil)
	if w.Body.String() != code {
		t.Errorf("download content mismatch")
	}

	// 7. Find text
	w = fsRequest("GET", "/toolbox/files/find?path="+newDir+"&pattern=hello", nil)
	result = decodeJSON(t, w.Body)
	matches := result["matches"].([]any)
	if len(matches) != 1 {
		t.Errorf("expected 1 match for 'hello', got %d", len(matches))
	}

	// 8. Replace text
	body := fmt.Sprintf(`{"files":["%s"],"pattern":"hello world","new_value":"goodbye world"}`, filePath)
	w = fsRequestWithContentType("POST", "/toolbox/files/replace", "application/json", strings.NewReader(body))
	if w.Code != 200 {
		t.Fatalf("replace failed: %d", w.Code)
	}

	// 9. Download and verify replacement
	w = fsRequest("GET", "/toolbox/files/download?path="+filePath, nil)
	if !strings.Contains(w.Body.String(), "goodbye world") {
		t.Errorf("replacement didn't work, content: %s", w.Body.String())
	}

	// 10. Move/rename
	newFilePath := filepath.Join(newDir, "app.go")
	w = fsRequest("POST", fmt.Sprintf("/toolbox/files/move?source=%s&destination=%s", filePath, newFilePath), nil)
	if w.Code != 200 {
		t.Fatalf("move failed: %d", w.Code)
	}

	// 11. Verify old path gone, new path exists
	w = fsRequest("GET", "/toolbox/files/exists?path="+filePath, nil)
	result = decodeJSON(t, w.Body)
	if result["exists"] != false {
		t.Error("old file should not exist after move")
	}
	w = fsRequest("GET", "/toolbox/files/exists?path="+newFilePath, nil)
	result = decodeJSON(t, w.Body)
	if result["exists"] != true {
		t.Error("new file should exist after move")
	}

	// 12. Delete
	w = fsRequest("DELETE", "/toolbox/files?path="+newFilePath, nil)
	if w.Code != 200 {
		t.Fatalf("delete failed: %d", w.Code)
	}

	// 13. Verify deleted
	w = fsRequest("GET", "/toolbox/files/exists?path="+newFilePath, nil)
	result = decodeJSON(t, w.Body)
	if result["exists"] != false {
		t.Error("file should not exist after deletion")
	}

	// 14. Delete the directory
	w = fsRequest("DELETE", "/toolbox/files?path="+newDir+"&recursive=true", nil)
	if w.Code != 200 {
		t.Fatalf("delete dir failed: %d", w.Code)
	}
}

// ── ProxyRouter Toolbox Integration Tests ───────────────────────────────

func TestProxyRouterToolboxFS(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.txt"), []byte("proxy test"), 0644)

	router := NewProxyRouter(&Config{Slug: "test", CallbackURL: "http://localhost", MachineToken: "mt_test", ProxyDomain: "kortix.cloud"})
	req := httptest.NewRequest("GET", "/toolbox/files?path="+dir, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200 via ProxyRouter, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	entries := result["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry via proxy, got %d", len(entries))
	}
}

func TestProxyRouterToolboxProcess(t *testing.T) {
	router := NewProxyRouter(&Config{Slug: "test", CallbackURL: "http://localhost", MachineToken: "mt_test", ProxyDomain: "kortix.cloud"})
	body := `{"command":"echo proxy_test"}`
	req := httptest.NewRequest("POST", "/toolbox/process/execute", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200 via ProxyRouter, got %d: %s", w.Code, w.Body.String())
	}

	result := decodeJSON(t, w.Body)
	stdout := result["stdout"].(string)
	if !strings.Contains(stdout, "proxy_test") {
		t.Errorf("expected stdout to contain 'proxy_test', got '%s'", stdout)
	}
}
