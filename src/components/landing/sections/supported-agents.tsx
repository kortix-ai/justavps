"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/landing/shared/reveal";

type Agent = {
  src: string;
  name: string;
  invert?: boolean;
  extraClass?: string;
};

const AGENTS: Agent[] = [
  {
    src: "/logos/ai-coding-agent-logos/claude-code-icon.png",
    name: "Claude Code",
    extraClass: "rounded-sm",
  },
  { src: "/logos/ai-coding-agent-logos/codex-openai-icon.png", name: "Codex" },
  { src: "/logos/ai-coding-agent-logos/cursor-icon.png", name: "Cursor" },
  {
    src: "/logos/ai-coding-agent-logos/opencode-logo-dark.png",
    name: "OpenCode",
    invert: true,
  },
  {
    src: "/logos/ai-coding-agent-logos/pi-coding-agent-icon-dark.png",
    name: "PI Coding",
    invert: true,
  },
  { src: "/logos/ai-coding-agent-logos/vscode-icon.png", name: "VS Code" },
  { src: "/logos/ai-coding-agent-logos/docker-icon.png", name: "Docker" },
];

export function SupportedAgents() {
  return (
    <section className="relative">
      <Reveal>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border/60">
          <div className="bg-background col-span-2 md:col-span-1 md:row-span-2 px-6 py-10 md:p-10 flex items-center justify-center md:justify-start">
            <p className="text-sm md:text-[15px] text-muted-foreground text-center md:text-left leading-snug max-w-[14rem]">
              Runs every{" "}
              <span className="text-foreground font-medium">coding agent</span>
              {" "}you already use
            </p>
          </div>
          {AGENTS.map((agent) => (
            <div
              key={agent.name}
              className="group bg-background px-4 py-8 md:px-6 md:py-10 flex items-center justify-center gap-2.5"
            >
              <Image
                src={agent.src}
                alt={agent.name}
                width={32}
                height={32}
                className={cn(
                  "size-6 md:size-7 object-contain shrink-0 grayscale opacity-70 transition-all duration-300 group-hover:opacity-100 group-hover:grayscale-0",
                  agent.extraClass,
                  agent.invert && "dark:invert-0 invert",
                )}
              />
              <span className="text-xs md:text-sm font-medium text-foreground whitespace-nowrap">
                {agent.name}
              </span>
            </div>
          ))}
          <div className="bg-background px-4 py-8 md:px-6 md:py-10 flex items-center justify-center">
            <span className="text-xs md:text-sm text-muted-foreground">+ and more</span>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
