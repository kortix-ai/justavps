"use client";

import { useState, useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, planName } from "@/lib/utils";
import Link from "next/link";
import { BillingToggle, effectiveMonthlyPrice, totalPrice, intervalLabel, type BillingInterval } from "@/components/plan-picker";

interface ServerType {
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  price_monthly: number;
  provider_price_monthly: number;
}

interface Region {
  id: string;
  name: string;
  country: string;
  city: string;
}

export function Pricing() {
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");

  // Fetch regions on mount
  useEffect(() => {
    fetch("/api/v1/server-types/regions")
      .then((r) => r.json())
      .then((d) => {
        if (d.regions?.length) {
          setRegions(d.regions);
          setRegion((prev) => prev || d.regions[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch server types when region changes
  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/server-types?region=${region}`)
      .then((r) => r.json())
      .then((d) => setServerTypes(d.server_types || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [region]);

  return (
    <section className="py-24 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center space-y-4 mb-8">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Dedicated. Transparent.
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Dedicated vCPU. Daily backups included. No surprises.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex justify-center mb-8">
          <BillingToggle interval={billingInterval} onChange={setBillingInterval} />
        </div>

        {/* Region picker */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {regions.map((r) => (
            <button
              key={r.id}
              onClick={() => setRegion(r.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                region === r.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>

        {/* Pricing table */}
        <div className="rounded-xl border border-border/60 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_80px_80px_100px_100px_140px] gap-0 px-6 py-3 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border/40">
            <div>Plan</div>
            <div className="text-center">vCPU</div>
            <div className="text-center">RAM</div>
            <div className="text-center">SSD</div>
            <div className="text-center">Backups</div>
            <div className="text-right">Price</div>
          </div>

          {/* Rows */}
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_80px_80px_100px_100px_140px] gap-0 px-6 py-4 border-b border-border/20"
                >
                  <div className="h-5 w-16 rounded bg-muted/40 animate-pulse" />
                  <div className="h-5 w-8 mx-auto rounded bg-muted/40 animate-pulse" />
                  <div className="h-5 w-12 mx-auto rounded bg-muted/40 animate-pulse" />
                  <div className="h-5 w-14 mx-auto rounded bg-muted/40 animate-pulse" />
                  <div className="h-5 w-10 mx-auto rounded bg-muted/40 animate-pulse" />
                  <div className="h-5 w-20 ml-auto rounded bg-muted/40 animate-pulse" />
                </div>
              ))
            : serverTypes.map((s, i) => {
                const displayMonthly = effectiveMonthlyPrice(s.price_monthly, billingInterval);
                const total = totalPrice(s.price_monthly, billingInterval);
                const isDiscounted = billingInterval !== "monthly";
                return (
                  <div
                    key={s.name}
                    className={cn(
                      "grid grid-cols-[1fr_80px_80px_100px_100px_140px] gap-0 px-6 py-4 items-center transition-colors hover:bg-muted/20",
                      i < serverTypes.length - 1 && "border-b border-border/20"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-sm">
                        {planName(s.name)}
                      </span>
                      {i === 0 && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          Popular
                        </Badge>
                      )}
                    </div>
                    <div className="text-center text-sm font-medium">
                      {s.vcpu}
                    </div>
                    <div className="text-center text-sm">
                      {s.ram_gb} GB
                    </div>
                    <div className="text-center text-sm text-muted-foreground">
                      {s.disk_gb} GB
                    </div>
                    <div className="text-center">
                      <span className="text-green-500 text-xs">Included</span>
                    </div>
                    <div className="text-right">
                      {isDiscounted && (
                        <div className="text-[11px] text-muted-foreground/50 line-through">
                          ${s.price_monthly}/mo
                        </div>
                      )}
                      <div className="flex items-baseline gap-0.5 justify-end">
                        <span className="text-lg font-bold">${displayMonthly}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </div>
                      {isDiscounted && (
                        <div className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                          ${total}/{intervalLabel(billingInterval)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>

        {/* CTA */}
        <div className="text-center mt-10 space-y-4">
          <Link
            href="/machines"
            className={cn(
              buttonVariants({ size: "lg" }),
              "text-base px-10 h-12 font-semibold"
            )}
          >
            Deploy Now
          </Link>
          <p className="text-xs text-muted-foreground">
            Prices shown include daily backups (+20%). All plans include
            full root access and Docker.{" "}
            {billingInterval !== "monthly" && (
              <span className="text-green-600 dark:text-green-400 font-medium">
                {billingInterval === "yearly"
                  ? "Yearly plan saves 20% — billed annually."
                  : "2-Year plan saves 30% — billed annually."}
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
