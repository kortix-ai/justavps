/* ────────────────────────────────────────────────────────────
 * FAQ
 *
 * Two-cell bento inside the page rails:
 *  - Left:  eyebrow, title, contact nudge
 *  - Right: stack of expandable Q/A items (native <details>)
 *
 * Using <details> gives us native accessibility, keyboard
 * support, and no JS. The first item starts open so the
 * section doesn't feel empty on initial load.
 * ──────────────────────────────────────────────────────────── */

const ITEMS = [
  {
    q: "What if I don't like it?",
    a: "Cancel anytime. No contracts, no lock-in. Your data is yours — download it and walk away whenever you want.",
  },
  {
    q: "Is it really cheaper?",
    a: "Do the math yourself. Per-second providers charge roughly $0.05/h per vCPU and $0.016/h per GiB of RAM. Run that 24/7 for a month and compare. We land at 8–10x less, every time.",
  },
  {
    q: "How fast can I get started?",
    a: "A couple of minutes. Pick a plan, we provision your machine, you SSH in. No credit card hoops, no onboarding calls.",
  },
  {
    q: "What about security?",
    a: "Zero open ports by default. Every port is fronted by an authenticated proxy. SSH uses keys, not passwords. API keys and session auth are both supported out of the box.",
  },
  {
    q: "Which agents can I run?",
    a: "Claude Code, Codex, OpenCode, PI Coding, Cursor workflows, and anything else that runs on Linux. It's a persistent Linux machine — install whatever you need.",
  },
];

export function Faq() {
  return (
    <section className="relative">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-px bg-border/60">
        {/* Header cell */}
        <div className="bg-background px-8 py-12 md:p-12 lg:p-14 flex flex-col">
          <p className="text-[11px] text-amber-500 uppercase tracking-[0.24em] mb-5 font-medium">
            FAQ
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground">
            Common questions
          </h2>
          <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-sm leading-relaxed">
            Can&apos;t find what you&apos;re looking for?{" "}
            <a
              href="mailto:hi@kortix.com"
              className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
            >
              Ask us directly
            </a>
            .
          </p>
        </div>

        {/* Q/A stack */}
        <div className="bg-background">
          <div className="divide-y divide-border/60">
            {ITEMS.map((item, i) => (
              <details
                key={item.q}
                open={i === 0}
                className="group"
              >
                <summary className="list-none cursor-pointer flex items-start justify-between gap-6 px-8 py-6 md:px-12 md:py-7 hover:bg-muted/20 transition-colors [&::-webkit-details-marker]:hidden">
                  <h3 className="text-[15px] md:text-base font-medium text-foreground pt-0.5">
                    {item.q}
                  </h3>
                  <svg
                    className="size-4 text-muted-foreground transition-transform duration-300 group-open:rotate-45 shrink-0 mt-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <div className="px-8 pb-6 md:px-12 md:pb-7 -mt-1">
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                    {item.a}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
