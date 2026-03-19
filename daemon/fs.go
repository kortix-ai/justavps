// Filesystem API — full CRUD file operations for the toolbox.
//
// Routes (all under /toolbox/files/):
//   GET    /toolbox/files              — list files in directory
//   GET    /toolbox/files/info         — file/dir metadata
//   GET    /toolbox/files/exists       — check if path exists
//   GET    /toolbox/files/download     — download file content
//   POST   /toolbox/files/upload       — upload/write file
//   POST   /toolbox/files/bulk-upload  — upload multiple files
//   POST   /toolbox/files/bulk-download — download multiple files as zip
//   POST   /toolbox/files/folder       — create directory
//   DELETE /toolbox/files              — delete file/dir
//   POST   /toolbox/files/move         — move/rename
//   GET    /toolbox/files/find         — search text in files (grep)
//   POST   /toolbox/files/replace      — find & replace in files
//   POST   /toolbox/files/permissions  — chmod/chown

package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const maxUploadSize = 100 * 1024 * 1024 // 100MB

// FileEntry represents a file/dir in listing and info responses.
type FileEntry struct {
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	Type          string  `json:"type"` // "file" or "dir"
	Size          int64   `json:"size"`
	Mode          string  `json:"mode"`      // e.g. "-rw-r--r--"
	ModeBits      string  `json:"mode_bits"` // e.g. "644"
	Owner         string  `json:"owner"`
	Group         string  `json:"group"`
	ModTime       string  `json:"mod_time"`
	SymlinkTarget *string `json:"symlink_target"`
}

// NewToolboxFS creates the HTTP mux for filesystem routes.
func NewToolboxFS() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /toolbox/files", handleListFiles)
	mux.HandleFunc("GET /toolbox/files/info", handleFileInfo)
	mux.HandleFunc("GET /toolbox/files/exists", handleFileExists)
	mux.HandleFunc("GET /toolbox/files/download", handleDownloadFile)
	mux.HandleFunc("POST /toolbox/files/upload", handleUploadFile)
	mux.HandleFunc("POST /toolbox/files/bulk-upload", handleBulkUpload)
	mux.HandleFunc("POST /toolbox/files/bulk-download", handleBulkDownload)
	mux.HandleFunc("POST /toolbox/files/folder", handleCreateFolder)
	mux.HandleFunc("DELETE /toolbox/files", handleDeleteFile)
	mux.HandleFunc("POST /toolbox/files/move", handleMoveFile)
	mux.HandleFunc("GET /toolbox/files/find", handleFindText)
	mux.HandleFunc("POST /toolbox/files/replace", handleReplaceText)
	mux.HandleFunc("POST /toolbox/files/permissions", handleSetPermissions)

	return mux
}

// ── Helpers ──────────────────────────────────────────────────────────────

func fsError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
		"code":  code,
	})
}

// safePath cleans a path. Returns an error if the path is empty.
func safePath(raw string) (string, error) {
	if raw == "" {
		return "", fmt.Errorf("path is required")
	}
	cleaned := filepath.Clean(raw)
	// Ensure absolute
	if !filepath.IsAbs(cleaned) {
		cleaned = filepath.Join("/root", cleaned)
	}
	return cleaned, nil
}

func statToEntry(path string, info os.FileInfo) FileEntry {
	entry := FileEntry{
		Name:     info.Name(),
		Path:     path,
		Size:     info.Size(),
		Mode:     info.Mode().String(),
		ModeBits: fmt.Sprintf("%o", info.Mode().Perm()),
		ModTime:  info.ModTime().UTC().Format(time.RFC3339),
	}

	if info.IsDir() {
		entry.Type = "dir"
	} else {
		entry.Type = "file"
	}

	// Resolve symlink target
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(path)
		if err == nil {
			entry.SymlinkTarget = &target
		}
	}

	// Get owner/group from syscall
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		if u, err := user.LookupId(fmt.Sprintf("%d", stat.Uid)); err == nil {
			entry.Owner = u.Username
		} else {
			entry.Owner = fmt.Sprintf("%d", stat.Uid)
		}
		if g, err := user.LookupGroupId(fmt.Sprintf("%d", stat.Gid)); err == nil {
			entry.Group = g.Name
		} else {
			entry.Group = fmt.Sprintf("%d", stat.Gid)
		}
	}

	return entry
}

