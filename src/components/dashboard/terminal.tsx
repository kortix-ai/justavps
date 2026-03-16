"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface TerminalProps {
  machineId?: string;
  machineIp?: string | null;
  machineSlug?: string;
  machineStatus?: string;
}

const WS_URL = typeof window !== 'undefined'
  ? `ws://${window.location.hostname}:4101`
  : 'ws://localhost:4101';

const XTermComponent = ({ machineId, machineIp, machineSlug, machineStatus }: TerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (!mounted || !terminalRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", Monaco, Menlo, monospace',
        theme: {
          background: '#09090b',
          foreground: '#fafafa',
          cursor: '#fafafa',
          selectionBackground: '#ffffff20',
        },
        rows: 20,
        cols: 80,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(terminalRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;
      setLoading(false);

      // Handle resize
      const onResize = () => { fit.fit(); sendResize(); };
      window.addEventListener('resize', onResize);

      // Connect if machine is ready
      if (machineId && (machineStatus === 'ready' || machineIp)) {
        connectSSH(term);
      } else {
        term.write('\x1b[33m⏳ Waiting for machine...\x1b[0m\r\n');
        if (machineIp) {
          term.write(`\r\nSSH: \x1b[36mssh -i ~/.ssh/justavps_${machineSlug} root@${machineIp}\x1b[0m\r\n`);
        }
      }

      return () => { window.removeEventListener('resize', onResize); };
    }

    init();
    return () => { mounted = false; wsRef.current?.close(); termRef.current?.dispose(); };
  }, [machineId, machineStatus]);

  function sendResize() {
    const term = termRef.current;
    if (wsRef.current?.readyState === WebSocket.OPEN && term) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function connectSSH(term: any) {
    if (!machineId) return;
    term.write('\x1b[90mConnecting via SSH...\x1b[0m\r\n');

    const ws = new WebSocket(`${WS_URL}/terminal?machine_id=${machineId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Send initial size
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31mError: ${msg.data}\x1b[0m\r\n`);
          if (machineIp) {
            term.write(`\r\nFallback SSH: \x1b[36mssh -i ~/.ssh/justavps_${machineSlug} root@${machineIp}\x1b[0m\r\n`);
          }
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[90m[Session ended]\x1b[0m\r\n`);
          setConnected(false);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[90mWebSocket terminal unavailable.\x1b[0m\r\n');
      if (machineIp) {
        term.write(`Use SSH: \x1b[36mssh -i ~/.ssh/justavps_${machineSlug} root@${machineIp}\x1b[0m\r\n`);
      }
    };

    // Forward keyboard input to SSH
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  function handleReconnect() {
    wsRef.current?.close();
    setConnected(false);
    const term = termRef.current;
    if (term) {
      term.clear();
      connectSSH(term);
    }
  }

  const copySSH = () => {
    if (machineIp && machineSlug) {
      navigator.clipboard.writeText(`ssh -i ~/.ssh/justavps_${machineSlug} -o StrictHostKeyChecking=no root@${machineIp}`);
      toast.success('SSH command copied');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            Terminal
            <Badge variant={connected ? "default" : "secondary"} className="text-xs">
              {connected ? "Connected" : "Disconnected"}
            </Badge>
          </CardTitle>
          <div className="flex gap-2">
            {machineIp && (
              <Button variant="outline" size="sm" onClick={copySSH}>Copy SSH</Button>
            )}
            <Button variant="outline" size="sm" onClick={handleReconnect} disabled={!machineId}>
              {connected ? 'Reconnect' : 'Connect'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-[#09090b] flex items-center justify-center z-10 rounded-b-lg">
              <div className="text-muted-foreground text-sm">Loading terminal...</div>
            </div>
          )}
          <div ref={terminalRef} className="rounded-b-lg" style={{ height: '360px', padding: '4px 8px', background: '#09090b' }} />
        </div>
      </CardContent>
    </Card>
  );
};

export default XTermComponent;
