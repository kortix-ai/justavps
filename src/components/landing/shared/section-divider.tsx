import { PlusMark } from "@/components/landing/shared/page-frame";

export function SectionDivider() {
  return (
    <div
      aria-hidden
      className="relative w-full border-t border-border"
    >
      <PlusMark className="absolute -left-[5px] -top-[5px]" />
      <PlusMark className="absolute -right-[5px] -top-[5px]" />
    </div>
  );
}
