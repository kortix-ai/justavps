import { cn } from "@/lib/utils";
import { Reveal } from "@/components/landing/shared/reveal";

const STATS = [
  { value: "99.9%", label: "Uptime SLA" },
  { value: "<60s", label: "Deploy time" },
  { value: "10x", label: "Cheaper" },
  { value: "0", label: "Open ports" },
];

export function Stats() {
  return (
    <section className="px-6 py-16">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-1">
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {STATS.map((s, i) => (
                <div
                  key={s.label}
                  className={cn(
                    "text-center py-8 px-4 relative",
                    i < 3 &&
                      "after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:h-8 after:w-px after:bg-white/[0.06] sm:after:block after:hidden",
                    i === 1 && "after:hidden sm:after:block",
                  )}
                >
                  <div className="text-2xl sm:text-3xl font-semibold tracking-tight bg-gradient-to-b from-foreground to-foreground/50 bg-clip-text text-transparent">
                    {s.value}
                  </div>
                  <div className="text-xs text-muted-foreground/60 mt-1.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
