"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Book, Server, Globe, Code2, CreditCard, HardDrive, Search, Package,
  ChevronRight, Copy, Check, ArrowRight, Shield, Zap, Menu, X,
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
/*  Navigation tree                                                    */
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
    ],
  },
  {
    id: "proxy",
    title: "Networking",
    icon: Globe,
    subsections: [
      { id: "how-proxy-works", title: "How It Works" },
      { id: "port-forwarding", title: "Port Forwarding" },
      { id: "web-terminal", title: "Web Terminal" },
    ],
  },
  {
    id: "api-reference",
    title: "REST API",
    icon: Code2,
    subsections: [],
  },
  {
    id: "sdks",
    title: "SDKs",
    icon: Package,
    subsections: [
      { id: "sdk-typescript", title: "TypeScript" },
      { id: "sdk-python", title: "Python" },
      { id: "sdk-toolbox", title: "Toolbox (FS + Process)" },
    ],
  },
  {
    id: "snapshots",
    title: "Snapshots",
    icon: HardDrive,
    subsections: [
      { id: "default-snapshot", title: "Default Snapshot" },
      { id: "custom-snapshots", title: "Custom Snapshots" },
    ],
  },
  {
    id: "whats-installed",
    title: "What's Installed",
    icon: Server,
    subsections: [
      { id: "base-software", title: "Software" },
      { id: "architecture", title: "Architecture" },
    ],
  },
  {
    id: "security",
    title: "Security",
    icon: Shield,
    subsections: [
      { id: "network-security", title: "Network" },
      { id: "auth-model", title: "Auth Model" },
    ],
  },
  {
    id: "billing",
    title: "Billing",
    icon: CreditCard,
    subsections: [
      { id: "pricing", title: "Pricing" },
      { id: "billing-cycle", title: "Billing Cycle" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Components                                                         */
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

function CodeBlock({ children, title }: { children: string; title?: string }) {
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

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="group scroll-mt-6 text-xl font-semibold tracking-tight mt-12 mb-4 first:mt-0"><a href={`#${id}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">{children}<span className="opacity-0 group-hover:opacity-40 transition-opacity text-sm">#</span></a></h2>;
}
function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="group scroll-mt-6 text-base font-semibold tracking-tight mt-8 mb-3"><a href={`#${id}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">{children}<span className="opacity-0 group-hover:opacity-40 transition-opacity text-xs">#</span></a></h3>;
}

function P({ children }: { children: React.ReactNode }) { return <p className="text-[14.5px] leading-relaxed text-muted-foreground mb-4">{children}</p>; }
function Ul({ children }: { children: React.ReactNode }) { return <ul className="mb-4 ml-1 space-y-2 text-[14.5px] leading-relaxed text-muted-foreground">{children}</ul>; }
function Li({ children }: { children: React.ReactNode }) { return <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40" /><span>{children}</span></li>; }
function Strong({ children }: { children: React.ReactNode }) { return <strong className="font-medium text-foreground">{children}</strong>; }

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
/*  Page                                                               */
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
      <button onClick={() => setMobileNavOpen(!mobileNavOpen)} className={cn("fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full shadow-lg lg:hidden", "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900")}>{mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}</button>
      {mobileNavOpen && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />}

      {/* Sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto transition-transform duration-200 lg:transition-none", mobileNavOpen ? "translate-x-0" : "-translate-x-full", "lg:static lg:translate-x-0 lg:w-64 lg:shrink-0 lg:overflow-y-auto", "border-r border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800/60 dark:bg-zinc-950/95", "lg:bg-transparent lg:dark:bg-transparent lg:backdrop-blur-none")}>
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
                      <button key={sub.id} onClick={() => scrollTo(sub.id)} className={cn("block w-full text-left rounded-md px-2 py-1 text-[12.5px] transition-colors", activeSection === sub.id ? "text-foreground font-medium" : "text-muted-foreground/70 hover:text-muted-foreground")}>{sub.title}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 lg:px-10">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 mb-6">
          <span>Docs</span>{activeParent && <><ChevronRight className="size-3" /><span className="text-muted-foreground">{activeParent.title}</span></>}
        </div>

        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-3">JustAVPS Documentation</h1>
          <P>Always-on VPS machines with SSH, a web terminal, and Docker pre-installed.</P>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
          <QuickLink icon={Zap} title="Getting Started" description="Create a machine and connect in under 60 seconds" href="getting-started" />
          <QuickLink icon={Globe} title="Networking" description="Subdomains, port forwarding, and web terminal" href="proxy" />
          <QuickLink icon={Code2} title="REST API" description="Programmatic machine management" href="api-reference" />
          <QuickLink icon={HardDrive} title="Snapshots" description="Bootable images from Docker containers" href="snapshots" />
        </div>

        <DocSeparator />

        {/* ── GETTING STARTED ── */}
        <H2 id="getting-started">Getting Started</H2>
        <P>Get a VPS running in under 60 seconds.</P>

        <H3 id="create-machine">Create a Machine</H3>
        <P>Go to <Strong>Machines → New Machine</Strong> in the dashboard:</P>
        <Ul>
          <Li>Pick a plan (Starter, Pro, or Power) or expand custom options for the full catalog</Li>
          <Li>Choose a region — auto-detected or pick manually</Li>
          <Li>Optionally give it a name, then click <Strong>Deploy Machine</Strong></Li>
        </Ul>
        <P>Your machine is ready in ~60 seconds. You get an IP address, SSH key, and a dedicated subdomain.</P>

        <H3 id="connect-ssh">Connect via SSH</H3>
        <P>The dashboard shows a one-time setup command that saves the SSH key and connects:</P>
        <CodeBlock title="Run once (from your terminal)">{`mkdir -p ~/.ssh && echo '<private-key>' > ~/.ssh/justavps_{slug} && chmod 600 ~/.ssh/justavps_{slug} && ssh -i ~/.ssh/justavps_{slug} root@{ip}`}</CodeBlock>
        <P>After that, reconnect anytime:</P>
        <CodeBlock title="Reconnect">{`ssh -i ~/.ssh/justavps_{slug} root@{ip}`}</CodeBlock>

        <H3 id="connect-ide">Connect from Cursor / VS Code</H3>
        <P>Use <Strong>Remote-SSH</Strong> for a local-feeling dev experience with automatic port forwarding.</P>
        <Ul>
          <Li>Run the setup command from the dashboard to save your SSH key</Li>
          <Li>Add the host to <InlineCode>~/.ssh/config</InlineCode> (the dashboard shows the exact config block)</Li>
          <Li><kbd>Cmd+Shift+P</kbd> → <Strong>Remote-SSH: Connect to Host</Strong> → select your machine</Li>
        </Ul>
        <Callout type="tip">Port forwarding is automatic. Start a server on port 3000 on your VPS, and it&apos;s available at <InlineCode>localhost:3000</InlineCode> locally.</Callout>

        <DocSeparator />

        {/* ── NETWORKING ── */}
        <H2 id="proxy">Networking</H2>
        <P>Every machine gets a dedicated subdomain, a web terminal, and port forwarding.</P>

        <H3 id="how-proxy-works">How It Works</H3>
        <Ul>
          <Li>Each machine gets a subdomain: <InlineCode>&#123;slug&#125;.kortix.cloud</InlineCode></Li>
          <Li>All web traffic is authenticated at the Cloudflare edge</Li>
          <Li>TLS is handled by Cloudflare — you don&apos;t need to configure certificates</Li>
        </Ul>

        <H3 id="port-forwarding">Port Forwarding</H3>
        <P><Strong>SSH tunnel</Strong> (recommended with Cursor / VS Code):</P>
        <CodeBlock title="Forward port 3000">{`ssh -i ~/.ssh/justavps_{slug} -L 3000:localhost:3000 root@{ip}`}</CodeBlock>
        <P><Strong>Subdomain</Strong> — access any port via <InlineCode>&#123;port&#125;--&#123;slug&#125;.kortix.cloud</InlineCode>:</P>
        <CodeBlock>{`https://3000--abc123.kortix.cloud`}</CodeBlock>

        <H3 id="web-terminal">Web Terminal</H3>
        <P>The dashboard includes a browser-based terminal. No setup needed — it connects automatically when your machine is running.</P>

        <DocSeparator />

        {/* ── API ── */}
        <H2 id="api-reference">REST API</H2>
        <P>Full programmatic access to manage machines, snapshots, and keys. All endpoints require an API key.</P>
        <CodeBlock title="Quick start">{`curl https://justavps.com/api/v1/machines \\
  -H "Authorization: Bearer sk_live_xxx"`}</CodeBlock>
        <P>Generate API keys in <Strong>Keys</Strong> in the dashboard. Keys use the <InlineCode>sk_live_</InlineCode> prefix and are shown once at creation.</P>
        <div className="my-4">
          <Link href="/api/docs" className={cn("inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all", "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50", "dark:border-zinc-800/60 dark:bg-zinc-900/20 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50")}>
            <Code2 className="size-4 text-muted-foreground" />
            Open API Reference →
          </Link>
        </div>

        <DocSeparator />

        {/* ── SDKs ── */}
        <H2 id="sdks">SDKs</H2>
        <P>Official TypeScript and Python SDKs for the JustAVPS API.</P>

        <H3 id="sdk-typescript">TypeScript</H3>
        <CodeBlock title="Install">{`npm install @justavps/sdk`}</CodeBlock>
        <CodeBlock title="Usage">{`import { JustAVPS } from "@justavps/sdk";

const client = new JustAVPS("sk_live_xxx");

// Create a machine
const machine = await client.machines.create({
  server_type: "cpx32",
  region: "hel1",
});

// List all machines
const machines = await client.machines.list();

// Delete a machine
await client.machines.delete(machine.id);`}</CodeBlock>

        <H3 id="sdk-python">Python</H3>
        <CodeBlock title="Install">{`pip install justavps`}</CodeBlock>
        <CodeBlock title="Usage">{`from justavps import JustAVPS

client = JustAVPS("sk_live_xxx")

# Create a machine
machine = client.machines.create(server_type="cpx32", region="hel1")

# List all machines
machines = client.machines.list()

# Delete a machine
client.machines.delete(machine["id"])`}</CodeBlock>

        <H3 id="sdk-toolbox">Toolbox (Filesystem + Process)</H3>
        <P>Every machine has a built-in toolbox for file management and command execution. Access it via <InlineCode>client.toolbox(machineId)</InlineCode>.</P>
        <CodeBlock title="TypeScript — Files">{`const tb = client.toolbox(machine.id);

// Upload, download, search, replace
await tb.files.upload("/root/app.py", 'print("hello")');
const content = await tb.files.download("/root/app.py");
const { matches } = await tb.files.find("/root", "TODO");
await tb.files.replace(["/root/app.py"], "hello", "goodbye");

// Directories, permissions, move
await tb.files.mkdir("/root/project/src");
await tb.files.chmod("/root/script.sh", "755");
await tb.files.move("/root/old.py", "/root/new.py");`}</CodeBlock>
        <CodeBlock title="TypeScript — Process">{`// Execute commands
const result = await tb.process.exec("npm install", {
  cwd: "/root/project",
  timeout: 120,
  env: { NODE_ENV: "production" },
});
console.log(result.stdout, result.exit_code);

// Run code snippets (Python, Node, Bash, Ruby, Go)
const py = await tb.process.codeRun("print(6 * 7)", "python");

// Stream output (SSE)
for await (const event of tb.process.stream("npm run build")) {
  if (event.type === "stdout") process.stdout.write(event.data.data);
}

// List and kill processes
const { processes } = await tb.process.list();
await tb.process.kill(1234, "SIGTERM");`}</CodeBlock>
        <CodeBlock title="Python — Files + Process">{`tb = client.toolbox(machine_id)

# Files
tb.files.upload("/root/app.py", 'print("hello")')
content = tb.files.download("/root/app.py")
tb.files.mkdir("/root/project")

# Process
result = tb.process.exec("ls -la /root", cwd="/root")
print(result["stdout"])

py = tb.process.code_run("print(6 * 7)", language="python")
print(py["stdout"])  # "42"`}</CodeBlock>
        <Callout type="tip">Full interactive API reference with SDK code samples for every endpoint: <a href="/api/docs">justavps.com/api/docs</a></Callout>

        <DocSeparator />

        {/* ── SNAPSHOTS ── */}
        <H2 id="snapshots">Snapshots</H2>
        <P>Snapshots are bootable machine images. Every machine is provisioned from one.</P>

        <H3 id="default-snapshot">Default Snapshot</H3>
        <P>Includes Ubuntu 24.04, Docker, Node.js 22, Python 3, and dev tools. Most users provision from this.</P>

        <H3 id="custom-snapshots">Custom Snapshots</H3>
        <P>Create snapshots from any Docker image via the dashboard or API:</P>
        <CodeBlock title="Create via API">{`curl -X POST https://justavps.com/api/v1/snapshots \\
  -H "Authorization: Bearer sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "my-app", "docker_image": "node:20-slim" }'`}</CodeBlock>
        <P>Then pass <InlineCode>snapshot_id</InlineCode> when creating a machine to boot from it.</P>

        <DocSeparator />

        {/* ── WHAT'S INSTALLED ── */}
        <H2 id="whats-installed">What&apos;s Installed</H2>
        <P>The default snapshot includes:</P>

        <H3 id="base-software">Software</H3>
        <Table headers={["Software", "Details"]} rows={[
          ["Ubuntu 24.04 LTS", "Base OS"],
          ["Docker CE", "Container runtime"],
          ["Node.js 22 LTS", "System-wide via nodesource"],
          ["Python 3 + pip", "Python toolchain"],
          ["git, tmux, vim, nano, htop", "Dev tools"],
          ["curl, wget, jq, unzip", "Utilities"],
          ["build-essential", "C/C++ compiler toolchain"],
        ]} />

        <DocSeparator />

        {/* ── SECURITY ── */}
        <H2 id="security">Security</H2>

        <H3 id="network-security">Network</H3>
        <Ul>
          <Li><Strong>TLS</Strong> — handled by Cloudflare</Li>
          <Li><Strong>Firewall</Strong> — only Cloudflare IPs and SSH (port 22) allowed inbound</Li>
          <Li><Strong>Static IP</Strong> — dedicated public IPv4 per machine</Li>
          <Li><Strong>Daily backups</Strong> — enabled by default</Li>
        </Ul>

        <H3 id="auth-model">Auth Model</H3>
        <Ul>
          <Li><Strong>Web</Strong> — authenticated at Cloudflare edge before reaching your machine</Li>
          <Li><Strong>SSH</Strong> — key-based only, password login disabled</Li>
          <Li><Strong>API</Strong> — <InlineCode>Bearer sk_live_*</InlineCode> token required</Li>
        </Ul>

        <DocSeparator />

        {/* ── BILLING ── */}
        <H2 id="billing">Billing</H2>
        <P>Per-machine monthly billing through Stripe.</P>

        <H3 id="pricing">Pricing</H3>
        <P>Each machine has a fixed monthly price based on its server type. Expand <Strong>Custom size &amp; region</Strong> in the provisioning wizard to see all options with exact specs and pricing.</P>
        <Callout type="info">Available regions: Helsinki (EU) and Hillsboro, OR (US).</Callout>

        <H3 id="billing-cycle">Billing Cycle</H3>
        <Ul>
          <Li><Strong>Machine created</Strong> → Stripe subscription starts</Li>
          <Li><Strong>Machine deleted</Strong> → subscription cancelled, prorated credit</Li>
          <Li><Strong>Machine resized</Strong> → price updated with proration</Li>
        </Ul>
        <P>Manage billing, update payment methods, and view invoices in <Strong>Billing</Strong> in the dashboard.</P>

        <div className="h-20" />
      </div>
      </div>
    </div>
  );
}
