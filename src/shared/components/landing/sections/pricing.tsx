"use client";

import { PLAN_PRICE_SNAPSHOT } from "@/shared/lib/plan-catalog";
import { cn } from "@/shared/lib/utils";

export function Pricing({
  onDeploy,
  startingPrice,
}: {
  onDeploy: () => void;
  startingPrice: number;
}) {
  return (
    <section id="pricing" className="relative">
      {/* ── Header ── */}
      <div className="px-8 py-14 md:px-14 md:py-20 bg-background">
        <p className="text-[11px] text-brand uppercase tracking-[0.24em] mb-5 font-medium">
          Pricing
        </p>
        <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground max-w-3xl">
          You&apos;re paying 10x too much for always-on agents.
        </h2>
        <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-xl leading-relaxed">
          Per-second billing sounds cheap — until your agents run 24/7. Here&apos;s what a month of continuous usage actually costs.
        </p>
      </div>

      {/* ── Comparison table ── */}
      <div className="border-t border-border/60 bg-background overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="text-left px-6 md:px-10 py-4 text-[11px] font-medium text-muted-foreground uppercase tracking-[0.15em]">
                Machine
              </th>
              <th className="text-right px-4 md:px-6 py-4 text-[11px] font-medium text-muted-foreground uppercase tracking-[0.15em]">
                <span className="hidden sm:inline">E2B / Daytona / Modal *</span>
                <span className="sm:hidden">Others *</span>
              </th>
              <th className="text-right px-4 md:px-6 py-4 text-[11px] font-medium text-foreground uppercase tracking-[0.15em]">
                JustAVPS
              </th>
              <th className="text-right px-6 md:px-10 py-4 text-[11px] font-medium text-foreground uppercase tracking-[0.15em]">
                You Save
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {PLAN_PRICE_SNAPSHOT.map((plan, index) => {
              const ourPrice = Math.min(plan.euPublicPrice, plan.usPublicPrice);
              const highlight = index === 1;
              return (
                <tr
                  key={plan.key}
                  className={cn(
                    "transition-colors",
                    highlight ? "bg-brand/[0.04]" : "hover:bg-muted/20",
                  )}
                >
                  <td className="px-6 md:px-10 py-5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-medium text-foreground font-mono">
                        {plan.label}
                      </span>
                      {highlight && (
                        <span className="inline-flex items-center text-[9px] font-semibold text-brand-strong border border-brand/30 bg-brand/10 rounded-full px-2 py-0.5 uppercase tracking-[0.15em]">
                          Popular
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                      {plan.eu.vcpu} vCPU · {plan.eu.memory} GB · {plan.eu.disk} GB
                    </div>
                  </td>
                  <td className="px-4 md:px-6 py-5 text-right">
                    <span className="text-sm text-muted-foreground/60 line-through decoration-muted-foreground/40 font-mono tabular-nums">
                      ${plan.competitorMonthly}/mo
                    </span>
                  </td>
                  <td className="px-4 md:px-6 py-5 text-right">
                    <span className="text-sm font-medium text-foreground font-mono tabular-nums">
                      from ${ourPrice}/mo
                    </span>
                  </td>
                  <td className="px-6 md:px-10 py-5 text-right">
                    <span className="inline-flex items-center text-[11px] font-semibold text-brand-strong bg-brand/10 border border-brand/30 rounded-full px-2.5 py-1 font-mono tabular-nums">
                      {plan.savingsLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footnote ── */}
      <div className="border-t border-border/60 bg-background px-8 md:px-14 py-5">
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed max-w-3xl">
          * Based on published per-second CPU + RAM rates across 730&nbsp;h/mo continuous usage. EU specs shown — US specs vary slightly. Prices start from ${startingPrice}/mo.
        </p>
      </div>

      {/* ── When to use which ── */}
      <div className="border-t border-border/60 grid grid-cols-1 md:grid-cols-2 gap-px bg-border/60">
        <div className="bg-background px-8 py-10 md:px-12 md:py-12 relative">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="size-6 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center text-brand-strong">
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground">Use JustAVPS when</h3>
            <span className="ml-auto inline-flex items-center text-[9px] font-semibold text-brand-strong border border-brand/30 bg-brand/10 rounded-full px-2 py-0.5 uppercase tracking-[0.15em]">
              Recommended
            </span>
          </div>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>Your agents run <strong className="text-foreground font-medium">24/7</strong>, not minutes</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>You need <strong className="text-foreground font-medium">persistent state</strong> — files, Docker, DBs</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>You want <strong className="text-foreground font-medium">predictable cost</strong>, no bill shock</span>
            </li>
          </ul>
        </div>

        <div className="bg-background px-8 py-10 md:px-12 md:py-12">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="size-6 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground">
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground">Use them when</h3>
          </div>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>Sandboxes only live <strong className="text-foreground font-medium">minutes</strong>, not months</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>You need <strong className="text-foreground font-medium">sub-second spin-up</strong> and instant teardown</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>You only pay when code is <strong className="text-foreground font-medium">actively running</strong></span>
            </li>
          </ul>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className="border-t border-border/60 bg-background px-8 py-10 md:py-12 flex flex-col sm:flex-row items-center justify-center gap-4">
        <button
          onClick={onDeploy}
          className="h-12 px-7 rounded-full bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors inline-flex items-center gap-2"
        >
          Get a machine — from ${startingPrice}/mo
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
        <span className="text-[11px] text-muted-foreground">
          Cancel anytime &middot; No contracts
        </span>
      </div>
    </section>
  );
}

