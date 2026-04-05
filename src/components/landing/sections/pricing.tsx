"use client";

import { PLAN_PRICE_SNAPSHOT } from "@/lib/plan-catalog";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
 * Pricing
 *
 * Same language as the rest of the landing: edge-to-edge bento,
 * sticky left header, content scrolling on the right.
 *
 *   [ sticky header ]  │  [ plan row ]
 *                      │  [ plan row ]  ★ POPULAR
 *                      │  [ plan row ]
 *                      │  [ plan row ]
 *                      │  [ plan row ]
 *   ───────────────────┴──────────────────
 *   fine-print line
 *   ───────────────────┬──────────────────
 *   [ use justavps ]   │  [ use ephemeral ]
 *
 * Plan rows use a 3-column layout (name/specs, our price,
 * savings badge) with a strikethrough competitor price under
 * ours — no more dense comparison table.
 * ──────────────────────────────────────────────────────────── */

type PlanSnapshot = (typeof PLAN_PRICE_SNAPSHOT)[number];

function PlanRow({
  plan,
  highlight,
}: {
  plan: PlanSnapshot;
  highlight?: boolean;
}) {
  const ourPrice = Math.min(plan.euPublicPrice, plan.usPublicPrice);
  return (
    <div
      className={cn(
        "px-6 py-6 md:px-10 md:py-7 transition-colors",
        highlight && "bg-emerald-500/[0.04]",
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        {/* Plan name + specs */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1.5">
            <h3 className="text-lg font-medium text-foreground">{plan.label}</h3>
            {highlight && (
              <span className="inline-flex items-center text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-2 py-0.5 uppercase tracking-[0.15em]">
                Popular
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground font-mono">
            <span>{plan.eu.vcpu} vCPU</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{plan.eu.memory} GB RAM</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{plan.eu.disk} GB SSD</span>
          </div>
        </div>

        {/* Prices + savings */}
        <div className="flex items-end justify-between md:justify-end gap-6 md:gap-10 shrink-0">
          <div className="text-right md:text-left">
            <div className="text-baseline flex items-baseline gap-1.5 font-mono">
              <span className="text-2xl font-semibold text-foreground tabular-nums">
                ${ourPrice}
              </span>
              <span className="text-xs text-muted-foreground">/mo</span>
            </div>
            <div className="text-[11px] text-muted-foreground/50 line-through font-mono mt-0.5">
              was ${plan.competitorMonthly}/mo
            </div>
          </div>

          <div className="shrink-0">
            <span className="inline-flex items-center text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1 font-mono tabular-nums">
              {plan.savingsLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Pricing({
  onDeploy,
  startingPrice,
}: {
  onDeploy: () => void;
  startingPrice: number;
}) {
  return (
    <section id="pricing" className="relative">
      {/* ── Header + plan rows ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-px bg-border/60">
        {/* Sticky header */}
        <div className="bg-background">
          <div className="px-8 py-12 md:p-12 lg:p-14 flex flex-col">
            <p className="text-[11px] text-emerald-500 uppercase tracking-[0.24em] mb-5 font-medium">
              Pricing
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground">
              Predictable pricing
            </h2>
            <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-sm leading-relaxed">
              Per-second billing sounds cheap until your agents run 24/7. Here&apos;s what a full month actually costs.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={onDeploy}
                className="h-11 px-6 rounded-full bg-foreground text-background text-[13px] font-medium border border-emerald-500/40 shadow-[0_0_32px_rgba(16,185,129,0.12)] hover:shadow-[0_0_48px_rgba(16,185,129,0.24)] hover:border-emerald-500/70 transition-all"
              >
                Deploy from ${startingPrice}/mo
              </button>
              <span className="text-[11px] text-muted-foreground">
                Cancel anytime &middot; No contracts
              </span>
            </div>

            <p className="text-[10px] text-muted-foreground/50 mt-10 leading-relaxed">
              * Competitor prices based on published per-second CPU + RAM rates across 730 h/mo continuous usage. EU specs shown.
            </p>
          </div>
        </div>

        {/* Plan rows */}
        <div className="bg-background divide-y divide-border/60">
          {PLAN_PRICE_SNAPSHOT.map((plan, i) => (
            <PlanRow key={plan.key} plan={plan} highlight={i === 1} />
          ))}
        </div>
      </div>

      {/* ── When to use which ── */}
      <div className="border-t border-border/60 grid grid-cols-1 md:grid-cols-2 gap-px bg-border/60">
        <div className="bg-background px-8 py-10 md:px-12 md:py-12 relative">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="size-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground">Use JustAVPS when</h3>
          </div>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>Your agents run <strong className="text-foreground font-medium">24/7</strong>, not minutes</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>You need <strong className="text-foreground font-medium">persistent state</strong> — files, Docker volumes, databases</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>You want <strong className="text-foreground font-medium">predictable monthly cost</strong>, no surprise bills</span>
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
            <h3 className="text-sm font-medium text-foreground">Use ephemeral providers when</h3>
          </div>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <span className="text-muted-foreground/40 mt-1.5 size-1 rounded-full bg-current shrink-0" />
              <span>Sandboxes live <strong className="text-foreground font-medium">minutes</strong>, not months</span>
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
    </section>
  );
}
