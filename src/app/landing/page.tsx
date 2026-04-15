"use client";

import { useState } from "react";
import { CheckoutModal } from "@/components/checkout-modal";
import { DebugSwitcher, useVariant } from "./_shared/switcher";
import { V1Ascii } from "./_variants/v1-ascii";
import { V2Blueprint } from "./_variants/v2-blueprint";
import { V3Live } from "./_variants/v3-live";

export default function LandingPage() {
  const [variant, setVariant] = useVariant();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const openCheckout = () => setCheckoutOpen(true);

  return (
    <>
      {checkoutOpen && <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />}
      <DebugSwitcher variant={variant} onChange={setVariant} />
      <div className="pt-[42px]">
        {variant === "ascii" && <V1Ascii onDeploy={openCheckout} />}
        {variant === "blueprint" && <V2Blueprint onDeploy={openCheckout} />}
        {variant === "live" && <V3Live onDeploy={openCheckout} />}
      </div>
    </>
  );
}
