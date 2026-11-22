// 생성 상세 화면이 Layer 6 게이트의 판정 사유를 보여주기 위한 순수 변환. "server-only"를 import하지 않는다.
// 게이트(story-generator evaluateLlmGateResult)는 사유를 항목 키별 객체로 저장한다 — { levelFit: "…" },
// { levelFit: { reason, problemPhrases } }, { apiError: "…" } — 그런데 화면의 목록 컴포넌트는 문자열 배열을 기대해서
// 객체를 그대로 넘기면 렌더가 던진다. 모양에 상관없이 문자열 한 줄씩의 목록으로 바꾼다.
import { ITEM_LABELS } from "@/lib/qualityCheck";

function formatEntry(key: string, value: unknown): string {
  const label = ITEM_LABELS[key] ?? key;
  if (value === null || value === undefined || value === "") return label;
  if (typeof value === "string") return `${label}: ${value}`;
  if (typeof value === "object") {
    const { reason, problemPhrases } = value as { reason?: unknown; problemPhrases?: unknown };
    const phrases = Array.isArray(problemPhrases) ? problemPhrases.filter((p): p is string => typeof p === "string" && p !== "") : [];
    const base = typeof reason === "string" && reason ? `${label}: ${reason}` : label;
    return phrases.length > 0 ? `${base} (문제 구절: ${phrases.map((p) => `“${p}”`).join(", ")})` : base;
  }
  return `${label}: ${String(value)}`;
}

export function formatGateReasons(reasons: unknown): string[] {
  if (reasons === null || reasons === undefined) return [];
  if (typeof reasons === "string") return reasons ? [reasons] : [];
  if (Array.isArray(reasons)) return reasons.flatMap((item) => (typeof item === "object" && item !== null ? formatGateReasons(item) : [String(item)]));
  if (typeof reasons === "object") return Object.entries(reasons).map(([key, value]) => formatEntry(key, value));
  return [String(reasons)];
}
