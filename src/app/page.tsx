"use client";

import { useState } from "react";
import { CheckoutModal } from "@/components/checkout-modal";
import { PLAN_PRICE_SNAPSHOT } from "@/lib/plan-catalog";
import { LandingNav } from "@/components/landing/nav/landing-nav";
import { Hero } from "@/components/landing/hero/hero";
import { SupportedAgents } from "@/components/landing/sections/supported-agents";
import { Infrastructure } from "@/components/landing/sections/infrastructure";
import { UseCases } from "@/components/landing/sections/use-cases";
import { ApiOverview } from "@/components/landing/sections/api-overview";
import { Pricing } from "@/components/landing/sections/pricing";
import { About } from "@/components/landing/sections/about";
import { Faq } from "@/components/landing/sections/faq";
import { FinalCta } from "@/components/landing/sections/final-cta";
import { LandingFooter } from "@/components/landing/footer/landing-footer";
import { FloatingCta } from "@/components/landing/floating-cta/floating-cta";
import { PageFrame } from "@/components/landing/shared/page-frame";
import { SectionDivider } from "@/components/landing/shared/section-divider";

export default function Home() {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const openCheckout = () => setCheckoutOpen(true);

  const starterPlan = PLAN_PRICE_SNAPSHOT[0];
  const startingPrice = Math.min(starterPlan.euPublicPrice, starterPlan.usPublicPrice);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-clip">
      {checkoutOpen && <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />}
      <LandingNav onDeploy={openCheckout} />
      <PageFrame>
        <Hero onDeploy={openCheckout} startingPrice={startingPrice} />
        <SectionDivider />
        <SupportedAgents />
        <SectionDivider />
        <Infrastructure />
        <SectionDivider />
        <UseCases onDeploy={openCheckout} />
        <SectionDivider />
        <ApiOverview />
        <SectionDivider />
        <Pricing onDeploy={openCheckout} startingPrice={startingPrice} />
        <SectionDivider />
        <About />
        <SectionDivider />
        <Faq />
        <SectionDivider />
        <FinalCta onDeploy={openCheckout} startingPrice={startingPrice} />
      </PageFrame>
      <LandingFooter />
      <FloatingCta onDeploy={openCheckout} startingPrice={startingPrice} />
    </div>
  );
}
