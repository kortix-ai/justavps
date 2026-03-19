"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCw, Maximize2, Minimize2, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

interface TerminalProps {
  machineId?: string;
  machineIp?: string | null;
  machineSlug?: string;
  machineStatus?: string;
  /** WebSocket PTY URL (e.g. wss://slug.kortix.cloud/_pty) */
  ptyUrl?: string | null;
}

const XTermComponent = ({ machineId, machineIp, machineSlug, machineStatus, ptyUrl }: TerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [connected, setConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    if (wsRef.current?.readyState === WebSocket.OPEN && term) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, []);

  const connectPTY = useCallback(async (term: Terminal | null) => {
    if (!ptyUrl || !term) return;
    wsRef.current?.close();

    term.write('\x1b[90mConnecting to machine...\x1b[0m\r\n');

    let wsUrl = ptyUrl;
    try {
      const res = await fetch('/api/proxy-auth', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          const url = new URL(ptyUrl);
          url.searchParams.set('token', data.token);
          wsUrl = url.toString();
        }
      }
    } catch { /* fallback to cookie auth */ }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.write('\r\n\x1b[32mConnected.\x1b[0m\r\n\r\n');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.focus();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') term.write(msg.data);
        else if (msg.type === 'error') term.write(`\r\n\x1b[31mError: ${msg.data}\x1b[0m\r\n`);
        else if (msg.type === 'exit') { term.write(`\r\n\x1b[90m[Process exited]\x1b[0m\r\n`); setConnected(false); }
      } catch { term.write(event.data); }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => term.write('\r\n\x1b[31mConnection failed. Check that the machine agent is running.\x1b[0m\r\n');

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
  }, [ptyUrl]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!terminalRef.current) return;

      const { Terminal: XTerminal } = await import("@xterm/xterm");
      const { FitAddon: XFitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (termRef.current || !mounted) return;

      const term = new XTerminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        lineHeight: 1.2,
        scrollback: 5000,
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

      const fit = new XFitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(terminalRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      // ResizeObserver for proper container-based fitting
      const ro = new ResizeObserver(() => {
        try { fit.fit(); sendResize(); } catch {}
      });
      ro.observe(terminalRef.current);
      resizeObserverRef.current = ro;

      if (ptyUrl && (machineStatus === 'ready' || machineIp)) {
        connectPTY(term);
      } else {
        term.write('\x1b[33mWaiting for machine...\x1b[0m\r\n');
      }
    }

    init();

    return () => {
      mounted = false;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      wsRef.current?.close();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [machineId, machineStatus, ptyUrl, machineIp, machineSlug, connectPTY, sendResize]);

  // Re-fit on fullscreen toggle
  useEffect(() => {
    setTimeout(() => {
      try { fitRef.current?.fit(); sendResize(); termRef.current?.focus(); } catch {}
    }, 50);
  }, [isFullscreen, sendResize]);

  return (
    <div className={cn(
      "rounded-xl overflow-hidden border bg-[#09090b] flex flex-col transition-all duration-200",
      isFullscreen && "fixed inset-3 z-50 shadow-2xl border-primary/20"
    )}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/80 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="size-3 rounded-full bg-red-500/80" />
            <div className="size-3 rounded-full bg-yellow-500/80" />
            <div className="size-3 rounded-full bg-green-500/80" />
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] h-5 px-1.5 gap-1 font-normal border-0 ml-2",
              connected
                ? "bg-green-500/15 text-green-400"
                : "bg-zinc-800 text-zinc-500"
            )}
          >
            {connected ? <Check className="size-2.5" /> : <XCircle className="size-2.5" />}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={() => connectPTY(termRef.current)}
            disabled={!ptyUrl || connected}
            title="Reconnect"
          >
            <RotateCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0"
        style={{
          height: isFullscreen ? 'calc(100vh - 80px)' : '500px',
          padding: '4px 0 4px 4px',
        }}
      />
    </div>
  );
};

export default XTermComponent;
