"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const docs = [
  {
    id: "getting-started",
    emoji: "🚀",
    title: "Getting Started",
    description: "Create your first VPS in under 60 seconds",
    lines: [
      "1. Go to **Machines → New Machine**",
      "2. Pick a server size",
      "3. Click **Create** — ready in ~60 seconds",
      "",
      "Once ready you get:",
      "- Browser IDE at `https://{slug}.kortix.cloud`",
      "- SSH access: `ssh -i ~/.ssh/justavps_{slug} root@{ip}`",
      "- `claude` and `opencode` pre-installed",
    ],
  },
  {
    id: "connect-ide",
    emoji: "🔗",
    title: "Connect from VS Code / Cursor",
    description: "Remote SSH into your VPS from your local IDE",
    lines: [
      "1. Open VS Code or Cursor",
      '2. Command Palette → **Remote-SSH: Add New SSH Host**',
      "3. Enter: `ssh user@{your-machine-ip}`",
      "4. Connect — you're in!",
      "",
      "Port forwarding works natively through VS Code's SSH tunnel.",
    ],
  },
  {
    id: "ai-agents",
    emoji: "🤖",
    title: "AI Agents",
    description: "claude + opencode pre-installed on every machine",
    lines: [
      "**Claude Code** — SSH in, run `claude`",
      "**OpenCode** — SSH in, run `opencode`",
      "",
      "Both are pre-installed on every machine. No setup needed.",
      "Your agents run 24/7. No idle timeouts. No hour limits.",
    ],
  },
  {
    id: "proxy",
    emoji: "🌐",
    title: "Proxy & Port Forwarding",
    description: "Expose any service through the authenticated proxy",
    lines: [
      "Every port on your VPS is instantly accessible:",
      "",
      "`curl https://8000.{slug}.kortix.cloud/api -H 'Authorization: Bearer sk_live_xxx'`",
      "",
      "Supports: HTTP, WebSocket, SSE, binary data, file uploads",
      "Auth: API key header, session cookie, or `?token=` param",
      "All traffic is authenticated — nothing is publicly exposed without your key.",
    ],
  },
  {
    id: "api",
    emoji: "📡",
    title: "REST API",
    description: "Full API for programmatic access",
    lines: [
      "Base URL: `/api/v1`",
      "Auth: `Authorization: Bearer sk_live_xxx`",
      "",
      "**Endpoints:**",
      "- `POST /machines` — Provision a VPS",
      "- `GET /machines` — List machines",
      "- `GET /machines/:id` — Machine details + connect info",
      "- `DELETE /machines/:id` — Destroy",
      "- `POST /machines/:id/reboot` — Reboot",
      "- `POST /machines/:id/resize` — Change server type",
      "- `GET /server-types?region=nbg1` — Pricing",
      "",
      "Interactive docs: `/api/ui`",
    ],
  },
  {
    id: "whats-installed",
    emoji: "📦",
    title: "What's Installed",
    description: "Every machine comes with everything",
    lines: [
      "Ubuntu 24.04 + code-server (browser IDE) + Docker + Node.js + Python",
      "**claude** — Claude Code CLI",
      "**opencode** — OpenCode CLI",
      "SSH, Caddy (HTTPS), git, tmux, vim, htop, build-essential",
    ],
  },
  {
    id: "billing",
    emoji: "💳",
    title: "Billing",
    description: "Per-machine monthly billing",
    lines: [
      "Each machine has a monthly subscription based on its server type.",
      "",
      "- Machine created → subscription starts (prorated)",
      "- Machine deleted → subscription cancelled (prorated credit)",
      "- Machine resized → price updated automatically",
      "",
      "Manage billing in Settings → Billing → Stripe Portal.",
    ],
  },
];

export default function DocsPage() {
  const [expanded, setExpanded] = useState<string | null>("getting-started");

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Documentation</h1>
        <p className="text-muted-foreground mt-2">Everything you need to use JustAVPS</p>
      </div>

      <div className="space-y-3">
        {docs.map((doc) => (
          <Card
            key={doc.id}
            className="cursor-pointer transition-all hover:border-primary/30"
            onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span>{doc.emoji}</span>
                {doc.title}
                <span className="ml-auto text-muted-foreground text-sm">
                  {expanded === doc.id ? '▾' : '▸'}
                </span>
              </CardTitle>
              <CardDescription>{doc.description}</CardDescription>
            </CardHeader>
            {expanded === doc.id && (
              <CardContent className="pt-0">
                <Separator className="mb-4" />
                <div className="space-y-1.5">
                  {doc.lines.map((line, j) => {
                    if (line === '') return <div key={j} className="h-2" />;
                    if (line.startsWith('- ')) {
                      return <p key={j} className="text-sm text-muted-foreground pl-4">• {renderInlineCode(line.slice(2))}</p>;
                    }
                    if (line.match(/^\d\./)) {
                      return <p key={j} className="text-sm">{renderInlineCode(line)}</p>;
                    }
                    if (line.startsWith('**') && line.endsWith('**')) {
                      return <p key={j} className="text-sm font-semibold mt-2">{line.replace(/\*\*/g, '')}</p>;
                    }
                    if (line.startsWith('`') && line.endsWith('`')) {
                      return <pre key={j} className="text-xs bg-muted/50 p-2 rounded-md overflow-x-auto font-mono">{line.slice(1, -1)}</pre>;
                    }
                    return <p key={j} className="text-sm text-muted-foreground">{renderInlineCode(line)}</p>;
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function renderInlineCode(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="text-xs bg-muted/50 px-1.5 py-0.5 rounded font-mono">{part.slice(1, -1)}</code>;
    }
    // Bold
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) => {
      if (bp.startsWith('**') && bp.endsWith('**')) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      return bp;
    });
  });
}
