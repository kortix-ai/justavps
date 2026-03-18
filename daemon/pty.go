// PTY WebSocket handler — spawns a shell and bridges it to a WebSocket.
//
// Protocol (JSON messages):
//   Client → Server:
//     { "type": "input", "data": "ls\n" }
//     { "type": "resize", "cols": 80, "rows": 24 }
//   Server → Client:
//     { "type": "output", "data": "..." }
//     { "type": "exit" }
//     { "type": "error", "data": "..." }
//
// The CF Worker authenticates the user before the WebSocket reaches the daemon.
// The daemon trusts the connection (no auth layer here).

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // CF Worker handles auth
}

type ptyMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func handlePTY(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[PTY] Upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Determine shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	// Spawn PTY
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("[PTY] Failed to start shell: %v", err)
		sendPTYError(conn, "Failed to start shell: "+err.Error())
		return
	}
	defer ptmx.Close()

	var wg sync.WaitGroup

	// PTY output → WebSocket
	wg.Add(1)
	go func() {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				break
			}
			msg := ptyMessage{Type: "output", Data: string(buf[:n])}
			data, _ := json.Marshal(msg)
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				break
			}
		}
		// Shell exited
		exitMsg, _ := json.Marshal(ptyMessage{Type: "exit"})
		conn.WriteMessage(websocket.TextMessage, exitMsg)
	}()

	// WebSocket → PTY
	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg ptyMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			ptmx.Write([]byte(msg.Data))
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				pty.Setsize(ptmx, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows})
			}
		}
	}

	// Clean up
	cmd.Process.Kill()
	cmd.Wait()
	wg.Wait()
}

func sendPTYError(conn *websocket.Conn, msg string) {
	data, _ := json.Marshal(ptyMessage{Type: "error", Data: msg})
	conn.WriteMessage(websocket.TextMessage, data)
}
