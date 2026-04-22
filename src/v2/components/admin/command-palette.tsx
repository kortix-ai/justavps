"use client";

/**
 * Admin global Cmd-K command palette.
 *
 * Triggered from anywhere in the admin shell with Cmd/Ctrl+K (or the
 * header "Search…" button). Fuzzy-matches across machines, accounts,
 * users, hosts, procurements, webhooks, images, subscriptions, SSH keys,
 * and API keys; hitting Enter navigates to the result's detail drawer /
 * page.
 *
 * Kept intentionally self-contained — the only moving parts are:
 *  1. An input with 200ms debounce.
 *  2. Keyboard nav (ArrowUp/Down, Enter, Esc).
 *  3. Grouped rendering by entity type, with a lucide icon per type.
 *
 * The palette renders a lightweight `fixed` overlay rather than using
 * the base-ui Dialog because we need very specific layering (input always
 * focused, results list scrollable, arrow-key selection that must not be
 * swallowed by Dialog's focus trap).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Users,
  User,
  Server,
  Package,
  Webhook,
  Image as ImageIcon,
  CreditCard,
  Key,
  KeyRound,
  Loader2,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  useAdminSearch,
  type AdminSearchResult,
  type AdminSearchResultType,
} from "@/shared/hooks/use-admin-search";

const TYPE_META: Record<
  AdminSearchResultType,
  { label: string; plural: string; icon: LucideIcon }
> = {
  machine: { label: "Machine", plural: "Machines", icon: Boxes },
  account: { label: "Account", plural: "Accounts", icon: Users },
  user: { label: "User", plural: "Users", icon: User },
  host: { label: "Host", plural: "Hosts", icon: Server },
  procurement: { label: "Procurement", plural: "Procurements", icon: Package },
  webhook: { label: "Webhook", plural: "Webhooks", icon: Webhook },
  image: { label: "Image", plural: "Images", icon: ImageIcon },
  subscription: {
    label: "Subscription",
    plural: "Subscriptions",
    icon: CreditCard,
  },
  ssh_key: { label: "SSH key", plural: "SSH keys", icon: Key },
  api_key: { label: "API key", plural: "API keys", icon: KeyRound },
};

/**
 * Group order in the rendered list. Less frequent types (keys, subscriptions,
 * webhooks) sink to the bottom so operators see machines/accounts/users first.
 */
const GROUP_ORDER: AdminSearchResultType[] = [
  "machine",
  "account",
  "user",
  "host",
  "procurement",
  "image",
  "subscription",
  "webhook",
  "ssh_key",
  "api_key",
];

/**
 * Mount gate — unmounts `CommandPaletteInner` whenever `open` flips false
 * so its state resets naturally on reopen (no setState-in-effect dance).
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  if (!open) return null;
  return <CommandPaletteInner onOpenChange={onOpenChange} />;
}

function CommandPaletteInner({
  onOpenChange,
}: {
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // `rawActiveIndex` is what arrow keys mutate; `activeIndex` is the clamped
  // in-bounds value we actually use. Clamping at render time avoids the
  // setState-in-effect anti-pattern when the results list shrinks.
  const [rawActiveIndex, setRawActiveIndex] = useState(0);

  // Autofocus the input once on mount — the outer gate remounts this
  // component on every open, so we don't need an `if (open)` guard.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Debounce query input — 200ms.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(rawQuery.trim()), 200);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  const { data, isFetching } = useAdminSearch(debouncedQuery, true);
  const results = useMemo<AdminSearchResult[]>(() => {
    if (!data?.results) return [];
    // Re-order so groups land in GROUP_ORDER, preserving in-group ordering.
    const byType = new Map<AdminSearchResultType, AdminSearchResult[]>();
    for (const r of data.results) {
      const bucket = byType.get(r.type) ?? [];
      bucket.push(r);
      byType.set(r.type, bucket);
    }
    const ordered: AdminSearchResult[] = [];
    for (const t of GROUP_ORDER) {
      const bucket = byType.get(t);
      if (bucket) ordered.push(...bucket);
    }
    return ordered;
  }, [data]);

  const activeIndex =
    results.length === 0 ? 0 : Math.min(rawActiveIndex, results.length - 1);

  function close() {
    onOpenChange(false);
  }

  function openResult(r: AdminSearchResult) {
    close();
    router.push(r.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setRawActiveIndex((i) =>
        results.length === 0 ? 0 : (i + 1) % results.length,
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setRawActiveIndex((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length,
      );
      return;
    }
    if (e.key === "Enter") {
      const r = results[activeIndex];
      if (r) {
        e.preventDefault();
        openResult(r);
      }
    }
  }

  // Scroll the active result into view as arrow keys move selection.
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-result-index="${activeIndex}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const showHint = debouncedQuery.length < 2;
  const showEmpty =
    !showHint && !isFetching && results.length === 0 && debouncedQuery.length >= 2;

  // Flat index we assign while rendering grouped results so ArrowUp/Down lines up.
  let flatIndex = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Admin search"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-16"
      onKeyDown={onKeyDown}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close search"
        onClick={close}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />

      {/* Palette */}
      <div
        className="relative z-10 w-full max-w-[600px] overflow-hidden rounded-2xl border bg-card shadow-xl"
        data-testid="admin-command-palette"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-command-palette-list"
            placeholder="Search machines, accounts, users, hosts…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {isFetching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <kbd className="hidden select-none rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="admin-command-palette-list"
          className="max-h-[60vh] overflow-y-auto p-1.5"
        >
          {showHint ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters…
            </div>
          ) : null}

          {showEmpty ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : null}

          {!showHint && results.length > 0
            ? GROUP_ORDER.map((type) => {
                const groupResults = results.filter((r) => r.type === type);
                if (groupResults.length === 0) return null;
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <div key={type} className="mb-2 last:mb-0">
                    <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {meta.plural} ({groupResults.length})
                    </div>
                    <div className="space-y-0.5">
                      {groupResults.map((r) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={`${r.type}:${r.id}`}
                            type="button"
                            data-result-index={idx}
                            data-testid={`admin-search-result-${r.type}-${r.id}`}
                            onMouseEnter={() => setRawActiveIndex(idx)}
                            onClick={() => openResult(r)}
                            className={cn(
                              "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors",
                              isActive
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-accent/50",
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-muted-foreground group-data-[active=true]:text-accent-foreground" />
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="truncate font-medium">
                                {r.label ?? "—"}
                              </span>
                              {r.sub_label ? (
                                <span className="truncate text-xs text-muted-foreground">
                                  {r.sub_label}
                                </span>
                              ) : null}
                            </div>
                            <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
                              {meta.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            : null}
        </div>

        {results.length > 0 ? (
          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-medium">
                  ↑↓
                </kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-medium">
                  ↵
                </kbd>{" "}
                open
              </span>
            </div>
            <span>{results.length} results</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
