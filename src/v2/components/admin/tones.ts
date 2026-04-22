export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
};

export function toneClasses(tone: Tone): string {
  return toneClass[tone];
}

export function hostStatusTone(status: string): Tone {
  switch (status) {
    case "active":
      return "success";
    case "ordering":
    case "bootstrapping":
      return "warning";
    case "error":
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function maintenanceStateTone(state: string): Tone {
  switch (state) {
    case "in_service":
      return "success";
    case "drain_requested":
    case "draining":
      return "warning";
    case "drained":
    case "maintenance":
      return "info";
    default:
      return "neutral";
  }
}

export function validationStatusTone(status: "passed" | "warning" | "failed" | null | undefined): Tone {
  switch (status) {
    case "passed":
      return "success";
    case "warning":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function driftStatusTone(state: "in_policy" | "warning_drift" | "blocking_drift" | null | undefined): Tone {
  switch (state) {
    case "in_policy":
      return "success";
    case "warning_drift":
      return "warning";
    case "blocking_drift":
      return "danger";
    default:
      return "neutral";
  }
}

export function incusUiTone(state: "disabled" | "operator_only" | "cluster_console" | null | undefined): Tone {
  switch (state) {
    case "operator_only":
      return "info";
    case "cluster_console":
      return "accent";
    case "disabled":
    default:
      return "neutral";
  }
}

export function configAuditTone(state: "ok" | "warning" | "error" | "degraded"): Tone {
  switch (state) {
    case "ok":
      return "success";
    case "warning":
      return "warning";
    case "error":
    case "degraded":
      return "danger";
    default:
      return "neutral";
  }
}

export function admissionStateTone(state: "open" | "restricted" | "closed"): Tone {
  switch (state) {
    case "open":
      return "success";
    case "restricted":
      return "warning";
    case "closed":
      return "danger";
    default:
      return "neutral";
  }
}

export function sellabilityStateTone(state: "sellable" | "reserve_only" | "unsellable"): Tone {
  switch (state) {
    case "sellable":
      return "success";
    case "reserve_only":
      return "warning";
    case "unsellable":
      return "danger";
    default:
      return "neutral";
  }
}

export function procurementStatusTone(status: string): Tone {
  switch (status) {
    case "active":
    case "resolved":
      return "success";
    case "ordered":
    case "bootstrapping":
    case "provisioning":
      return "warning";
    case "failed":
    case "cancelled":
      return "danger";
    case "requested":
      return "info";
    default:
      return "neutral";
  }
}

export function machineStatusTone(status: string): Tone {
  switch (status) {
    case "ready":
      return "success";
    case "provisioning":
    case "stopped":
      return "warning";
    case "error":
    case "deleted":
      return "danger";
    default:
      return "neutral";
  }
}
