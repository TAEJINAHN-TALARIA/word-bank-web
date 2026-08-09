import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function GroupCollapseToggle({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex items-center gap-1.5 text-left hover:underline"
    >
      {expanded ? (
        <ChevronDown className="size-4 shrink-0" />
      ) : (
        <ChevronRight className="size-4 shrink-0" />
      )}
      {children}
    </button>
  );
}