// ── GET /toolbox/files — List files ─────────────────────────────────────

func handleListFiles(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	if rawPath == "" {
		rawPath = "/root"
	}
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	depthStr := r.URL.Query().Get("depth")
	depth := 1
	if depthStr != "" {
		if d, err := strconv.Atoi(depthStr); err == nil && d > 0 {
			depth = d
		}
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			fsError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("path not found: %s", path))
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	if !info.IsDir() {
		fsError(w, 400, "BAD_REQUEST", "path is not a directory")
		return
	}

	entries := []FileEntry{}
	walkDir(path, path, depth, 0, &entries)

	writeJSON(w, 200, map[string]any{"entries": entries})
}

func walkDir(basePath, currentPath string, maxDepth, currentDepth int, entries *[]FileEntry) {
	if currentDepth >= maxDepth {
		return
	}

	dirEntries, err := os.ReadDir(currentPath)
	if err != nil {
		return
	}

	for _, de := range dirEntries {
		fullPath := filepath.Join(currentPath, de.Name())
		info, err := de.Info()
		if err != nil {
			continue
		}
		*entries = append(*entries, statToEntry(fullPath, info))

		if de.IsDir() && currentDepth+1 < maxDepth {
			walkDir(basePath, fullPath, maxDepth, currentDepth+1, entries)
		}
	}
}

// ── GET /toolbox/files/info — File/dir info ─────────────────────────────

func handleFileInfo(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	info, err := os.Lstat(path) // Lstat to not follow symlinks
	if err != nil {
		if os.IsNotExist(err) {
			fsError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("path not found: %s", path))
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	entry := statToEntry(path, info)
	writeJSON(w, 200, entry)
}

// ── GET /toolbox/files/exists — Check exists ────────────────────────────

func handleFileExists(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, 200, map[string]any{"exists": false, "type": nil})
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	typ := "file"
	if info.IsDir() {
		typ = "dir"
	}
	writeJSON(w, 200, map[string]any{"exists": true, "type": typ})
}

// ── GET /toolbox/files/download — Download file ─────────────────────────

func handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			fsError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("file not found: %s", path))
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}
	if info.IsDir() {
		fsError(w, 400, "BAD_REQUEST", "cannot download a directory; use bulk-download")
		return
	}

	f, err := os.Open(path)
	if err != nil {
		fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("cannot open file: %v", err))
		return
	}
	defer f.Close()

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(path)))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))

	// Detect content type from first 512 bytes
	buf := make([]byte, 512)
	n, _ := f.Read(buf)
	contentType := http.DetectContentType(buf[:n])
	w.Header().Set("Content-Type", contentType)

	// Seek back and copy the whole file
	f.Seek(0, io.SeekStart)
	io.Copy(w, f)
}

// ── POST /toolbox/files/upload — Upload file ────────────────────────────

