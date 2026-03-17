"use client";

import { useSession } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Settings } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const email = session?.user?.email || "user@example.com";
  const name = session?.user?.name || email.split("@")[0];
  const initial = name[0]?.toUpperCase() || "U";

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Settings</h1>

      {/* Account info */}
      <div className="p-5 rounded-xl bg-card">
        <h2 className="text-sm font-medium text-muted-foreground mb-4">Account</h2>
        <div className="flex items-center gap-4">
          <Avatar className="size-12 rounded-lg">
            <AvatarFallback className="rounded-lg bg-muted text-muted-foreground text-lg">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{name}</div>
            <div className="text-sm text-muted-foreground">{email}</div>
          </div>
        </div>
      </div>

      {/* Placeholder for future settings */}
      <div className="text-center py-12">
        <Settings className="mx-auto size-10 text-muted-foreground/40 mb-3" strokeWidth={1} />
        <p className="text-sm text-muted-foreground">More settings coming soon.</p>
      </div>
    </div>
  );
}
