"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { ChevronRight } from "lucide-react";

interface JsonViewerProps {
  data: unknown;
  className?: string;
  defaultExpanded?: boolean;
}

function JsonValue({ value, depth, defaultExpanded }: { value: unknown; depth: number; defaultExpanded: boolean }) {
  if (value === null) return <span className="text-orange-400/80">null</span>;
  if (value === undefined) return <span className="text-orange-400/80">undefined</span>;
  if (typeof value === "boolean") return <span className="text-orange-400/80">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-blue-400/90">{value}</span>;
  if (typeof value === "string") {
    if (value.length > 200) {
      return <span className="text-emerald-400/90">&quot;{value.slice(0, 200)}...&quot;</span>;
    }
    return <span className="text-emerald-400/90">&quot;{value}&quot;</span>;
  }

  if (Array.isArray(value)) {
    return <JsonArray items={value} depth={depth} defaultExpanded={defaultExpanded} />;
  }
  if (typeof value === "object") {
    return <JsonObject obj={value as Record<string, unknown>} depth={depth} defaultExpanded={defaultExpanded} />;
  }
  return <span>{String(value)}</span>;
}

function JsonObject({ obj, depth, defaultExpanded }: { obj: Record<string, unknown>; depth: number; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 2);
  const keys = Object.keys(obj);

  if (keys.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-0.5 hover:bg-muted/50 rounded px-0.5 -mx-0.5">
        <ChevronRight className="size-3 text-muted-foreground/50" />
        <span className="text-muted-foreground">{"{"}</span>
        <span className="text-muted-foreground/60 text-[11px] mx-1">{keys.length} keys</span>
        <span className="text-muted-foreground">{"}"}</span>
      </button>
    );
  }

  return (
    <span>
      <button type="button" onClick={() => setExpanded(false)} className="inline-flex items-center hover:bg-muted/50 rounded px-0.5 -mx-0.5">
        <ChevronRight className="size-3 text-muted-foreground/50 rotate-90 transition-transform" />
        <span className="text-muted-foreground">{"{"}</span>
      </button>
      <div className="ml-4 border-l border-muted/30 pl-3">
        {keys.map((key, i) => (
          <div key={key} className="leading-relaxed">
            <span className="text-violet-400/80">&quot;{key}&quot;</span>
            <span className="text-muted-foreground">: </span>
            <JsonValue value={obj[key]} depth={depth + 1} defaultExpanded={defaultExpanded} />
            {i < keys.length - 1 && <span className="text-muted-foreground">,</span>}
          </div>
        ))}
      </div>
      <span className="text-muted-foreground">{"}"}</span>
    </span>
  );
}

function JsonArray({ items, depth, defaultExpanded }: { items: unknown[]; depth: number; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 2);

  if (items.length === 0) return <span className="text-muted-foreground">[]</span>;

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-0.5 hover:bg-muted/50 rounded px-0.5 -mx-0.5">
        <ChevronRight className="size-3 text-muted-foreground/50" />
        <span className="text-muted-foreground">[</span>
        <span className="text-muted-foreground/60 text-[11px] mx-1">{items.length} items</span>
        <span className="text-muted-foreground">]</span>
      </button>
    );
  }

  return (
    <span>
      <button type="button" onClick={() => setExpanded(false)} className="inline-flex items-center hover:bg-muted/50 rounded px-0.5 -mx-0.5">
        <ChevronRight className="size-3 text-muted-foreground/50 rotate-90 transition-transform" />
        <span className="text-muted-foreground">[</span>
      </button>
      <div className="ml-4 border-l border-muted/30 pl-3">
        {items.map((item, i) => (
          <div key={i} className="leading-relaxed">
            <JsonValue value={item} depth={depth + 1} defaultExpanded={defaultExpanded} />
            {i < items.length - 1 && <span className="text-muted-foreground">,</span>}
          </div>
        ))}
      </div>
      <span className="text-muted-foreground">]</span>
    </span>
  );
}

export function JsonViewer({ data, className, defaultExpanded = false }: JsonViewerProps) {
  return (
    <div className={cn("font-mono text-xs rounded-xl bg-muted/30 border p-4 overflow-auto", className)}>
      <JsonValue value={data} depth={0} defaultExpanded={defaultExpanded} />
    </div>
  );
}