func handleUploadFile(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	modeStr := r.URL.Query().Get("mode")
	if modeStr == "" {
		modeStr = "644"
	}
	modeVal, err := strconv.ParseUint(modeStr, 8, 32)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid mode: "+modeStr)
		return
	}
	fileMode := os.FileMode(modeVal)

	overwriteStr := r.URL.Query().Get("overwrite")
	overwrite := true
	if overwriteStr == "false" {
		overwrite = false
	}

	// Check if file exists and overwrite is disabled
	if !overwrite {
		if _, err := os.Stat(path); err == nil {
			fsError(w, 409, "ALREADY_EXISTS", "file already exists and overwrite=false")
			return
		}
	}

	// Limit request body size
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	var data []byte

	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		// Multipart form upload
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			fsError(w, 413, "FILE_TOO_LARGE", "file exceeds max upload size")
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			fsError(w, 400, "BAD_REQUEST", "missing 'file' form field")
			return
		}
		defer file.Close()
		data, err = io.ReadAll(file)
		if err != nil {
			fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to read upload: %v", err))
			return
		}
	} else {
		// Raw body upload
		data, err = io.ReadAll(r.Body)
		if err != nil {
			if err.Error() == "http: request body too large" {
				fsError(w, 413, "FILE_TOO_LARGE", "file exceeds max upload size")
			} else {
				fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to read body: %v", err))
			}
			return
		}
	}

	// Create parent directories
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to create parent dirs: %v", err))
		return
	}

	if err := os.WriteFile(path, data, fileMode); err != nil {
		fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to write file: %v", err))
		return
	}

	log.Printf("[FS] Uploaded %s (%d bytes)", path, len(data))

	writeJSON(w, 200, map[string]any{
		"path": path,
		"name": filepath.Base(path),
		"type": "file",
		"size": len(data),
	})
}

// ── POST /toolbox/files/bulk-upload — Upload multiple files ─────────────

func handleBulkUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		fsError(w, 413, "FILE_TOO_LARGE", "request exceeds max upload size")
		return
	}

	type uploadResult struct {
		Path string `json:"path"`
		Size int    `json:"size"`
	}
	type uploadError struct {
		Path  string `json:"path"`
		Error string `json:"error"`
	}

	uploaded := []uploadResult{}
	errors := []uploadError{}

	// Get the base path from query param
	baseDir := r.URL.Query().Get("path")
	if baseDir == "" {
		baseDir = "/root"
	}

	// Iterate over all file fields
	if r.MultipartForm != nil && r.MultipartForm.File != nil {
		for fieldName, fileHeaders := range r.MultipartForm.File {
			for _, fh := range fileHeaders {
				targetPath := filepath.Join(baseDir, fh.Filename)
				if fieldName != "file" && fieldName != "files" {
					// Use field name as filename if it looks like a path
					targetPath = filepath.Join(baseDir, fieldName)
				}
				cleaned, err := safePath(targetPath)
				if err != nil {
					errors = append(errors, uploadError{Path: targetPath, Error: err.Error()})
					continue
				}

				if err := saveMultipartFile(fh, cleaned); err != nil {
					errors = append(errors, uploadError{Path: cleaned, Error: err.Error()})
				} else {
					info, _ := os.Stat(cleaned)
					size := 0
					if info != nil {
						size = int(info.Size())
					}
					uploaded = append(uploaded, uploadResult{Path: cleaned, Size: size})
				}
			}
		}
	}

	writeJSON(w, 200, map[string]any{
		"uploaded": uploaded,
		"errors":   errors,
	})
}

func saveMultipartFile(fh *multipart.FileHeader, targetPath string) error {
	src, err := fh.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return err
	}

	dst, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

// ── POST /toolbox/files/bulk-download — Download multiple as zip ────────

