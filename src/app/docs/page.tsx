"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  CreditCard, HardDrive,
  Copy, Check, Shield, Zap, Menu, X, LifeBuoy,
  Monitor, Wrench,
  Server, Image as ImageIcon, Cpu, FolderOpen, Terminal,
  Key, KeyRound, Webhook, User,
} from "lucide-react";
import { SiPython, SiTypescript } from "react-icons/si";
import { TbApi } from "react-icons/tb";
import type { Highlighter } from "shiki";

/* ------------------------------------------------------------------ */
/*  Syntax Highlighting — shiki singleton                              */
/* ------------------------------------------------------------------ */

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: ["bash", "typescript", "python", "json", "shell"],
      })
    );
  }
  return highlighterPromise;
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

const NAV = [
  { id: "getting-started", title: "Getting Started", icon: Zap },
  { id: "personal-use",    title: "Personal Use",    icon: Monitor },
  { id: "infrastructure",  title: "Infrastructure Use", icon: Wrench },
  { id: "images",          title: "Images",          icon: HardDrive },
  { id: "security",        title: "Security",        icon: Shield },
  { id: "billing",         title: "Billing",         icon: CreditCard },
  { id: "support",         title: "Support",         icon: LifeBuoy },
];

const API_REF = [
  { label: "Machines & Infrastructure", items: [
    { title: "Machines",   icon: Server,     href: "/api/docs#tag/machines" },
    { title: "Images",     icon: ImageIcon,   href: "/api/docs#tag/images" },
    { title: "Server Types", icon: Cpu,       href: "/api/docs#tag/server-types" },
  ]},
  { label: "Toolbox", items: [
    { title: "Filesystem", icon: FolderOpen,  href: "/api/docs#tag/toolbox:-filesystem" },
    { title: "Process",    icon: Terminal,    href: "/api/docs#tag/toolbox:-process" },
  ]},
  { label: "Auth & Access", items: [
    { title: "API Keys",   icon: Key,        href: "/api/docs#tag/api-keys" },
    { title: "SSH Keys",   icon: KeyRound,   href: "/api/docs#tag/ssh-keys" },
  ]},
  { label: "Integrations", items: [
    { title: "Webhooks",   icon: Webhook,    href: "/api/docs#tag/webhooks" },
    { title: "Account",    icon: User,       href: "/api/docs#tag/account" },
  ]},
];

