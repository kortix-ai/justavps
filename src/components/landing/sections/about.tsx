"use client";

import { Scales } from "@/components/ui/scales";
import { useEffect, useState } from "react";

/* ────────────────────────────────────────────────────────────
 * About
 *
 * Two-cell bento inside the page rails:
 *  - Left:  team photo, edge-to-edge, object-cover
 *  - Right: eyebrow, title, story, external links
 *
 * No rounded cards, no gradient overlay, no glow. Follows the
 * same language as Infrastructure / UseCases / Pricing.
 * ──────────────────────────────────────────────────────────── */

function GitHubStars() {
  const [stars, setStars] = useState<string | null>(null);
  useEffect(() => {
    fetch("https://api.github.com/repos/kortix-ai/suna")
      .then((r) => r.json())
      .then((d) => {
        if (d.stargazers_count) {
          const count = d.stargazers_count;
          setStars(count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count));
        }
      })
      .catch(() => setStars("19k"));
  }, []);
  return <span>{stars ?? "19k"}+ stars</span>;
}

export function About() {
  return (
    <section id="about" className="relative">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border/60">
        <div className="relative bg-background flex items-center justify-center p-4 md:p-8 overflow-hidden">
          <Scales size={8} />
          <img
            src="/team.png"
            alt="The Kortix team"
            className="relative z-10 w-full h-auto object-contain"
          />
        </div>
        <div className="bg-background px-8 py-12 md:p-12 lg:p-14 flex flex-col justify-center">
          <p className="text-[11px] text-brand uppercase tracking-[0.24em] mb-5 font-medium">
            About
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground">
            Built by Kortix
          </h2>
          <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-md leading-relaxed">
            We ran 3+ million sandboxes on incumbent providers while building{" "}
            <a
              href="https://kortix.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
            >
              Kortix
            </a>
            . We hit the cost ceiling. So we rebuilt the infrastructure we needed.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <a
              href="https://kortix.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-border/60 bg-muted/30 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50 transition-all duration-200"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
              kortix.com
            </a>
            <a
              href="https://github.com/kortix-ai/suna"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-border/60 bg-muted/30 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50 transition-all duration-200"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              <GitHubStars />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
