// lib/status.ts
export type StatusBadgeVariant = "success" | "warning" | "destructive" | "secondary" | "outline";

export function statusBadgeVariant(status: string): StatusBadgeVariant {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) return "destructive";
  if (normalized.includes("warn")) return "warning";
  if (normalized.includes("progress") || normalized.includes("pending")) return "secondary";
  if (
    normalized.includes("complete") ||
    normalized.includes("done") ||
    normalized.includes("success") ||
    normalized.includes("pass")
  ) {
    return "success";
  }
  return "outline";
}

export function statusBorderClass(variant: StatusBadgeVariant): string {
  switch (variant) {
    case "destructive":
      return "border-l-destructive";
    case "warning":
      return "border-l-amber-500";
    case "success":
      return "border-l-emerald-500";
    default:
      return "border-l-border";
  }
}