func handleBulkDownload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if len(body.Paths) == 0 {
		fsError(w, 400, "BAD_REQUEST", "paths array is empty")
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="download.zip"`)

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, rawPath := range body.Paths {
		path, err := safePath(rawPath)
		if err != nil {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}

		f, err := os.Open(path)
		if err != nil {
			continue
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			f.Close()
			continue
		}
		header.Name = filepath.Base(path)
		header.Method = zip.Deflate

		writer, err := zw.CreateHeader(header)
		if err != nil {
			f.Close()
			continue
		}
		io.Copy(writer, f)
		f.Close()
	}
}

// ── POST /toolbox/files/folder — Create directory ───────────────────────

func handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	modeStr := r.URL.Query().Get("mode")
	if modeStr == "" {
		modeStr = "755"
	}
	modeVal, err := strconv.ParseUint(modeStr, 8, 32)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid mode: "+modeStr)
		return
	}

	// Check if already exists
	if info, err := os.Stat(path); err == nil && info.IsDir() {
		writeJSON(w, 200, map[string]any{"path": path, "created": false})
		return
	}

	if err := os.MkdirAll(path, os.FileMode(modeVal)); err != nil {
		fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to create directory: %v", err))
		return
	}

	log.Printf("[FS] Created directory %s", path)
	writeJSON(w, 200, map[string]any{"path": path, "created": true})
}

// ── DELETE /toolbox/files — Delete file/dir ─────────────────────────────

func handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	// Safety: don't allow deleting root-level dirs
	if path == "/" || path == "/root" || path == "/home" {
		fsError(w, 403, "PERMISSION_DENIED", "cannot delete system directories")
		return
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			fsError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("path not found: %s", path))
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	recursive := r.URL.Query().Get("recursive") == "true"

	if info.IsDir() {
		if !recursive {
			// Check if directory is empty
			entries, _ := os.ReadDir(path)
			if len(entries) > 0 {
				fsError(w, 400, "BAD_REQUEST", "directory is not empty; use recursive=true")
				return
			}
		}
		if err := os.RemoveAll(path); err != nil {
			fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to delete directory: %v", err))
			return
		}
	} else {
		if err := os.Remove(path); err != nil {
			fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to delete file: %v", err))
			return
		}
	}

	log.Printf("[FS] Deleted %s", path)
	writeJSON(w, 200, map[string]any{"deleted": true, "path": path})
}

// ── POST /toolbox/files/move — Move/rename ──────────────────────────────

func handleMoveFile(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	destination := r.URL.Query().Get("destination")

	srcPath, err := safePath(source)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid source: "+err.Error())
		return
	}
	dstPath, err := safePath(destination)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid destination: "+err.Error())
		return
	}

	if _, err := os.Stat(srcPath); err != nil {
		if os.IsNotExist(err) {
			fsError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("source not found: %s", srcPath))
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	// Create parent dirs for destination
	if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
		fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to create destination dirs: %v", err))
		return
	}

	if err := os.Rename(srcPath, dstPath); err != nil {
		fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("failed to move: %v", err))
		return
	}

	log.Printf("[FS] Moved %s → %s", srcPath, dstPath)
	writeJSON(w, 200, map[string]any{"source": srcPath, "destination": dstPath})
}

// ── GET /toolbox/files/find — Search text in files ──────────────────────

func handleFindText(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	pattern := r.URL.Query().Get("pattern")
	if pattern == "" {
		fsError(w, 400, "BAD_REQUEST", "pattern is required")
		return
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", fmt.Sprintf("invalid regex: %v", err))
		return
	}

	includeGlob := r.URL.Query().Get("include")
	if includeGlob == "" {
		includeGlob = "*"
	}

	maxResultsStr := r.URL.Query().Get("max_results")
	maxResults := 100
	if maxResultsStr != "" {
		if mr, err := strconv.Atoi(maxResultsStr); err == nil && mr > 0 {
			maxResults = mr
		}
	}

	type match struct {
		File    string `json:"file"`
		Line    int    `json:"line"`
		Content string `json:"content"`
	}

	matches := []match{}
	truncated := false

	filepath.Walk(path, func(fpath string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if len(matches) >= maxResults {
			truncated = true
			return filepath.SkipAll
		}

		// Apply include filter
		if includeGlob != "*" {
			matched, _ := filepath.Match(includeGlob, info.Name())
			if !matched {
				return nil
			}
		}

		// Skip binary files (check first 512 bytes)
		f, err := os.Open(fpath)
		if err != nil {
			return nil
		}
		defer f.Close()

		// Skip large files (>10MB)
		if info.Size() > 10*1024*1024 {
			return nil
		}

		data, err := io.ReadAll(f)
		if err != nil {
			return nil
		}

		lines := strings.Split(string(data), "\n")
		for i, line := range lines {
			if re.MatchString(line) {
				matches = append(matches, match{
					File:    fpath,
					Line:    i + 1,
					Content: line,
				})
				if len(matches) >= maxResults {
					truncated = true
					return filepath.SkipAll
				}
			}
		}
		return nil
	})

	writeJSON(w, 200, map[string]any{
		"matches":   matches,
		"truncated": truncated,
		"total":     len(matches),
	})
}

// ── POST /toolbox/files/replace — Find & replace in files ───────────────

func handleReplaceText(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Files    []string `json:"files"`
		Pattern  string   `json:"pattern"`
		NewValue string   `json:"new_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if len(body.Files) == 0 {
		fsError(w, 400, "BAD_REQUEST", "files array is empty")
		return
	}
	if body.Pattern == "" {
		fsError(w, 400, "BAD_REQUEST", "pattern is required")
		return
	}

	re, err := regexp.Compile(body.Pattern)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", fmt.Sprintf("invalid regex: %v", err))
		return
	}

	type replaceResult struct {
		File         string `json:"file"`
		Replacements int    `json:"replacements"`
	}

	results := []replaceResult{}

	for _, rawPath := range body.Files {
		path, err := safePath(rawPath)
		if err != nil {
			continue
		}

		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		original := string(data)
		replaced := re.ReplaceAllString(original, body.NewValue)
		count := strings.Count(original, body.Pattern)
		if count == 0 {
			// Count regex matches
			count = len(re.FindAllStringIndex(original, -1))
		}

		if original != replaced {
			info, _ := os.Stat(path)
			perm := os.FileMode(0644)
			if info != nil {
				perm = info.Mode().Perm()
			}
			os.WriteFile(path, []byte(replaced), perm)
			results = append(results, replaceResult{File: path, Replacements: count})
		} else {
			results = append(results, replaceResult{File: path, Replacements: 0})
		}
	}

	writeJSON(w, 200, map[string]any{"results": results})
}

