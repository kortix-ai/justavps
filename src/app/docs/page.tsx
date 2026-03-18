"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Book,
  Server,
  Globe,
  Code2,
  CreditCard,
  HardDrive,
  Search,
  ChevronRight,
  Copy,
  Check,
  ArrowRight,
  Cpu,
  Shield,
  Zap,
  Menu,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DocSection {
  id: string;
  title: string;
  icon: React.ElementType;
  subsections: { id: string; title: string }[];
}

/* ------------------------------------------------------------------ */
/*  Docs navigation tree                                               */
/* ------------------------------------------------------------------ */

const sections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Zap,
    subsections: [
      { id: "create-machine", title: "Create a Machine" },
      { id: "connect-ssh", title: "Connect via SSH" },
      { id: "connect-ide", title: "Connect from IDE" },
      { id: "browser-ide", title: "Browser IDE" },
    ],
  },
  {
    id: "ai-agents",
    title: "AI Agents",
    icon: Cpu,
    subsections: [
      { id: "claude-code", title: "Claude Code" },
      { id: "opencode", title: "OpenCode" },
      { id: "always-on", title: "Always-On Agents" },
    ],
  },
  {
    id: "proxy",
    title: "Proxy & Networking",
    icon: Globe,
    subsections: [
      { id: "how-proxy-works", title: "How the Proxy Works" },
      { id: "port-forwarding", title: "Port Forwarding" },
      { id: "proxy-auth", title: "Authentication" },
      { id: "websocket-sse", title: "WebSocket & SSE" },
    ],
  },
  {
    id: "api-reference",
    title: "REST API",
    icon: Code2,
    subsections: [
      { id: "api-auth", title: "Authentication" },
      { id: "api-machines", title: "Machines" },
      { id: "api-server-types", title: "Server Types" },
      { id: "api-snapshots", title: "Snapshots" },
      { id: "api-ssh-keys", title: "SSH Keys" },
      { id: "api-keys-endpoint", title: "API Keys" },
    ],
  },
  {
    id: "snapshots",
    title: "Snapshots",
    icon: HardDrive,
    subsections: [
      { id: "default-snapshot", title: "Default Snapshot" },
      { id: "custom-snapshots", title: "Custom Snapshots" },
      { id: "create-snapshot", title: "Create a Snapshot" },
      { id: "provision-from-snapshot", title: "Provision from Snapshot" },
    ],
  },
  {
    id: "whats-installed",
    title: "What's Installed",
    icon: Server,
    subsections: [
      { id: "base-software", title: "Base Software" },
      { id: "dev-tools", title: "Dev Tools" },
      { id: "services", title: "Services" },
    ],
  },
  {
    id: "security",
    title: "Security",
    icon: Shield,
    subsections: [
      { id: "network-security", title: "Network Security" },
      { id: "proxy-auth-model", title: "Auth Model" },
      { id: "ssh-security", title: "SSH Access" },
    ],
  },
  {
    id: "billing",
    title: "Billing",
    icon: CreditCard,
    subsections: [
      { id: "pricing", title: "Pricing" },
      { id: "billing-cycle", title: "Billing Cycle" },
      { id: "manage-billing", title: "Manage Billing" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  CopyButton                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={handleCopy} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors duration-150", className)} aria-label="Copy to clipboard">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  CodeBlock                                                          */
/* ------------------------------------------------------------------ */

function CodeBlock({ children, title }: { children: string; lang?: string; title?: string }) {
  return (
    <div className={cn("group relative my-4 rounded-lg border overflow-hidden", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950")}>
      {title && (
        <div className={cn("flex items-center justify-between border-b px-4 py-2", "border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60")}>
          <span className="text-xs text-muted-foreground font-mono">{title}</span>
          <CopyButton text={children.trim()} />
        </div>
      )}
      {!title && <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"><CopyButton text={children.trim()} /></div>}
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed"><code className="font-mono text-zinc-800 dark:text-zinc-200">{children.trim()}</code></pre>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className={cn("rounded-md px-1.5 py-0.5 text-[13px] font-mono border", "bg-zinc-100 text-zinc-800 border-zinc-200", "dark:bg-zinc-800/60 dark:text-zinc-200 dark:border-zinc-700/60")}>{children}</code>;
}

/* ------------------------------------------------------------------ */
/*  Headings                                                           */
/* ------------------------------------------------------------------ */

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="group scroll-mt-6 text-xl font-semibold tracking-tight mt-12 mb-4 first:mt-0"><a href={`#${id}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">{children}<span className="opacity-0 group-hover:opacity-40 transition-opacity text-sm">#</span></a></h2>;
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="group scroll-mt-6 text-base font-semibold tracking-tight mt-8 mb-3"><a href={`#${id}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">{children}<span className="opacity-0 group-hover:opacity-40 transition-opacity text-xs">#</span></a></h3>;
}

/* ------------------------------------------------------------------ */
/*  Prose                                                              */
/* ------------------------------------------------------------------ */

function P({ children }: { children: React.ReactNode }) { return <p className="text-[14.5px] leading-relaxed text-muted-foreground mb-4">{children}</p>; }
function Ul({ children }: { children: React.ReactNode }) { return <ul className="mb-4 ml-1 space-y-2 text-[14.5px] leading-relaxed text-muted-foreground">{children}</ul>; }
function Li({ children }: { children: React.ReactNode }) { return <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40" /><span>{children}</span></li>; }
function Strong({ children }: { children: React.ReactNode }) { return <strong className="font-medium text-foreground">{children}</strong>; }

function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "tip" | "warning" }) {
  const styles = { info: cn("border-blue-400/40 bg-blue-50 text-blue-900", "dark:border-blue-500/20 dark:bg-blue-950/30 dark:text-blue-200/90"), tip: cn("border-emerald-400/40 bg-emerald-50 text-emerald-900", "dark:border-emerald-500/20 dark:bg-emerald-950/30 dark:text-emerald-200/90"), warning: cn("border-amber-400/40 bg-amber-50 text-amber-900", "dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200/90") };
  const labels = { info: "Note", tip: "Tip", warning: "Warning" };
  return <div className={cn("my-4 rounded-lg border-l-2 px-4 py-3 text-[14px]", styles[type])}><span className="mb-1 block text-xs font-semibold uppercase tracking-wider opacity-60">{labels[type]}</span>{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Endpoint                                                           */
/* ------------------------------------------------------------------ */

function Endpoint({ method, path, description }: { method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH"; path: string; description: string }) {
  const colors: Record<string, string> = {
    GET: cn("bg-emerald-100 text-emerald-700 border-emerald-200", "dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20"),
    POST: cn("bg-blue-100 text-blue-700 border-blue-200", "dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/20"),
    DELETE: cn("bg-red-100 text-red-700 border-red-200", "dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/20"),
    PUT: cn("bg-amber-100 text-amber-700 border-amber-200", "dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/20"),
    PATCH: cn("bg-purple-100 text-purple-700 border-purple-200", "dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/20"),
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 mb-2", "border-zinc-200 bg-zinc-50/50", "dark:border-zinc-800/60 dark:bg-zinc-900/30")}>
      <span className={cn("shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold font-mono", colors[method])}>{method}</span>
      <div className="min-w-0"><code className="text-[13px] font-mono text-foreground/90">{path}</code><p className="text-xs text-muted-foreground mt-0.5">{description}</p></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Table                                                              */
/* ------------------------------------------------------------------ */

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className={cn("my-4 overflow-x-auto rounded-lg border", "border-zinc-200 dark:border-zinc-800/60")}>
      <table className="w-full text-[13.5px]">
        <thead><tr className={cn("border-b", "border-zinc-200 bg-zinc-100/60", "dark:border-zinc-800/60 dark:bg-zinc-900/40")}>{headers.map((h, i) => <th key={i} className="px-4 py-2.5 text-left font-medium text-foreground/80">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className={cn("border-b last:border-0", "border-zinc-100 dark:border-zinc-800/40")}>{row.map((cell, j) => <td key={j} className="px-4 py-2.5 text-muted-foreground">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  QuickLink                                                          */
/* ------------------------------------------------------------------ */

function QuickLink({ icon: Icon, title, description, href }: { icon: React.ElementType; title: string; description: string; href: string }) {
  return (
    <a href={`#${href}`} className={cn("group flex flex-col gap-2 rounded-lg border p-4 transition-all", "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50", "dark:border-zinc-800/60 dark:bg-zinc-900/20 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50")}>
      <div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" /><span className="text-sm font-medium text-foreground">{title}</span><ArrowRight className="size-3 ml-auto text-transparent group-hover:text-muted-foreground transition-all group-hover:translate-x-0.5" /></div>
      <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
    </a>
  );
}

function DocSeparator() { return <hr className="my-10 border-zinc-200 dark:border-zinc-800/50" />; }

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("getting-started");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => { for (const entry of entries) { if (entry.isIntersecting) setActiveSection(entry.target.id); } }, { rootMargin: "-20px 0px -70% 0px", threshold: 0 });
    const allIds = sections.flatMap((s) => [s.id, ...s.subsections.map((sub) => sub.id)]);
    for (const id of allIds) { const el = document.getElementById(id); if (el) observer.observe(el); }
    return () => observer.disconnect();
  }, []);

  const q = searchQuery.toLowerCase();
  const filteredSections = q ? sections.filter((s) => s.title.toLowerCase().includes(q) || s.subsections.some((sub) => sub.title.toLowerCase().includes(q))) : sections;

  const scrollTo = (id: string) => { setSearchQuery(""); const el = document.getElementById(id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); setMobileNavOpen(false); } };

  const activeParent = sections.find((s) => s.id === activeSection || s.subsections.some((sub) => sub.id === activeSection));

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile toggle */}
      <button onClick={() => setMobileNavOpen(!mobileNavOpen)} className={cn("fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full shadow-lg lg:hidden", "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900")}>
        {mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>
      {mobileNavOpen && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />}

      {/* ── Sidebar ── */}
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto transition-transform duration-200 lg:transition-none", mobileNavOpen ? "translate-x-0" : "-translate-x-full", "lg:static lg:translate-x-0 lg:w-64 lg:shrink-0 lg:overflow-y-auto", "border-r border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800/60 dark:bg-zinc-950/95 dark:backdrop-blur-sm", "lg:bg-transparent lg:dark:bg-transparent lg:backdrop-blur-none lg:dark:backdrop-blur-none")}>
        <div className="px-4 pt-6 pb-3">
          <div className="flex items-center gap-2 mb-5 px-1"><Book className="size-4 text-foreground/70" /><span className="text-sm font-semibold tracking-tight">Documentation</span></div>
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
            <input type="text" placeholder="Search docs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} className={cn("w-full rounded-md border py-1.5 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/50", searchFocused ? "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800/60" : "border-zinc-200 bg-zinc-100/50 dark:border-zinc-800 dark:bg-zinc-900/40")} />
          </div>
        </div>
        <nav className="px-3 pb-8">
          {filteredSections.length === 0 && <p className="px-2.5 py-4 text-xs text-muted-foreground/60">No results for &ldquo;{searchQuery}&rdquo;</p>}
          {filteredSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id || section.subsections.some((sub) => sub.id === activeSection);
            const isExpanded = q ? true : isActive;
            return (
              <div key={section.id} className="mb-1">
                <button onClick={() => scrollTo(section.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", isActive ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground/80")}><Icon className="size-3.5 shrink-0" />{section.title}</button>
                {isExpanded && (
                  <div className={cn("ml-[22px] border-l pl-2.5 mt-0.5 mb-2", "border-zinc-200 dark:border-zinc-800")}>
                    {section.subsections.filter((sub) => !q || section.title.toLowerCase().includes(q) || sub.title.toLowerCase().includes(q)).map((sub) => (
                      <button key={sub.id} onClick={() => scrollTo(sub.id)} className={cn("block w-full text-left rounded-md px-2 py-1 text-[12.5px] transition-colors", activeSection === sub.id ? "text-foreground font-medium" : q && sub.title.toLowerCase().includes(q) ? "text-foreground/80" : "text-muted-foreground/70 hover:text-muted-foreground")}>{sub.title}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 lg:px-10">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 mb-6">
          <span>Docs</span>{activeParent && <><ChevronRight className="size-3" /><span className="text-muted-foreground">{activeParent.title}</span></>}
        </div>

        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-3">JustAVPS Documentation</h1>
          <P>Everything you need to provision, connect, and manage your always-on VPS instances. Machines come ready with a browser IDE, SSH access, and AI coding tools pre-installed.</P>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
          <QuickLink icon={Zap} title="Getting Started" description="Create your first VPS in under 60 seconds" href="getting-started" />
          <QuickLink icon={Cpu} title="AI Agents" description="Claude Code & OpenCode pre-installed on every machine" href="ai-agents" />
          <QuickLink icon={Globe} title="Proxy & Networking" description="Dedicated subdomain with automatic TLS" href="proxy" />
          <QuickLink icon={Code2} title="REST API" description="Full API reference for programmatic access" href="api-reference" />
        </div>

        <DocSeparator />

        {/* ── GETTING STARTED ── */}
        <H2 id="getting-started">Getting Started</H2>
        <P>Get a fully-configured VPS running in under 60 seconds. Every machine includes Ubuntu 24.04, a browser IDE (OpenCode), Docker, Node.js, Python, and SSH access out of the box.</P>

        <H3 id="create-machine">Create a Machine</H3>
        <P>Navigate to <Strong>Machines → New Machine</Strong> in the dashboard. Pick a snapshot, choose your plan, and deploy.</P>
        <Ul>
          <Li>Select a snapshot — use the default base snapshot or one you&apos;ve built from a Docker image</Li>
          <Li>Pick a plan — Starter, Pro, or Power (or expand custom options for the full server type catalog)</Li>
          <Li>Optionally choose a region — auto-detected from your location, or pick manually</Li>
          <Li>Give it a name (optional) and click <Strong>Deploy Machine</Strong></Li>
        </Ul>
        <Callout type="tip">Your machine will be ready in ~60 seconds. You&apos;ll get a browser IDE URL, SSH command, and dedicated subdomain automatically.</Callout>

        <H3 id="connect-ssh">Connect via SSH</H3>
        <P>Once your machine is ready, the dashboard shows a one-time setup command that saves the SSH key locally:</P>
        <CodeBlock lang="bash" title="Setup (run once)">{`mkdir -p ~/.ssh && echo '...' > ~/.ssh/justavps_{slug} && chmod 600 ~/.ssh/justavps_{slug}`}</CodeBlock>
        <P>Then connect anytime:</P>
        <CodeBlock lang="bash" title="Connect">{`ssh -i ~/.ssh/justavps_{slug} root@{ip}`}</CodeBlock>
        <P>Each machine gets its own auto-generated SSH keypair. The private key and full setup command are on your machine&apos;s detail page.</P>

        <H3 id="connect-ide">Connect from VS Code / Cursor</H3>
        <P>Use the Remote-SSH extension to connect your local IDE:</P>
        <CodeBlock lang="text" title="Steps">{`1. Open VS Code or Cursor
2. Command Palette → Remote-SSH: Add New SSH Host
3. Enter: ssh root@{your-machine-ip}
4. Connect — you're in`}</CodeBlock>
        <P>Port forwarding works natively through VS Code&apos;s SSH tunnel. Any service running on your VPS is accessible locally.</P>

        <H3 id="browser-ide">Browser IDE</H3>
        <P>Every machine comes with OpenCode — a full-featured AI coding IDE in your browser:</P>
        <CodeBlock lang="text">{`https://{slug}.kortix.cloud`}</CodeBlock>
        <P>Authentication is handled by the Cloudflare Worker proxy — no separate password needed. Just log in to your JustAVPS account and access the IDE directly.</P>

        <DocSeparator />

        {/* ── AI AGENTS ── */}
        <H2 id="ai-agents">AI Agents</H2>
        <P>JustAVPS is built for AI agent workflows. Every machine comes with the tools you need to run AI coding agents 24/7 — no idle timeouts, no hour limits.</P>

        <H3 id="claude-code">Claude Code</H3>
        <P>Claude Code comes pre-installed on every machine. SSH in and start coding immediately:</P>
        <CodeBlock lang="bash" title="Terminal">{`ssh root@{your-machine-ip}
claude`}</CodeBlock>
        <P>Or install / update manually:</P>
        <CodeBlock lang="bash">{`npm install -g @anthropic-ai/claude-code
claude`}</CodeBlock>

        <H3 id="opencode">OpenCode</H3>
        <P>OpenCode is pre-installed on every machine. Both CLI and Web UI are available:</P>
        <CodeBlock lang="bash" title="CLI access">{`ssh root@{your-machine-ip}
opencode`}</CodeBlock>
        <P>The OpenCode Web UI runs as a systemd service on port 3456. Access it by SSH-tunneling or through VS Code&apos;s port forwarding.</P>

        <H3 id="always-on">Always-On Agents</H3>
        <P>Unlike ephemeral sandbox providers, JustAVPS machines run 24/7:</P>
        <Ul>
          <Li><Strong>No idle timeouts</Strong> — your machine stays running indefinitely</Li>
          <Li><Strong>No hour limits</Strong> — pay monthly, run continuously</Li>
          <Li><Strong>Persistent storage</Strong> — your files, configs, and data persist across reboots</Li>
          <Li><Strong>systemd services</Strong> — agents auto-restart on crash via systemd</Li>
        </Ul>

        <DocSeparator />

        {/* ── PROXY & NETWORKING ── */}
        <H2 id="proxy">Proxy &amp; Networking</H2>
        <P>Every machine gets a dedicated subdomain on <InlineCode>kortix.cloud</InlineCode> with automatic DNS and TLS. Caddy runs on each VPS as a reverse proxy.</P>

        <H3 id="how-proxy-works">How the Proxy Works</H3>
        <P>When a machine is provisioned, a Cloudflare DNS A record is created pointing <InlineCode>&#123;slug&#125;.kortix.cloud</InlineCode> to the machine&apos;s IP. Caddy on the VPS handles TLS via ACME and reverse-proxies to OpenCode on port 3456.</P>
        <CodeBlock lang="text" title="Your machine URL">{`https://{slug}.kortix.cloud → OpenCode (port 3456)`}</CodeBlock>

        <H3 id="port-forwarding">Port Forwarding</H3>
        <P>To access other services running on your VPS (APIs, web apps, databases), use SSH port forwarding or VS Code&apos;s built-in tunnel:</P>
        <CodeBlock lang="bash" title="SSH tunnel">{`# Forward local port 3000 to your VPS port 3000
ssh -i ~/.ssh/justavps_{slug} -L 3000:localhost:3000 root@{ip}`}</CodeBlock>
        <P>In VS Code Remote-SSH, port forwarding is automatic — any service you start on the VPS is available on your local machine through the tunnel.</P>

        <H3 id="proxy-auth">Authentication</H3>
        <P>The browser IDE (OpenCode) at <InlineCode>&#123;slug&#125;.kortix.cloud</InlineCode> is protected by the Cloudflare Worker proxy:</P>
        <Ul>
          <Li><Strong>Browser IDE</Strong> — authentication is handled by the Cloudflare Worker proxy (no separate password needed)</Li>
          <Li><Strong>SSH</Strong> — key-based authentication only (password auth disabled)</Li>
        </Ul>
        <Callout type="info">Auth for the browser IDE is handled at the proxy layer by the Cloudflare Worker — only authenticated users can reach your machine&apos;s IDE.</Callout>

        <H3 id="websocket-sse">WebSocket &amp; SSE</H3>
        <P>The proxy supports WebSocket connections, used by:</P>
        <Ul>
          <Li><Strong>Browser terminal</Strong> — the dashboard embeds an xterm.js terminal via WebSocket PTY</Li>
          <Li><Strong>OpenCode</Strong> — the browser IDE uses WebSocket for its editor protocol</Li>
        </Ul>

        <DocSeparator />

        {/* ── API REFERENCE ── */}
        <H2 id="api-reference">REST API</H2>
        <P>Full programmatic access to manage machines, snapshots, keys, and more. All endpoints require authentication via API key.</P>
        <CodeBlock lang="text" title="Base URL">{`https://justavps.com/api/v1`}</CodeBlock>

        <H3 id="api-auth">Authentication</H3>
        <P>Include your API key in the <InlineCode>Authorization</InlineCode> header:</P>
        <CodeBlock lang="bash" title="Example request">{`curl https://justavps.com/api/v1/machines \\
  -H "Authorization: Bearer sk_live_xxx"`}</CodeBlock>
        <P>Generate API keys in <Strong>Keys</Strong> in the dashboard. Keys use the <InlineCode>sk_live_</InlineCode> prefix and are shown once at creation — store them securely.</P>

        <H3 id="api-machines">Machines</H3>
        <div className="space-y-2 my-4">
          <Endpoint method="POST" path="/v1/machines" description="Provision a new VPS (202 Accepted)" />
          <Endpoint method="GET" path="/v1/machines" description="List all machines" />
          <Endpoint method="GET" path="/v1/machines/:id" description="Get machine details + connection info" />
          <Endpoint method="DELETE" path="/v1/machines/:id" description="Destroy a machine (204)" />
          <Endpoint method="POST" path="/v1/machines/:id/reboot" description="Reboot a machine (202)" />
          <Endpoint method="POST" path="/v1/machines/:id/resize" description="Resize — body: { server_type }" />
          <Endpoint method="GET" path="/v1/machines/:id/status/stream" description="SSE stream of provisioning events" />
        </div>
        <P>Create a machine:</P>
        <CodeBlock lang="bash" title="POST /v1/machines">{`curl -X POST https://justavps.com/api/v1/machines \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "server_type": "cpx32",
    "region": "hel1",
    "name": "my-machine"
  }'`}</CodeBlock>
        <P>Response includes connection info once the machine is ready:</P>
        <CodeBlock lang="json" title="202 Accepted">{`{
  "id": "...",
  "slug": "abc123",
  "status": "provisioning",
  "server_type": "cpx32",
  "region": "hel1",
  "ip": null,
  "urls": null,
  "ssh": null,
  "connect": null,
  "price_monthly": 15,
  "created_at": "2026-03-18T00:00:00Z"
}`}</CodeBlock>
        <P>Optional fields: <InlineCode>env_vars</InlineCode> (key-value pairs injected as environment variables), <InlineCode>docker_image</InlineCode> (override the snapshot&apos;s Docker image), <InlineCode>entrypoint</InlineCode> (override the snapshot&apos;s entrypoint).</P>

        <H3 id="api-server-types">Server Types</H3>
        <div className="space-y-2 my-4">
          <Endpoint method="GET" path="/v1/server-types?region=hel1" description="List server types with pricing" />
          <Endpoint method="GET" path="/v1/server-types/providers" description="List available providers" />
          <Endpoint method="GET" path="/v1/server-types/regions" description="List available regions" />
        </div>
        <CodeBlock lang="json" title="Response">{`{
  "provider": "cloud",
  "region": "hel1",
  "server_types": [
    {
      "name": "cpx32",
      "vcpu": 2,
      "ram_gb": 4,
      "disk_gb": 80,
      "cpu_type": "shared",
      "architecture": "x86",
      "price_monthly": 15
    }
  ]
}`}</CodeBlock>

        <H3 id="api-snapshots">Snapshots</H3>
        <div className="space-y-2 my-4">
          <Endpoint method="POST" path="/v1/snapshots" description="Create a snapshot from a Docker image" />
          <Endpoint method="GET" path="/v1/snapshots" description="List all snapshots" />
          <Endpoint method="GET" path="/v1/snapshots/:id" description="Get snapshot details" />
          <Endpoint method="POST" path="/v1/snapshots/:id/build" description="Build snapshot on another provider" />
          <Endpoint method="DELETE" path="/v1/snapshots/:id" description="Delete a snapshot" />
        </div>

        <H3 id="api-ssh-keys">SSH Keys</H3>
        <div className="space-y-2 my-4">
          <Endpoint method="POST" path="/v1/ssh-keys" description="Add an SSH public key" />
          <Endpoint method="GET" path="/v1/ssh-keys" description="List SSH keys" />
          <Endpoint method="DELETE" path="/v1/ssh-keys/:id" description="Remove an SSH key" />
        </div>

        <H3 id="api-keys-endpoint">API Keys</H3>
        <div className="space-y-2 my-4">
          <Endpoint method="POST" path="/v1/api-keys" description="Create a new API key (key shown once)" />
          <Endpoint method="GET" path="/v1/api-keys" description="List API keys (prefix only)" />
          <Endpoint method="DELETE" path="/v1/api-keys/:id" description="Revoke an API key" />
        </div>

        <DocSeparator />

        {/* ── SNAPSHOTS ── */}
        <H2 id="snapshots">Snapshots</H2>
        <P>Snapshots are bootable machine images. Every machine is provisioned from a snapshot. You get a default snapshot out of the box, and you can create custom ones from any Docker image.</P>

        <H3 id="default-snapshot">Default Snapshot</H3>
        <P>Every account comes with a <Strong>default snapshot</Strong> that includes the full JustAVPS platform: Ubuntu 24.04, OpenCode (browser IDE), Docker, Node.js, Python, Claude Code, and all dev tools. This is what most users provision from.</P>
        <Callout type="tip">The default snapshot is ready to use immediately — no setup needed. Just deploy a machine and start working.</Callout>

        <H3 id="custom-snapshots">Custom Snapshots</H3>
        <P>Create custom snapshots from any Docker image. The platform bakes your Docker image into a full bootable snapshot with the entire JustAVPS platform pre-installed on top.</P>
        <Ul>
          <Li>Navigate to <Strong>Snapshots</Strong> in the dashboard</Li>
          <Li>Enter a Docker image (e.g. <InlineCode>node:20</InlineCode>, <InlineCode>python:3.12</InlineCode>, or your own)</Li>
          <Li>Optionally set a custom entrypoint</Li>
          <Li>The snapshot builds automatically — once ready, use it to provision machines</Li>
        </Ul>

        <H3 id="create-snapshot">Create a Snapshot</H3>
        <P>Create a snapshot via the dashboard or the API:</P>
        <CodeBlock lang="bash" title="POST /v1/snapshots">{`curl -X POST https://justavps.com/api/v1/snapshots \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-node-app",
    "docker_image": "node:20-slim"
  }'`}</CodeBlock>

        <H3 id="provision-from-snapshot">Provision from Snapshot</H3>
        <P>Pass a <InlineCode>snapshot_id</InlineCode> when creating a machine to provision from any of your snapshots:</P>
        <CodeBlock lang="bash">{`curl -X POST https://justavps.com/api/v1/machines \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "snapshot_id": "...",
    "server_type": "cpx32",
    "region": "hel1"
  }'`}</CodeBlock>
        <P>You can also override the Docker image or entrypoint at provision time by passing <InlineCode>docker_image</InlineCode> or <InlineCode>entrypoint</InlineCode> in the request body.</P>

        <DocSeparator />

        {/* ── WHAT'S INSTALLED ── */}
        <H2 id="whats-installed">What&apos;s Installed</H2>
        <P>Every machine ships with a comprehensive software stack on Ubuntu 24.04 LTS.</P>

        <H3 id="base-software">Base Software</H3>
        <Table headers={["Software", "Description"]} rows={[
          ["Ubuntu 24.04 LTS", "Base operating system"],
          ["opencode-web", "OpenCode IDE in the browser (port 3456)"],
          ["Caddy", "Reverse proxy with automatic HTTPS"],
          ["Docker CE", "Container runtime"],
          ["Node.js 22 LTS", "Via nodesource, system-wide"],
          ["Python 3 + pip", "Python toolchain"],
          ["Claude Code", "AI coding agent CLI"],
          ["OpenCode", "AI coding agent CLI + Web UI"],
        ]} />

        <H3 id="dev-tools">Dev Tools</H3>
        <Table headers={["Tool", "Purpose"]} rows={[
          ["git", "Version control"],
          ["tmux", "Terminal multiplexer"],
          ["vim / nano", "Text editors"],
          ["htop", "Process monitor"],
          ["curl / wget", "HTTP clients"],
          ["build-essential", "C/C++ compiler toolchain"],
          ["unzip", "Archive extraction"],
          ["jq", "JSON processor"],
        ]} />

        <H3 id="services">Services</H3>
        <P>The following run as systemd services:</P>
        <Table headers={["Service", "Port", "Purpose"]} rows={[
          ["opencode-web", "3456", "OpenCode Browser IDE"],
          ["Caddy", "80 / 443", "Reverse proxy + TLS"],
          ["opencode-web", "3456", "OpenCode Web UI"],
        ]} />

        <DocSeparator />

        {/* ── SECURITY ── */}
        <H2 id="security">Security</H2>
        <P>Every machine is a full Linux VPS — you have root access and full control over the security configuration inside your box.</P>

        <H3 id="network-security">Network Security</H3>
        <Ul>
          <Li><Strong>Cloudflare DNS</Strong> — your subdomain (<InlineCode>&#123;slug&#125;.kortix.cloud</InlineCode>) is proxied through Cloudflare</Li>
          <Li><Strong>TLS</Strong> — Caddy handles automatic HTTPS via ACME / Let&apos;s Encrypt</Li>
          <Li><Strong>Daily backups</Strong> — automatic backups are enabled on every machine</Li>
          <Li><Strong>Static IP</Strong> — each machine gets a dedicated public IPv4 address</Li>
        </Ul>

        <H3 id="proxy-auth-model">Auth Model</H3>
        <Ul>
          <Li><Strong>Browser IDE</Strong> — protected by Cloudflare Worker proxy authentication</Li>
          <Li><Strong>SSH</Strong> — key-based auth only, password login disabled</Li>
          <Li><Strong>API</Strong> — all API endpoints require a <InlineCode>Bearer sk_live_*</InlineCode> token</Li>
        </Ul>

        <H3 id="ssh-security">SSH Access</H3>
        <P>SSH uses key-based authentication with password login disabled. Each machine gets an auto-generated keypair. The private key is shown once in the dashboard — save it locally via the setup command.</P>

        <DocSeparator />

        {/* ── BILLING ── */}
        <H2 id="billing">Billing</H2>
        <P>Simple per-machine monthly billing through Stripe. No surprises.</P>

        <H3 id="pricing">Pricing</H3>
        <P>Each machine has a monthly price based on its server type, shown in the provisioning wizard. Pricing scales with CPU, RAM, and disk.</P>
        <P>Featured plans in the wizard:</P>
        <Table headers={["Plan", "Best for"]} rows={[
          ["Starter", "Single agent, light workloads"],
          ["Pro", "Best value for most workloads"],
          ["Power", "Heavy agents & parallel tasks"],
        ]} />
        <P>Expand <Strong>Custom size &amp; region</Strong> in the wizard to see all available server types with exact vCPU, RAM, disk, and pricing for your selected region.</P>
        <Callout type="info">Available regions: Helsinki (EU) and Hillsboro, OR (US). Region is auto-detected from your timezone but can be changed manually.</Callout>

        <H3 id="billing-cycle">Billing Cycle</H3>
        <Ul>
          <Li><Strong>Machine created</Strong> → Stripe subscription starts</Li>
          <Li><Strong>Machine deleted</Strong> → subscription cancelled (prorated credit)</Li>
          <Li><Strong>Machine resized</Strong> → price updated with proration</Li>
        </Ul>

        <H3 id="manage-billing">Manage Billing</H3>
        <P>Navigate to <Strong>Billing</Strong> in the dashboard to see your active machines, estimated monthly cost, and a link to the Stripe Customer Portal where you can update your payment method and view invoices.</P>

        <div className="h-20" />
      </div>
      </div>
    </div>
  );
}
