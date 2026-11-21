"use client";

import { describeAutosaveStatus, type AutosaveStatus } from "@/lib/autosaver";
import { cn } from "@/lib/utils";

const TONE: Record<ReturnType<typeof describeAutosaveStatus>["tone"], string> = {
  muted: "bg-muted text-muted-foreground",
  busy: "bg-amber-100 text-amber-800",
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-800",
};

/** 자동 임시 저장 상태 칩. 실패하면 칩 자체가 다시 시도 버튼이 된다. 상태가 바뀔 때만 스크린리더에 읽힌다. */
export function SaveStatusChip({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  const { text, tone, retry } = describeAutosaveStatus(status);
  const chip = cn("rounded-full px-3 py-1 text-xs font-semibold", TONE[tone]);
  return (
    <span role="status" aria-live="polite">
      {text &&
        (retry ? (
          <button type="button" onClick={onRetry} className={cn(chip, "hover:opacity-80")}>
            {text}
          </button>
        ) : (
          <span className={chip}>{text}</span>
        ))}
    </span>
  );
}
