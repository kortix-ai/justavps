import Link from "next/link";

interface LogoProps {
  href?: string;
  className?: string;
}

export function Logo({ href = "/", className = "" }: LogoProps) {
  return (
    <Link href={href} className={`flex items-center gap-1 group ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logomark-white.svg"
        alt="Kortix"
        className="h-[14px] w-auto invert dark:invert-0 flex-shrink-0"
      />
      <span className="text-[13px] text-muted-foreground/30 font-normal">/</span>
      <span className="text-[13px] font-normal text-muted-foreground/60 tracking-tight">justavps</span>
    </Link>
  );
}