/* ------------------------------------------------------------------ */
/*  Primitives                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }, [text]);
  return (
    <button onClick={handleCopy} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors", className)} aria-label="Copy">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

type Lang = "bash" | "typescript" | "python" | "json" | "shell";

function CodeBlock({ children, title, lang }: { children: string; title?: string; lang?: Lang }) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const resolvedLang: Lang = lang ?? "bash";

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      const html = hl.codeToHtml(children.trim(), {
        lang: resolvedLang,
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
        defaultColor: false,
      });
      setHighlightedHtml(html);
    });
    return () => { cancelled = true; };
  }, [children, resolvedLang]);

  return (
    <div className={cn("group relative my-4 rounded-lg border overflow-hidden", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950")}>
      {title && (
        <div className={cn("flex items-center justify-between border-b px-4 py-2", "border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60")}>
          <span className="text-xs text-muted-foreground font-mono">{title}</span>
          <CopyButton text={children.trim()} />
        </div>
      )}
      {!title && <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"><CopyButton text={children.trim()} /></div>}
      {highlightedHtml ? (
        <div
          className="shiki-block overflow-x-auto p-4 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_code]:!text-[13px] [&_code]:!leading-relaxed [&_code]:!font-mono"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed"><code className="font-mono text-zinc-800 dark:text-zinc-200">{children.trim()}</code></pre>
      )}
    </div>
  );
}

function IC({ children }: { children: React.ReactNode }) {
  return <code className={cn("rounded-md px-1.5 py-0.5 text-[13px] font-mono border", "bg-zinc-100 text-zinc-800 border-zinc-200", "dark:bg-zinc-800/60 dark:text-zinc-200 dark:border-zinc-700/60")}>{children}</code>;
}
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="group scroll-mt-20 text-xl font-semibold tracking-tight mt-14 mb-4 first:mt-0"><a href={`#${id}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">{children}<span className="opacity-0 group-hover:opacity-40 transition-opacity text-sm">#</span></a></h2>;
}
function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="group scroll-mt-20 text-base font-semibold tracking-tight mt-8 mb-3"><a href={`#${id}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">{children}<span className="opacity-0 group-hover:opacity-40 transition-opacity text-xs">#</span></a></h3>;
}
function P({ children }: { children: React.ReactNode }) { return <p className="text-[14.5px] leading-relaxed text-muted-foreground mb-4">{children}</p>; }
function Ul({ children }: { children: React.ReactNode }) { return <ul className="mb-4 ml-1 space-y-2 text-[14.5px] leading-relaxed text-muted-foreground">{children}</ul>; }
function Li({ children }: { children: React.ReactNode }) { return <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40" /><span>{children}</span></li>; }
function B({ children }: { children: React.ReactNode }) { return <strong className="font-medium text-foreground">{children}</strong>; }
function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "tip" | "warning" }) {
  const styles = { info: cn("border-blue-400/40 bg-blue-50 text-blue-900", "dark:border-blue-500/20 dark:bg-blue-950/30 dark:text-blue-200/90"), tip: cn("border-emerald-400/40 bg-emerald-50 text-emerald-900", "dark:border-emerald-500/20 dark:bg-emerald-950/30 dark:text-emerald-200/90"), warning: cn("border-amber-400/40 bg-amber-50 text-amber-900", "dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200/90") };
  const labels = { info: "Note", tip: "Tip", warning: "Warning" };
  return <div className={cn("my-4 rounded-lg border-l-2 px-4 py-3 text-[14px]", styles[type])}><span className="mb-1 block text-xs font-semibold uppercase tracking-wider opacity-60">{labels[type]}</span>{children}</div>;
}
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
function Hr() { return <hr className="my-10 border-zinc-200 dark:border-zinc-800/50" />; }


function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6 last:mb-0">
      <div className={cn("size-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold", "bg-foreground text-background")}>{n}</div>
      <div className="flex-1 min-w-0 -mt-0.5">
        <p className="text-sm font-medium text-foreground mb-1.5">{title}</p>
        <div className="text-[14px] text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("getting-started");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const ids = NAV.map((n) => n.id);
    const update = () => {
      const scrollEl = document.querySelector("[data-docs-scroll]");
      if (!scrollEl) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      // If at bottom, always select last section
      if (scrollTop + clientHeight >= scrollHeight - 32) {
        setActiveSection(ids[ids.length - 1]);
        return;
      }
      // Otherwise pick the last section whose heading has scrolled past 25% of viewport
      const threshold = clientHeight * 0.25;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const containerRect = scrollEl.getBoundingClientRect();
        if (rect.top - containerRect.top <= threshold) current = id;
      }
      setActiveSection(current);
    };
    const scrollEl = document.querySelector("[data-docs-scroll]");
    if (!scrollEl) return;
    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    return () => scrollEl.removeEventListener("scroll", update);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); setMobileNavOpen(false); }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <button onClick={() => setMobileNavOpen(!mobileNavOpen)} className={cn("fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full shadow-lg lg:hidden", "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900")}>{mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}</button>
      {mobileNavOpen && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />}

      {/* Sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-56 overflow-y-auto transition-transform duration-200 lg:transition-none", mobileNavOpen ? "translate-x-0" : "-translate-x-full", "lg:static lg:translate-x-0 lg:w-56 lg:shrink-0", "border-r border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800/60 dark:bg-zinc-950/95", "lg:border-r-0 lg:bg-transparent lg:dark:bg-transparent lg:backdrop-blur-none")}>
        <div className="flex flex-col h-full">
          <nav className="px-3 pt-6 flex-shrink-0">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => scrollTo(item.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors mb-px", activeSection === item.id ? "text-foreground font-medium bg-zinc-100 dark:bg-zinc-800/50" : "text-muted-foreground hover:text-foreground/80 hover:bg-zinc-50 dark:hover:bg-zinc-800/30")}>
                  <Icon className="size-3.5 shrink-0" />{item.title}
                </button>
              );
            })}
          </nav>

          {/* Bottom: API reference links */}
          <div className="mt-auto px-3 pt-3 pb-6">
            {API_REF.map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <p className="px-2.5 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">{group.label}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.title} href={item.href} className="flex items-center gap-2 rounded-md px-2.5 py-1 text-[12px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                      <Icon className="size-3 shrink-0" />{item.title}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Content */}
      <div data-docs-scroll className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 lg:px-10">

        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-3">JustAVPS Docs</h1>
          <P>24/7 always-on sandboxes for AI agents. Use it as your personal dev machine, or provision sandboxes programmatically as infrastructure.</P>
        </div>

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  GETTING STARTED                                            */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="getting-started">Getting Started</H2>
        <P>Get a machine running in under 60 seconds.</P>

        <Step n={1} title="Choose a machine">
          <p>Pick a plan from the landing page or dashboard. Starter (2 vCPU / 4 GB), Pro (4 vCPU / 8 GB), Power (8 vCPU / 16 GB), or Ultra (16 vCPU / 32 GB). Choose your region (EU Central or US West).</p>
        </Step>

        <Step n={2} title="Deploy">
          <p>Click <B>Deploy</B>. Your machine provisions in ~60 seconds. You get a dedicated IP, SSH key, and an authenticated subdomain for every port.</p>
        </Step>

        <Step n={3} title="Connect">
          <p>Copy the one-click SSH command from the dashboard and paste it into your terminal. That&apos;s it — you&apos;re in.</p>
          <CodeBlock title="One-click connect (from dashboard)" lang="bash">{`mkdir -p ~/.ssh && echo '<key>' > ~/.ssh/justavps_mybox && chmod 600 ~/.ssh/justavps_mybox && ssh -i ~/.ssh/justavps_mybox root@95.217.x.x`}</CodeBlock>
          <p>After the first connect, reconnect anytime:</p>
          <CodeBlock lang="bash">{`ssh -i ~/.ssh/justavps_mybox root@95.217.x.x`}</CodeBlock>
        </Step>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  PERSONAL USE                                               */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="personal-use">Personal Use</H2>
        <P>Use your machine as a remote dev environment. SSH in, connect your IDE, and let your AI agents run 24/7 while you close your laptop. Come back tomorrow — everything&apos;s still there.</P>

        <H3 id="ide-connect">Connect from Cursor / VS Code</H3>
        <P>Use <B>Remote-SSH</B> for a local-feeling experience with built-in port forwarding:</P>
        <Ul>
          <Li>Run the one-click setup command from the dashboard (saves your SSH key)</Li>
          <Li>Add the host to <IC>~/.ssh/config</IC> — the dashboard shows the exact config block to copy</Li>
          <Li><B>Cmd+Shift+P</B> → <B>Remote-SSH: Connect to Host</B> → select your machine</Li>
        </Ul>
        <Callout type="tip">If you start a server on port 3000 on the machine, you can forward it back to your laptop as <IC>localhost:3000</IC> from your SSH client or editor.</Callout>

        <H3 id="run-agents">Run AI Agents</H3>
        <P>Your machine comes with <B>OpenCode</B> available out of the box. You can SSH in for CLI tools, and the dashboard shows the machine URL plus SSH commands under <B>Connect</B>.</P>
        <CodeBlock title="OpenCode CLI" lang="bash">{`opencode`}</CodeBlock>
        <CodeBlock title="Machine URL" lang="bash">{`https://<slug>.kortix.cloud`}</CodeBlock>
        <P>If you run your own HTTP service on a custom port, use the corresponding proxied port URL.</P>
        <Callout type="info">Use <IC>&#123;port&#125;--&#123;slug&#125;.kortix.cloud</IC> for custom HTTP services, or plain SSH port forwarding when you want local-only access.</Callout>

        <H3 id="mobile-access">Access from Mobile</H3>
        <P>Open the machine URL from the dashboard in any mobile browser, or use the dashboard <B>web terminal</B> for quick shell access.</P>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  INFRASTRUCTURE                                             */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="infrastructure">Infrastructure Use</H2>
        <P>Build on JustAVPS as a platform. Create machines, manage files, run bash, and launch coding agents — all programmatically. One REST API, Python SDK, and TypeScript SDK.</P>

        <H3 id="api-sdks">API & SDKs</H3>
        <P>One REST API with full coverage — machines, filesystem, process execution, images, and coding agents. Available via REST, TypeScript SDK (<IC>@kortix/justavps</IC>), and Python SDK (<IC>kortix-justavps</IC>).</P>
        <P>Generate an API key in the dashboard under <B>Keys</B> (prefix <IC>sk_live_</IC>). Quick test:</P>
        <CodeBlock lang="bash">{`curl https://justavps.com/api/v1/machines -H "Authorization: Bearer sk_live_xxx"`}</CodeBlock>

        <Table headers={["API Surface", "What You Can Do"]} rows={[
          ["Machines", "Create, list, get, resize, rebuild, delete"],
          ["Filesystem", "Read, write, upload, download, search, replace, mkdir, move"],
          ["Process", "Exec commands, stream output (SSE), run code snippets, list, kill"],
          ["Images", "List templates and saved images, create images from running machines, delete your own saved images"],
          ["Coding Agents", "Run Claude Code, OpenCode, Codex — unified API with session management"],
        ]} />

        <P>The API reference has everything — full endpoint docs, request/response schemas, and interactive SDK examples in both TypeScript and Python:</P>
        <div className="my-4 grid sm:grid-cols-3 gap-2">
          <Link href="/api/docs" className={cn("flex flex-col items-center gap-1.5 rounded-lg border px-4 py-4 text-center transition-all", "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50", "dark:border-zinc-800/60 dark:bg-zinc-900/20 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50")}>
            <TbApi className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">REST API</span>
            <span className="text-[11px] text-muted-foreground">Full reference</span>
          </Link>
          <a href="https://www.npmjs.com/package/@kortix/justavps" target="_blank" rel="noopener noreferrer" className={cn("flex flex-col items-center gap-1.5 rounded-lg border px-4 py-4 text-center transition-all", "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50", "dark:border-zinc-800/60 dark:bg-zinc-900/20 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50")}>
            <SiTypescript className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">TypeScript SDK</span>
            <span className="text-[11px] text-muted-foreground font-mono">@kortix/justavps</span>
          </a>
          <a href="https://pypi.org/project/kortix-justavps/" target="_blank" rel="noopener noreferrer" className={cn("flex flex-col items-center gap-1.5 rounded-lg border px-4 py-4 text-center transition-all", "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50", "dark:border-zinc-800/60 dark:bg-zinc-900/20 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50")}>
            <SiPython className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">Python SDK</span>
            <span className="text-[11px] text-muted-foreground font-mono">kortix-justavps</span>
          </a>
        </div>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  SNAPSHOTS                                                  */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="images">Templates And Images</H2>
        <P>Every machine boots from an image. JustAVPS uses two kinds: built-in templates managed by the platform, and private images you create from your own running machines.</P>

        <H3 id="default-image">Built-in Templates</H3>
        <P>Built-in templates appear in <B>Images</B> as templates and cannot be deleted from the dashboard.</P>
        <Table headers={["Template", "Description"]} rows={[
          ["justavps standard", "Default base image used for new machines"],
          ["Kortix", "Starts from the standard base image and applies the Kortix preset workload"],
        ]} />
        <P>The default <IC>justavps standard</IC> template includes the platform services needed to connect and run workloads:</P>
        <Table headers={["Software", "Details"]} rows={[
          ["Ubuntu 24.04 LTS", "Base OS"],
          ["justavps-daemon", "Primary machine service on port 80"],
          ["opencode-web", "Started by the opencode-web service"],
          ["sandbox-agent", "Coding-agent API on port 2468"],
          ["Docker", "Used for workload containers and Docker-image boot flows"],
          ["SSH key auth", "Root login via keys only; password auth disabled"],
        ]} />
        <P>Storage is persistent across reboots, and automatic backups are enabled by default on new machines.</P>

        <H3 id="coding-agents-api">Coding Agents API</H3>
        <P>Every machine ships with <a href="https://sandboxagent.dev" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">sandbox-agent</a> pre-installed — a unified API for running Claude Code, Codex, OpenCode, Amp, and other coding agents over one consistent interface.</P>
        <Ul>
          <Li><B>Universal Agent API</B> — one interface to run any supported coding agent</Li>
          <Li><B>Session management</B> — create, resume, and manage agent sessions</Li>
          <Li><B>Streaming events</B> — real-time output via SSE</Li>
          <Li><B>Universal schema</B> — standardized events for tool calls, permission requests, file edits, and more</Li>
          <Li><B>Runs inside any sandbox</B> — lightweight static binary that also works in Docker, E2B, Daytona, and Vercel Sandboxes</Li>
        </Ul>
        <CodeBlock title="sandbox-agent session example" lang="typescript">{`import { SandboxAgent } from "sandbox-agent";
import { local } from "sandbox-agent/local";

const client = await SandboxAgent.start({
  sandbox: local(),
});

await client.createSession("my-session", {
  agent: "claude-code",
});

await client.postMessage("my-session", {
  message: "Hello, world!",
});

for await (const event of client.streamEvents("my-session")) {
  console.log(event.type, event.data);
}`}</CodeBlock>
        <P><a href="https://sandboxagent.dev/docs/agent-sessions" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">Agent Sessions</a> covers the full session lifecycle — create sessions, send messages, persist transcripts, and replay or audit every event. sandbox-agent runs on port 2468 by default.</P>

        <H3 id="custom-snapshots">Your Own Images</H3>
        <P>Create a private image from any running machine when you want to preserve installed dependencies, cloned repos, custom toolchains, or customer-specific setup. These bootable images appear in <B>Images</B> under your account.</P>
        <CodeBlock title="Create via API" lang="bash">{`curl -X POST https://justavps.com/api/v1/machines/{machine_id}/image \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app-snapshot"}'`}</CodeBlock>
        <P>Poll <IC>GET /api/v1/images</IC> or <IC>GET /api/v1/images/{'{id}'}</IC> until the image status becomes <IC>ready</IC>, then pass its <IC>image_id</IC> when creating a new machine.</P>

        <H3 id="docker-workloads">Docker On Boot</H3>
        <P>If you provide a <IC>docker_image</IC> while creating a machine, JustAVPS still boots the underlying base image and then starts your container on top of it. This is separate from templates and separate from your saved images.</P>
        <CodeBlock title="Create a machine from the Kortix template" lang="bash">{`curl -X POST https://justavps.com/api/v1/machines \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "cloud",
    "server_type": "cpx42",
    "region": "hel1",
    "image_id": "<template-image-id>"
  }'`}</CodeBlock>
        <CodeBlock title="Create a machine with a custom Docker image" lang="bash">{`curl -X POST https://justavps.com/api/v1/machines \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "cloud",
    "server_type": "cpx42",
    "region": "hel1",
    "docker_image": "nginx:latest"
  }'`}</CodeBlock>
        <P>Use <IC>image_id</IC> for built-in templates or your own saved images. Use <IC>docker_image</IC> when you want the base machine plus a container started automatically on boot.</P>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  SECURITY                                                   */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="security">Security</H2>
        <P>Access is centered around the authenticated proxy plus SSH-key-only login. The dashboard can reuse your session for browser access, and API keys work for programmatic requests.</P>

        <H3 id="authenticated-proxy">Authenticated Proxy</H3>
        <P>HTTP services on your machine are reachable through <IC>&#123;port&#125;--&#123;slug&#125;.kortix.cloud</IC>. For example, if your app runs on port 8000:</P>
        <CodeBlock lang="bash">{`https://8000--abc123.kortix.cloud`}</CodeBlock>
        <P>Two ways to authenticate programmatically:</P>
        <CodeBlock title="API key — Authorization header" lang="bash">{`curl https://8000--abc123.kortix.cloud \
  -H "Authorization: Bearer sk_live_xxx"`}</CodeBlock>
        <CodeBlock title="JWT — query param (WebSocket / iframe)" lang="bash">{`https://8000--abc123.kortix.cloud?token=<jwt>`}</CodeBlock>
        <P>Or just log in to the dashboard — the proxy issues a session-scoped cookie for browser access.</P>

        <H3 id="auth-model">Authentication</H3>
        <Table headers={["Method", "Use Case", "Details"]} rows={[
          ["SSH Key", "Personal — terminal, IDE", "Key-based only, password login disabled. Key generated per machine."],
          ["API Key", "Infrastructure — programmatic", "Authorization: Bearer sk_live_* header. Manage in dashboard → Keys."],
          ["Web Session", "Personal — dashboard, proxy", "Session cookie set on login. Auth proxy recognizes it automatically."],
          ["JWT query param", "WebSocket / iframe", "?token=<jwt> — for contexts where headers can't be set."],
        ]} />

        <H3 id="network-security">Network</H3>
        <Ul>
          <Li><B>TLS</B> — handled at the edge for proxied browser traffic</Li>
          <Li><B>SSH access</B> — key-based only, with password authentication disabled</Li>
          <Li><B>Static IP</B> — dedicated public IPv4 per machine</Li>
          <Li><B>Automatic backups</B> — enabled by default on new machines</Li>
        </Ul>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  BILLING                                                    */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="billing">Billing</H2>
        <P>Fixed monthly pricing per machine. No per-second billing, no usage surprises.</P>

        <Table headers={["Plan", "Specs", "Price"]} rows={[
          ["Starter", "2 vCPU / 4 GB / 80 GB SSD", "$15/mo"],
          ["Pro", "4 vCPU / 8 GB / 160 GB SSD", "$27/mo"],
          ["Power", "8 vCPU / 16 GB / 320 GB SSD", "$49/mo"],
          ["Ultra", "16 vCPU / 32 GB / 640 GB SSD", "$97/mo"],
        ]} />

        <Ul>
          <Li><B>Machine created</B> → Stripe subscription starts immediately</Li>
          <Li><B>Machine deleted</B> → subscription cancelled</Li>
          <Li><B>Machine resized</B> → price updated with proration</Li>
        </Ul>
        <P>Cancel anytime — no contracts, no lock-in. Manage billing, update payment methods, and view invoices in <B>Billing</B> in the dashboard.</P>
        <Callout type="info">Available regions: EU Central and US West.</Callout>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  SUPPORT                                                    */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="support">Support</H2>
        <Ul>
          <Li><B>Email</B> — <a href="mailto:support@justavps.com" className="text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity">support@justavps.com</a></Li>
          <Li><B>API Reference</B> — <Link href="/api/docs" className="text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity">justavps.com/api/docs</Link></Li>
          <Li><B>Built by</B> — <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity">Kortix</a></Li>
        </Ul>

        <div className="h-20" />
      </div>
      </div>
    </div>
  );
}