// ── POST /toolbox/files/permissions — Set permissions ───────────────────

func handleSetPermissions(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	path, err := safePath(rawPath)
	if err != nil {
		fsError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			fsError(w, 404, "FILE_NOT_FOUND", fmt.Sprintf("path not found: %s", path))
		} else {
			fsError(w, 500, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	var body struct {
		Mode  string `json:"mode"`
		Owner string `json:"owner"`
		Group string `json:"group"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fsError(w, 400, "BAD_REQUEST", "invalid JSON body")
		return
	}

	// Apply mode
	if body.Mode != "" {
		modeVal, err := strconv.ParseUint(body.Mode, 8, 32)
		if err != nil {
			fsError(w, 400, "BAD_REQUEST", "invalid mode: "+body.Mode)
			return
		}
		if err := os.Chmod(path, os.FileMode(modeVal)); err != nil {
			fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("chmod failed: %v", err))
			return
		}
	}

	// Apply owner/group
	if body.Owner != "" || body.Group != "" {
		uid := -1
		gid := -1

		if body.Owner != "" {
			u, err := user.Lookup(body.Owner)
			if err != nil {
				fsError(w, 400, "BAD_REQUEST", fmt.Sprintf("unknown user: %s", body.Owner))
				return
			}
			uid, _ = strconv.Atoi(u.Uid)
		}

		if body.Group != "" {
			g, err := user.LookupGroup(body.Group)
			if err != nil {
				fsError(w, 400, "BAD_REQUEST", fmt.Sprintf("unknown group: %s", body.Group))
				return
			}
			gid, _ = strconv.Atoi(g.Gid)
		}

		if err := os.Chown(path, uid, gid); err != nil {
			fsError(w, 500, "INTERNAL_ERROR", fmt.Sprintf("chown failed: %v", err))
			return
		}
	}

	// Return updated info
	info, _ := os.Stat(path)
	resultMode := body.Mode
	if info != nil && resultMode == "" {
		resultMode = fmt.Sprintf("%o", info.Mode().Perm())
	}

	log.Printf("[FS] Set permissions on %s (mode=%s, owner=%s, group=%s)", path, body.Mode, body.Owner, body.Group)
	writeJSON(w, 200, map[string]any{
		"path":  path,
		"mode":  resultMode,
		"owner": body.Owner,
		"group": body.Group,
	})
}
