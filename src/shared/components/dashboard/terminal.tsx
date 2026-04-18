"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "@/shared/ui/button";
import { RotateCw, Maximize2, Minimize2, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface TerminalProps {
  machineSlug?: string;
  machineStatus?: string;
  machineIp?: string | null;
  /** Full terminal page URL (e.g. https://slug.kortix.cloud/_terminal) */
  terminalUrl?: string | null;
}

async function fetchAuthUrl(terminalUrl: string): Promise<string> {
  try {
    const res = await fetch("/api/proxy-auth", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        const url = new URL(terminalUrl);
        url.searchParams.set("token", data.token);
        return url.toString();
      }
    }
  } catch {
    /* fallback to cookie auth */
  }
  return terminalUrl;
}

export default function WebTerminal({
  machineSlug,
  machineStatus,
  machineIp,
  terminalUrl,
}: TerminalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const isReady = machineStatus === "ready" || !!machineIp;
  const shouldConnect = !!(terminalUrl && isReady);

  // Fetch auth URL on mount and when terminal URL changes
  useEffect(() => {
    if (!shouldConnect || !terminalUrl) return;
    let cancelled = false;
    fetchAuthUrl(terminalUrl).then((url) => {
      if (!cancelled) setAuthUrl(url);
    });
    return () => { cancelled = true; };
  }, [shouldConnect, terminalUrl]);

  const handleReload = useCallback(() => {
    if (!terminalUrl) return;
    setIframeLoaded(false);
    fetchAuthUrl(terminalUrl).then((url) => {
      setAuthUrl(url);
      setIframeKey((k) => k + 1);
    });
  }, [terminalUrl]);

  const handleOpenNewTab = useCallback(async () => {
    if (!terminalUrl) return;
    const url = await fetchAuthUrl(terminalUrl);
    window.open(url, "_blank");
  }, [terminalUrl]);

  const handleIframeLoad = useCallback(() => {
    setIframeLoaded(true);
    // Focus the terminal inside the iframe
    setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage({ type: "focus" }, "*");
    }, 100);
  }, []);

  const loading = useMemo(() => !authUrl || !iframeLoaded, [authUrl, iframeLoaded]);

  // Not ready state
  if (!isReady || !terminalUrl) {
    return (
      <div className="rounded-xl border bg-[#09090b] overflow-hidden">
        <div className="flex items-center justify-center h-[400px]">
          <div className="text-center space-y-2">
            <Loader2 className="size-5 animate-spin text-yellow-500 mx-auto" />
            <p className="text-sm text-zinc-500">
              Waiting for machine to be ready...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden border bg-[#09090b] flex flex-col transition-all duration-200",
        isFullscreen && "fixed inset-3 z-50 shadow-2xl border-primary/20",
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-red-500/80" />
            <div className="size-2.5 rounded-full bg-yellow-500/80" />
            <div className="size-2.5 rounded-full bg-green-500/80" />
          </div>
          <span className="text-[11px] text-zinc-500 font-mono ml-1.5">
            {machineSlug}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={handleReload}
            title="Reconnect"
          >
            <RotateCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={handleOpenNewTab}
            title="Open in new tab"
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Terminal iframe */}
      <div
        className="relative overflow-hidden"
        style={{
          height: isFullscreen ? "calc(100vh - 68px)" : "600px",
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#09090b] z-10">
            <div className="text-center space-y-2">
              <Loader2 className="size-5 animate-spin text-zinc-500 mx-auto" />
              <p className="text-xs text-zinc-600">Connecting...</p>
            </div>
          </div>
        )}
        {authUrl && (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={authUrl}
            onLoad={handleIframeLoad}
            className="block border-0"
            style={{ width: "100%", height: "100%" }}
            allow="clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>
    </div>
  );
}
