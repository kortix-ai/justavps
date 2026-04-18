import { PROXY_DOMAIN } from "@/shared/lib/utils";
import { Reveal } from "@/shared/components/landing/shared/reveal";
import { IconTile } from "@/shared/components/landing/shared/icon-tile";
import { ArrowRightLeft, Clock, Cpu, Globe, HardDrive, Lock } from "lucide-react";

type Feature = {
  title: string;
  desc: React.ReactNode;
  icon: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: "Always on",
    desc: "Your machine runs 24/7. Close your laptop, agents keep working. Come back tomorrow — everything is still there.",
    icon: (
      <div>
        <Clock className="size-6"/>
      </div>
    ),
  },
  {
    title: "Persistent storage",
    desc: "Real SSD. Files, Docker volumes, databases — nothing vanishes between sessions. Daily automatic backups.",
    icon: (
      <div>
        <HardDrive className="size-6"/>
      </div>
    ),
  },
  {
    title: "Secure by default",
    desc: (
      <>
        Zero open ports. Auth proxy on every port via{" "}
        <span className="font-mono text-[12px] text-foreground">
          {`{port}--{slug}.${PROXY_DOMAIN}`}
        </span>
        . SSH keys, API keys, session auth.
      </>
    ),
    icon: (
      <div>
        <Lock className="size-6"/>
      </div>
    ),
  },
  {
    title: "EU & US regions",
    desc: "Deploy where your users are. Helsinki and Hillsboro, OR. Region-specific pricing, same experience.",
    icon: (
      <div>
        <Globe className="size-6"/>
      </div>
    ),
  },
  {
    title: "Full API control",
    desc: "Machine, filesystem, process, and agent APIs. Python SDK, TypeScript SDK, or raw REST.",
    icon: (
      <div>
        <ArrowRightLeft className="size-6"/>
      </div>
    ),
  },
  {
    title: "Any AI agent",
    desc: "Claude Code, Codex, OpenCode, PI Coding, Cursor — or anything else that runs on Linux.",
    icon: (
      <div>
        <Cpu className="size-6"/>
      </div>
    ),
  },
];

export function Infrastructure() {
  return (
    <section id="infrastructure" className="relative">
      <Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border/60">
          {/* Header cell — spans col 1 rows 1-3 on lg, top row on sm, full row on mobile */}
          <div className="bg-background col-span-1 sm:col-span-2 lg:col-span-1 lg:row-span-3 px-8 py-12 md:p-12 lg:p-14 flex flex-col">
            <p className="text-[11px] text-brand uppercase tracking-[0.24em] mb-5 font-medium">
              Infrastructure
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground">
              Machines that don&apos;t disappear
            </h2>
            <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-sm leading-relaxed">
              Not ephemeral containers. Persistent compute with real IPs, daily backups, and authenticated access on every port.
            </p>
          </div>

          {/* Feature cells */}
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-background px-8 py-10 md:p-10 lg:p-12 flex flex-col"
            >
              <IconTile size="md" className="mb-5">{f.icon}</IconTile>
              <h3 className="text-[15px] font-medium text-foreground mb-2">{f.title}</h3>
              <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
