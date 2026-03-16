"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navigation = [
  {
    name: "Machines",
    href: "/machines",
    icon: "🖥️",
  },
  {
    name: "Settings",
    href: "/settings", 
    icon: "⚙️",
  },
  {
    name: "Docs",
    href: "/docs",
    icon: "📚",
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-card border-r">
      {/* Logo */}
      <div className="flex h-16 items-center px-6">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold">JustAVPS</span>
        </Link>
      </div>

      <Separator />

      {/* Navigation */}
      <div className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({ variant: pathname.startsWith(item.href) ? "secondary" : "ghost" }),
              "w-full justify-start",
              pathname.startsWith(item.href) && "bg-secondary"
            )}
          >
            <span className="mr-3 text-lg">{item.icon}</span>
            {item.name}
          </Link>
        ))}
      </div>

      {/* Bottom section */}
      <div className="p-4">
        <Separator className="mb-4" />
        <div className="space-y-2 text-sm text-muted-foreground">
          <div>API Status: <span className="text-green-500">●</span> Online</div>
          <div>Region: NBG1</div>
        </div>
      </div>
    </div>
  );
}