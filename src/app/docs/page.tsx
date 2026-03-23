"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { PLAN_PRICE_SNAPSHOT } from "@/lib/hetzner-pricing";
import { cn, PROXY_DOMAIN } from "@/lib/utils";
import {
  CreditCard, HardDrive,
  Copy, Check, Shield, Zap, Menu, X, LifeBuoy,
  Monitor, Wrench, Share2,
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
  { id: "access-control",  title: "Access Control",  icon: Share2 },
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
        <P>Get a machine running in minutes.</P>

        <Step n={1} title="Choose a machine">
          <p>Pick a plan from the landing page or dashboard. Starter (2 vCPU / 4 GB), Pro (4 vCPU / 8 GB), Power (8 vCPU / 16 GB), or Ultra (16 vCPU / 32 GB). Choose your region (EU Central or US West).</p>
        </Step>

        <Step n={2} title="Deploy">
          <p>Click <B>Deploy</B>. Your machine provisions in 1–3 minutes. You get a dedicated IP, SSH key, and an authenticated subdomain for every port.</p>
        </Step>

        <Step n={3} title="Connect">
          <p>Open the <B>Connect</B> tab on your machine page. It walks you through saving your SSH key, adding the host to your config, and connecting — all with click-to-copy commands.</p>
          <div className={cn("my-4 overflow-hidden rounded-xl border", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950")}>
            <Image
              src="/connect-tab-docs-preview.png"
              alt="JustAVPS Connect tab showing SSH key setup, config snippet, and editor connection instructions"
              width={1200}
              height={800}
              className="h-auto w-full"
            />
          </div>
        </Step>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  PERSONAL USE                                               */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="personal-use">Personal Use</H2>
        <P>Use your machine as a remote dev environment. SSH in, connect your IDE, and let your AI agents run 24/7 while you close your laptop. Come back tomorrow — everything&apos;s still there.</P>

        <Callout type="info">JustAVPS listens for every port you open on the machine. Whether you connect from Cursor, VS Code, or plain <IC>ssh</IC>, new ports are detected automatically and you get the correct public forwarded URL right in the terminal.</Callout>

        <div className={cn("my-5 overflow-hidden rounded-xl border", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950") }>
          <Image
            src="/terminal-port-listener.png"
            alt="SSH session showing automatic JustAVPS port detection and forwarded URLs"
            width={672}
            height={510}
            className="h-auto w-full"
          />
        </div>

        <P>That means you can simply connect over SSH, start any service, and keep working. As soon as a port opens, JustAVPS advertises the matching forwarded URL automatically, so there&apos;s no extra tunneling or manual proxy setup to think about.</P>

        <H3 id="ide-connect">Connect from Cursor / VS Code</H3>
        <P>Use <B>Remote-SSH</B> for a local-feeling experience in your editor:</P>
        <Ul>
          <Li>Run the one-click setup command from the dashboard (saves your SSH key)</Li>
          <Li>Add the host to <IC>~/.ssh/config</IC> — the dashboard shows the exact config block to copy</Li>
          <Li><B>Cmd+Shift+P</B> → <B>Remote-SSH: Connect to Host</B> → select your machine</Li>
        </Ul>
        <Callout type="tip">Remote-SSH still works great for local editor workflows, but it is not required for port access. The same automatic port listener also works when you connect straight from your terminal with plain <IC>ssh</IC>.</Callout>

        <H3 id="direct-ssh">Connect Directly with SSH</H3>
        <P>You do not need a special client to get a good experience. Copy the SSH command from the dashboard, connect from any terminal, and JustAVPS will watch the machine for newly opened ports while you work.</P>
        <CodeBlock title="Direct SSH" lang="bash">{`ssh -i ~/.ssh/justavps_mybox root@95.217.x.x`}</CodeBlock>
        <Ul>
          <Li>OpenCode, web apps, previews, dashboards, and custom services are all detected automatically</Li>
          <Li>Every listening port gets a matching public forwarded URL</Li>
          <Li>The SSH session prints the forwarded URL immediately, so you can click it and keep going</Li>
        </Ul>

        <H3 id="run-agents">Run AI Agents</H3>
        <P>Your machine comes pre-installed with popular AI coding agents. SSH in and run any of them directly from the CLI.</P>
        <div className="my-4 flex items-center gap-3 flex-wrap">
          {[
            { src: "/logos/ai-coding-agent-logos/claude-code-icon.png", alt: "Claude Code", label: "Claude Code", cls: "rounded-sm" },
            { src: "/logos/ai-coding-agent-logos/codex-openai-icon.png", alt: "Codex", label: "Codex", cls: "" },
            { src: "/logos/ai-coding-agent-logos/opencode-logo-dark.png", alt: "OpenCode", label: "OpenCode", cls: "dark:invert-0 invert" },
            { src: "/logos/ai-coding-agent-logos/pi-coding-agent-icon-dark.png", alt: "PI Coding", label: "PI Coding", cls: "dark:invert-0 invert" },
          ].map(({ src, alt, label, cls }) => (
            <div key={alt} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40")}>
              <Image src={src} alt={alt} width={16} height={16} className={cn("size-4 object-contain", cls)} />
              {label}
            </div>
          ))}
        </div>
        <CodeBlock title="OpenCode CLI" lang="bash">{`opencode`}</CodeBlock>
        <CodeBlock title="Machine URL" lang="bash">{`https://<slug>.${PROXY_DOMAIN}`}</CodeBlock>
        <P>If you run your own HTTP service on a custom port, JustAVPS automatically exposes the corresponding proxied port URL and prints it in your SSH session.</P>
        <Callout type="info">Public forwarded URLs follow <IC>{`https://{port}--{slug}.${PROXY_DOMAIN}`}</IC>. This happens automatically for all listening ports, including when you connected with plain <IC>ssh</IC> and never opened an editor.</Callout>

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
        <div className="my-3 flex items-center gap-2.5 flex-wrap">
          {[
            { src: "/logos/ai-coding-agent-logos/claude-code-icon.png", alt: "Claude Code", label: "Claude Code", cls: "rounded-sm" },
            { src: "/logos/ai-coding-agent-logos/codex-openai-icon.png", alt: "Codex", label: "Codex", cls: "" },
            { src: "/logos/ai-coding-agent-logos/opencode-logo-dark.png", alt: "OpenCode", label: "OpenCode", cls: "dark:invert-0 invert" },
            { src: "/logos/ai-coding-agent-logos/pi-coding-agent-icon-dark.png", alt: "PI Coding", label: "PI Coding", cls: "dark:invert-0 invert" },
          ].map(({ src, alt, label, cls }) => (
            <div key={alt} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium text-muted-foreground", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40")}>
              <Image src={src} alt={alt} width={16} height={16} className={cn("size-4 object-contain", cls)} />
              {label}
            </div>
          ))}
          <span className="text-xs text-muted-foreground">+ more via sandbox-agent</span>
        </div>
        <P>Every machine ships with <a href="https://sandboxagent.dev" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">sandbox-agent</a> pre-installed — a unified API for running Claude Code, Codex, OpenCode, PI Coding, and other coding agents over one consistent interface.</P>
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

        <H3 id="custom-images">Your Own Images</H3>
        <P>Create a private image from any running machine when you want to preserve installed dependencies, cloned repos, custom toolchains, or customer-specific setup. These bootable images appear in <B>Images</B> under your account.</P>
        <CodeBlock title="Create via API" lang="bash">{`curl -X POST https://justavps.com/api/v1/machines/{machine_id}/image \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app-image"}'`}</CodeBlock>
        <P>Poll <IC>GET /api/v1/images</IC> or <IC>GET /api/v1/images/{'{id}'}</IC> until the image status becomes <IC>ready</IC>, then pass its <IC>image_id</IC> when creating a new machine.</P>

        <H3 id="docker-workloads">Docker On Boot</H3>
        <P>If you provide a <IC>docker_image</IC> while creating a machine, JustAVPS still boots the underlying base image and then starts your container on top of it. This is separate from templates and separate from your saved images.</P>
        <CodeBlock title="Create a machine from a template image" lang="bash">{`curl -X POST https://justavps.com/api/v1/machines \
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
    "docker_image": "python:3.12-alpine",
    "entrypoint": "python",
    "command": "-m http.server 8000"
  }'`}</CodeBlock>
        <P>Use <IC>image_id</IC> for built-in templates or your own saved images. Use <IC>docker_image</IC> when you want the base machine plus a container started automatically on boot. <IC>entrypoint</IC> maps to Docker <IC>--entrypoint</IC>, while <IC>command</IC> is passed after the image name.</P>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  SECURITY                                                   */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="security">Security</H2>
        <P>Access is centered around the authenticated proxy plus SSH-key-only login. The dashboard can reuse your session for browser access, and API keys work for programmatic requests.</P>

        <H3 id="authenticated-proxy">Authenticated Proxy</H3>
        <P>HTTP services on your machine are reachable through <IC>{`{port}--{slug}.${PROXY_DOMAIN}`}</IC>. For example, if your app runs on port 8000:</P>
        <CodeBlock lang="bash">{`https://8000--abc123.${PROXY_DOMAIN}`}</CodeBlock>
        <P>Two ways to authenticate programmatically:</P>
        <CodeBlock title="API key — Authorization header" lang="bash">{`curl https://8000--abc123.${PROXY_DOMAIN} \
  -H "Authorization: Bearer sk_live_xxx"`}</CodeBlock>
        <CodeBlock title="JWT — query param (WebSocket / iframe)" lang="bash">{`https://8000--abc123.${PROXY_DOMAIN}?token=<jwt>`}</CodeBlock>
        <P>Or just log in to the dashboard — the proxy issues a session-scoped cookie for browser access.</P>

        <H3 id="auth-model">Authentication</H3>
        <Table headers={["Method", "Use Case", "Details"]} rows={[
          ["SSH Key", "Personal — terminal, IDE", "Key-based only, password login disabled. Key generated per machine."],
          ["API Key", "Infrastructure — programmatic", "Authorization: Bearer sk_live_* header. Manage in dashboard → Keys."],
          ["Web Session", "Personal — dashboard, proxy", "Session cookie set on login. Auth proxy recognizes it automatically."],
          ["JWT query param", "WebSocket / iframe", "?token=<jwt> — for contexts where headers can't be set."],
        ]} />

        <H3 id="network-security">Network Isolation</H3>
        <P>Every machine is locked down by default. Only two ports are publicly reachable — everything else is blocked at the network level.</P>

        <Table headers={["Port", "Access", "Purpose"]} rows={[
          ["22 (SSH)", "Open from anywhere", "Key-based SSH login only — password auth is disabled"],
          ["80 (HTTP)", "Open from Cloudflare IPs only", "The daemon — single authenticated entry point for all proxy traffic"],
          ["All other ports", "Blocked", "Not reachable from the public internet"],
        ]} />

        <P>This is enforced at three layers:</P>

        <H3 id="firewall-layers">Firewall Layers</H3>
        <Table headers={["Layer", "What It Does", "Can Be Bypassed?"]} rows={[
          ["Hetzner Firewall", "External, provider-level firewall applied at provision. Only allows TCP 22 (anywhere) and TCP 80 (Cloudflare IPs). All other inbound traffic is dropped before it reaches the machine.", "No — managed by the platform, not editable from inside the VM"],
          ["UFW (in-VM)", "Defense-in-depth. Denies all incoming traffic except SSH and port 80.", "Technically yes (root can change it), but the Hetzner Firewall still blocks externally"],
          ["Docker ingress guard", "iptables DOCKER-USER chain rule that blocks external traffic from reaching Docker-published ports, even if a container binds a host port.", "No — survives Docker restarts and container recreation"],
        ]} />

        <Callout type="info">Services like the Kortix API, Supabase, and sandbox-agent all bind to <IC>127.0.0.1</IC> only. They are never directly accessible from the internet — all access goes through the authenticated daemon proxy on port 80.</Callout>

        <H3 id="how-port-access-works">How Port Access Works</H3>
        <P>Even though high ports are blocked publicly, you can still access any service running on your machine through the authenticated proxy:</P>
        <Ul>
          <Li>The Cloudflare Worker receives your request at <IC>{`{port}--{slug}.${PROXY_DOMAIN}`}</IC></Li>
          <Li>It authenticates you (session cookie, API key, or JWT)</Li>
          <Li>It proxies to the daemon on port 80, which internally forwards to <IC>localhost:{'{port}'}</IC></Li>
          <Li>The response flows back through the same chain</Li>
        </Ul>
        <P>This means every port on your machine is accessible, but only through the authenticated proxy — never directly from the public internet.</P>

        <H3 id="other-security">Other Security Measures</H3>
        <Ul>
          <Li><B>TLS</B> — handled at the Cloudflare edge for all proxied traffic</Li>
          <Li><B>SSH access</B> — key-based only, password authentication disabled, root password locked</Li>
          <Li><B>Static IP</B> — dedicated public IPv4 per machine</Li>
          <Li><B>Automatic backups</B> — enabled by default on new machines</Li>
          <Li><B>No exposed databases</B> — internal services (Postgres, Redis, etc.) are loopback-only</Li>
        </Ul>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  ACCESS CONTROL                                              */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="access-control">Access Control & Sharing</H2>
        <P>Control who can access your machines and how. API keys with scoping and permissions for infrastructure, proxy tokens for sharing with anyone.</P>

        <H3 id="scoped-api-keys">Scoped API Keys</H3>
        <P>API keys can be scoped to specific machines and restricted to specific permissions. This lets you give a CI system or integration only the access it needs.</P>

        <Table headers={["Field", "Description", "Default"]} rows={[
          ["scope", "\"account\" (full access) or \"machine\" (restricted to specific machines)", "account"],
          ["machine_ids", "UUIDs of machines this key can access (required when scope=machine)", "null (all)"],
          ["permissions", "Array: *, read, write, delete, exec, proxy", "[\"*\"]"],
          ["expires_in_seconds", "Auto-expiration in seconds from creation (null = never)", "null"],
        ]} />

        <CodeBlock title="Create a machine-scoped API key" lang="bash">{`curl -X POST https://justavps.com/api/v1/api-keys \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "ci-readonly",
    "scope": "machine",
    "machine_ids": ["<machine-uuid>"],
    "permissions": ["read", "proxy"],
    "expires_in_seconds": 2592000
  }'`}</CodeBlock>

        <Table headers={["Permission", "Allows"]} rows={[
          ["*", "Everything (default, backwards-compatible)"],
          ["read", "GET endpoints: list/get machines, images, server types, keys"],
          ["write", "POST/PUT/PATCH: create/update machines, images, filesystem writes"],
          ["delete", "DELETE: machines, images, keys"],
          ["exec", "Process execution: exec, code-run, coding agents"],
          ["proxy", "Access machine services through the CF Worker proxy"],
        ]} />
        <Callout type="info">Existing API keys continue to work unchanged — they get <IC>scope=account</IC> and <IC>permissions=[&quot;*&quot;]</IC> by default.</Callout>

        <H3 id="proxy-tokens">Proxy Tokens</H3>
        <P>Proxy tokens let you share temporary access to a specific machine with anyone — no JustAVPS account required. Think &quot;share a preview link.&quot;</P>

        <Table headers={["", "API Key (sk_live_xxx)", "Proxy Token (pt_xxx)"]} rows={[
          ["Who uses it", "JustAVPS user (you, CI, integrations)", "Anyone you share the link with"],
          ["What it does", "Full API access (scoped by permissions)", "Proxy access only"],
          ["Lifetime", "Long-lived or custom expiry", "Always expires (default 1h, max 7 days)"],
          ["Scope", "Account-wide or machine-scoped", "Always single-machine, optionally port-scoped"],
        ]} />

        <CodeBlock title="Create a 1-hour proxy token" lang="bash">{`curl -X POST https://justavps.com/api/v1/proxy-tokens \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "machine_id": "<machine-uuid>",
    "ports": [3000],
    "expires_in_seconds": 3600,
    "label": "design-review"
  }'`}</CodeBlock>
        <P>The response includes a <IC>proxy_url</IC> — share it directly. The recipient opens it in a browser, no login needed.</P>

        <P>Two ways to use a proxy token:</P>
        <Ul>
          <Li><B>URL mode</B> (shareable link) — <IC>{`https://3000--slug.${PROXY_DOMAIN}?__proxy_token=pt_xxx`}</IC></Li>
          <Li><B>Header mode</B> (programmatic) — <IC>X-Proxy-Token: pt_xxx</IC></Li>
        </Ul>
        <Callout type="tip">When a proxy token is used via URL, a short-lived cookie is set so subsequent page navigations work without the query param.</Callout>

        <CodeBlock title="Revoke a proxy token" lang="bash">{`curl -X DELETE https://justavps.com/api/v1/proxy-tokens/<token-id> \\
  -H "Authorization: Bearer sk_live_xxx"`}</CodeBlock>

        <H3 id="custom-proxy">Custom Proxy</H3>
        <P>You can run your own proxy server in front of JustAVPS to add custom authentication, branding, error handling, or domain routing. Your proxy acts as an intermediary between your users and the JustAVPS authenticated proxy.</P>

        <P>The flow works like this:</P>
        <Ul>
          <Li>Your proxy receives a request from a user (e.g. <IC>preview.yourcompany.com</IC>)</Li>
          <Li>It determines which JustAVPS machine and port to target</Li>
          <Li>It creates a proxy token via the API (or reuses a cached one)</Li>
          <Li>It forwards the request to the JustAVPS proxy URL with the token in the <IC>X-Proxy-Token</IC> header</Li>
          <Li>The response flows back through your proxy to the user</Li>
        </Ul>

        <CodeBlock title="Custom proxy flow (Node.js / Express)" lang="typescript">{`import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const JUSTAVPS_API_KEY = process.env.JUSTAVPS_API_KEY;
const JUSTAVPS_API_URL = "https://justavps.com/api/v1";
const PROXY_DOMAIN = "${PROXY_DOMAIN}";

// Cache proxy tokens per machine+port (reuse until near expiry)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getProxyToken(machineId: string, port: number): Promise<string> {
  const cacheKey = \`\${machineId}:\${port}\`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(\`\${JUSTAVPS_API_URL}/proxy-tokens\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${JUSTAVPS_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      machine_id: machineId,
      ports: [port],
      expires_in_seconds: 3600,
    }),
  });
  const data = await res.json();
  tokenCache.set(cacheKey, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  });
  return data.token;
}

// Extract machine slug + port from incoming hostname
// e.g. "3000-my-machine.preview.yourcompany.com" → { slug: "my-machine", port: 3000 }
function parseHost(host: string) {
  const subdomain = host.split(".")[0];
  const [portStr, ...slugParts] = subdomain.split("-");
  return { slug: slugParts.join("-"), port: parseInt(portStr, 10) };
}

const proxy = createProxyMiddleware({
  router: async (req) => {
    const { slug, port } = parseHost(req.headers.host!);
    // Look up machine ID from slug (you'd cache this in production)
    const machineRes = await fetch(\`\${JUSTAVPS_API_URL}/machines\`, {
      headers: { Authorization: \`Bearer \${JUSTAVPS_API_KEY}\` },
    });
    const { machines } = await machineRes.json();
    const machine = machines.find((m: any) => m.slug === slug);
    if (!machine) throw new Error("Machine not found");

    const token = await getProxyToken(machine.id, port);
    // Store token on request for the proxyReq handler
    (req as any)._proxyToken = token;

    return \`https://\${port}--\${slug}.\${PROXY_DOMAIN}\`;
  },
  changeOrigin: true,
  ws: true,
  on: {
    proxyReq: (proxyReq, req) => {
      const token = (req as any)._proxyToken;
      if (token) proxyReq.setHeader("X-Proxy-Token", token);
      // Remove the platform API key — don't leak it to the machine
      proxyReq.removeHeader("Authorization");
    },
  },
});

const app = express();
app.use(proxy);
app.listen(3000, () => console.log("Custom proxy on :3000"));`}</CodeBlock>

        <Callout type="warning">Cache proxy tokens aggressively. Creating a token on every request adds latency and creates unnecessary DB writes. Cache by machine+port, reuse until 60s before expiry.</Callout>

        <P>Key points for your custom proxy:</P>
        <Ul>
          <Li><B>Token caching</B> — create a proxy token once and reuse it until near expiry. Don&apos;t create one per request.</Li>
          <Li><B>WebSocket support</B> — proxy tokens work for WebSocket connections too. Pass the token via <IC>X-Proxy-Token</IC> header during the upgrade.</Li>
          <Li><B>Port scoping</B> — create tokens scoped to specific ports if your proxy only needs to forward certain services.</Li>
          <Li><B>Custom domains</B> — point your DNS to your proxy server. Your proxy translates the custom domain to the correct JustAVPS machine URL.</Li>
          <Li><B>Error handling</B> — handle 502/503 responses from JustAVPS with custom error pages (machine starting, port not listening).</Li>
          <Li><B>No leaked credentials</B> — your API key stays in your proxy. Proxy tokens are short-lived and machine-scoped.</Li>
        </Ul>

        <Hr />

        {/* ──────────────────────────────────────────────────────────── */}
        {/*  BILLING                                                    */}
        {/* ──────────────────────────────────────────────────────────── */}
        <H2 id="billing">Billing</H2>
        <P>Fixed monthly pricing per machine, with region-specific exact prices derived from the matching Hetzner machine and a fixed 2x markup.</P>

        <Table headers={["Plan", "EU", "US"]} rows={[
          ...PLAN_PRICE_SNAPSHOT.map((plan) => [
            plan.label,
            `${plan.eu.sku} · ${plan.eu.vcpu} vCPU / ${plan.eu.memory} GB / ${plan.eu.disk} GB · $${plan.euPublicPrice.toFixed(2)}/mo`,
            `${plan.us.sku} · ${plan.us.vcpu} vCPU / ${plan.us.memory} GB / ${plan.us.disk} GB · $${plan.usPublicPrice.toFixed(2)}/mo`,
          ]),
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
