import { PROXY_DOMAIN } from "@/lib/utils";
import { Reveal } from "@/components/landing/shared/reveal";
import { Lock } from "lucide-react";

const AUTH_METHODS = ["Auth Proxy", "SSH Keys", "API Keys", "Session Auth"];

export function SecureDefault() {
  return (
    <section className="relative">
      <Reveal>
        <div className="bg-background">
          <div className="px-8 py-10 md:px-14 md:py-12 flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="size-11 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center shrink-0 text-brand-strong">
              <Lock className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-brand uppercase tracking-[0.24em] mb-2 font-medium">
                Security
              </p>
              <h3 className="text-xl md:text-2xl font-medium tracking-[-0.02em] text-foreground mb-2">
                Secure by default. Zero config needed.
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                Browser traffic goes through the authenticated proxy at{" "}
                <span className="font-mono text-[12px] text-foreground px-1.5 py-0.5 rounded bg-muted/60 border border-border/60">
                  {`{port}--{slug}.${PROXY_DOMAIN}`}
                </span>
                . Log in via the dashboard, SSH in with your key, or authenticate programmatically with your API key.
              </p>
            </div>
            <div className="shrink-0 hidden lg:flex flex-wrap items-center gap-2 max-w-[14rem] justify-end">
              {AUTH_METHODS.map((method) => (
                <span
                  key={method}
                  className="px-2.5 py-1 rounded-full bg-brand/10 border border-brand/30 text-[11px] font-medium text-brand-strong whitespace-nowrap"
                >
                  {method}
                </span>
              ))}
            </div>
          </div>

          {/* Mobile pills */}
          <div className="px-8 pb-6 md:px-14 md:pb-8 lg:hidden flex flex-wrap items-center gap-2">
            {AUTH_METHODS.map((method) => (
              <span
                key={method}
                className="px-2.5 py-1 rounded-full bg-brand/10 border border-brand/30 text-[11px] font-medium text-brand-strong"
              >
                {method}
              </span>
            ))}
          </div>

          <div className="border-t border-border/60 bg-muted/30 px-8 md:px-14 py-4 font-mono text-[12px] text-muted-foreground leading-relaxed overflow-x-auto">
            <span className="text-emerald-500/80">$</span> curl{" "}
            <span className="text-foreground">{`https://8000--abc123.${PROXY_DOMAIN}`}</span>
            {" "}-H{" "}
            <span className="text-amber-500/90">
              &quot;Authorization: Bearer sk_live_...&quot;
            </span>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
