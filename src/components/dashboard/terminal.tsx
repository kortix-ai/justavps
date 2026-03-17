"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Terminal as TerminalIcon, Copy, RotateCw, Maximize2, Minimize2, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!terminalRef.current) return;

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      // Prevent double initialization
      if (termRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        theme: {
          background: '#09090b', // Zinc 950
          foreground: '#fafafa', // Zinc 50
          cursor: '#a1a1aa',     // Zinc 400
          selectionBackground: 'rgba(255, 255, 255, 0.2)',
        },
        rows: 20,
        cols: 80,
      });

      const fit = new FitAddon();
      const webLinks = new WebLinksAddon();

      term.loadAddon(fit);
      term.loadAddon(webLinks);
      
      term.open(terminalRef.current);
      fit.fit();
      
      termRef.current = term;
      fitRef.current = fit;

      // Handle resize
      const onResize = () => {
        if (fitRef.current) {
          try {
            fitRef.current.fit();
            sendResize();
          } catch (e) {
            console.error("Terminal resize error:", e);
          }
        }
      };

      window.addEventListener('resize', onResize);

      // Connect if machine is ready
      if (machineId && (machineStatus === 'ready' || machineIp)) {
        connectSSH(term);
      } else {
        term.write('\x1b[33mWaiting for machine initialization...\x1b[0m\r\n');
        if (machineIp) {
          term.write(`\r\nAlternate SSH command:\r\nssh -i ~/.ssh/justavps_${machineSlug} root@${machineIp}\r\n`);
        }
      }

      return () => {
        window.removeEventListener('resize', onResize);
      };
    }

    init();

    return () => {
      mounted = false;
      wsRef.current?.close();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [machineId, machineStatus]); // Re-init if machine changes

  // Handle fullscreen toggle resize
  useEffect(() => {
    if (fitRef.current) {
      setTimeout(() => {
        try {
          fitRef.current.fit();
          sendResize();
          termRef.current?.focus();
        } catch (e) { console.error(e); }
      }, 100);
    }
  }, [isFullscreen]);

  function sendResize() {
    const term = termRef.current;
    if (wsRef.current?.readyState === WebSocket.OPEN && term) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function connectSSH(term: any) {
    if (!machineId) return;
    
    // Close existing connection if any
    wsRef.current?.close();

    term.write('\x1b[90mConnecting...\x1b[0m\r\n');

    const ws = new WebSocket(`${WS_URL}/terminal?machine_id=${machineId}`);
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
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31mError: ${msg.data}\x1b[0m\r\n`);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[90m[Process exited]\x1b[0m\r\n`);
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
      term.write('\r\n\x1b[31mConnection failed.\x1b[0m\r\n');
    };

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  const copySSH = () => {
    if (machineIp && machineSlug) {
      navigator.clipboard.writeText(`ssh -i ~/.ssh/justavps_${machineSlug} -o StrictHostKeyChecking=no root@${machineIp}`);
      toast.success('SSH command copied');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-300", 
      isFullscreen && "fixed inset-4 z-50 h-auto shadow-2xl border-primary/20"
    )}>
      <CardHeader className="flex flex-row items-center justify-between p-3 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TerminalIcon className="size-4 text-muted-foreground" />
            Terminal
          </CardTitle>
          <Badge 
            variant={connected ? "default" : "secondary"} 
            className={cn(
              "text-[10px] h-5 px-1.5 gap-1 font-normal",
              connected ? "bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 border-green-500/20" : ""
            )}
          >
            {connected ? <Check className="size-3" /> : <XCircle className="size-3" />}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
        
        <div className="flex items-center gap-1">
          {machineIp && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={copySSH}>
              <Copy className="size-3.5" />
              <span className="hidden sm:inline">Copy SSH</span>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => connectSSH(termRef.current)} disabled={!machineId || connected} title="Reconnect">
            <RotateCw className={cn("size-3.5", !connected && "text-muted-foreground")} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0 bg-[#09090b]">
        <div 
          ref={terminalRef} 
          className="w-full relative"
          style={{ 
            height: isFullscreen ? 'calc(100vh - 100px)' : '400px',
          }}
        >
          {/* Terminal is mounted here */}
        </div>
      </CardContent>
    </Card>
  );
};

export default XTermComponent;
