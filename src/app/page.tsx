"use client";

import { useState } from "react";
import { CheckoutModal } from "@/v1/components/checkout-modal";
import { PLAN_PRICE_SNAPSHOT } from "@/shared/lib/plan-catalog";
import { LandingNav } from "@/shared/components/landing/nav/landing-nav";
import { Hero } from "@/shared/components/landing/hero/hero";
import { Infrastructure } from "@/shared/components/landing/sections/infrastructure";
import { UseCases } from "@/shared/components/landing/sections/use-cases";
import { SecureDefault } from "@/shared/components/landing/sections/secure-default";
import { ApiOverview } from "@/shared/components/landing/sections/api-overview";
import { Pricing } from "@/shared/components/landing/sections/pricing";
import { About } from "@/shared/components/landing/sections/about";
import { Faq } from "@/shared/components/landing/sections/faq";
import { FinalCta } from "@/shared/components/landing/sections/final-cta";
import { LandingFooter } from "@/shared/components/landing/footer/landing-footer";
import { FloatingCta } from "@/shared/components/landing/floating-cta/floating-cta";
import { PageFrame } from "@/shared/components/landing/shared/page-frame";
import { SectionDivider } from "@/shared/components/landing/shared/section-divider";

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
        <UseCases onDeploy={openCheckout} />
        <SectionDivider />
        {/* <SupportedAgents />
        <SectionDivider /> */}
        <Infrastructure />
        <SectionDivider />
        <SecureDefault />
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
