"use client";

import { useState } from "react";
import { suggestStructureAction } from "@/lib/actions/masterReviewActions";
import { applyStructureChanges, type StructureChange } from "@/lib/claude/editing";
import type { MasterChapter } from "@/lib/masterReview";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";

type Decision = "accept" | "reject";

const touch = "h-11 px-3.5 text-sm";

function sameParagraphs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function describe(change: StructureChange): string {
  const n = change.paragraphIndex + 1;
  return change.kind === "split" ? `${n}문단을 나눠요` : `${n}·${n + 1}문단을 합쳐요`;
}

/**
 * 챕터 하나의 문단 구성(나누기·합치기)을 Claude에게 제안받는다. Claude는 문단 경계만 제안하고 글자는 바꾸지 않는다.
 * 제안은 받은 시점의 문단 배열(basis)을 기준으로 하므로, 그 뒤 본문이 바뀌면(직접 편집·이동·다른 적용) 낡은 것으로 보고 버린다.
 * 챕터가 바뀌면 부모가 key를 바꿔 새로 시작한다.
 */
export function StructureSuggestions({
  mode,
  id,
  chapters,
  chapterNumber,
  disabled,
  onApply,
}: {
  mode: "review" | "published";
  id: string;
  chapters: MasterChapter[];
  chapterNumber: number;
  disabled: boolean;
  onApply: (paragraphs: string[]) => void;
}) {
  const paragraphs = chapters.find((c) => c.chapterNumber === chapterNumber)?.paragraphs ?? [];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ changes: StructureChange[]; decisions: Record<number, Decision>; basis: string[] } | null>(null);

  const busy = disabled || loading;
  const stale = result !== null && !sameParagraphs(result.basis, paragraphs);

  async function ask() {
    setLoading(true);
    setError(null);
    const basis = paragraphs;
    const response = await suggestStructureAction({ mode, id, chapters, chapterNumber, instruction: note });
    setLoading(false);
    if (response.error || !response.changes) {
      setError(response.error ?? "문단 구성 제안을 받지 못했습니다");
      return;
    }
    setResult({ changes: response.changes, decisions: {}, basis });
  }

  function decide(index: number, decision: Decision) {
    if (!result) return;
    setResult({ ...result, decisions: { ...result.decisions, [index]: decision } });
  }

  const accepted = result && !stale ? result.changes.filter((_, i) => result.decisions[i] === "accept") : [];
  const preview = result && !stale ? applyStructureChanges(result.basis, accepted) : [];

  return (
    <section aria-label="문단 구성 제안" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-28 flex-1 text-sm font-semibold">이 장의 문단 구성</h3>
        <span className="text-xs text-muted-foreground">지금 {paragraphs.length}문단 · 글자는 바꾸지 않고 문단 경계만 제안해요</span>
      </div>

      <input
        aria-label="문단 구성을 제안받을 때 신경 쓸 점 (선택)"
        placeholder="신경 쓸 점 (선택) 예: 대사는 따로 나눠줘"
        value={note}
        maxLength={500}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <Button type="button" variant="outline" className="h-11 self-start px-4 text-sm" disabled={busy || paragraphs.length === 0} onClick={ask}>
        {loading ? "문단 구성을 살펴보는 중…" : "Claude에게 문단 구성 제안 요청"}
      </Button>
      {error && <InlineError message={error} />}

      {stale && result && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <span className="flex-1">본문이 바뀌어 제안이 낡았어요 — 다시 요청해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setResult(null)}>
            닫기
          </Button>
        </div>
      )}

      {result && !stale && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="min-w-28 flex-1 text-sm font-semibold">제안 {result.changes.length}건</h4>
            {result.changes.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className={touch}
                onClick={() => setResult({ ...result, decisions: Object.fromEntries(result.changes.map((_, i) => [i, "accept"])) })}
              >
                모두 수락
              </Button>
            )}
          </div>

          {result.changes.length === 0 && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
              나누거나 합칠 곳을 찾지 못했어요. 지금 구성을 그대로 써도 좋아요.
            </p>
          )}

          {result.changes.map((change, i) => {
            const decision = result.decisions[i];
            return (
              <div key={`${change.kind}-${change.paragraphIndex}-${i}`} className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-3">
                <p className="text-sm font-semibold">{describe(change)}</p>
                <p className="text-sm leading-relaxed">{change.reason}</p>
                {change.kind === "split" && (
                  <p className="font-serif text-sm leading-relaxed text-muted-foreground">
                    “{change.splitBefore}” 앞에서 나눠요
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" className={touch} variant={decision === "accept" ? "default" : "outline"} aria-pressed={decision === "accept"} onClick={() => decide(i, "accept")}>
                    수락
                  </Button>
                  <Button type="button" className={touch} variant={decision === "reject" ? "secondary" : "outline"} aria-pressed={decision === "reject"} onClick={() => decide(i, "reject")}>
                    거절
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {decision === "accept" ? "수락함" : decision === "reject" ? "거절함" : "아직 고르지 않았어요"}
                  </span>
                </div>
              </div>
            );
          })}

          {accepted.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-primary px-3.5 py-3">
              <p className="text-sm font-semibold text-primary">
                수락한 {accepted.length}건을 적용하면 {paragraphs.length}문단 → {preview.length}문단이 돼요
              </p>
              <ol className="flex flex-col gap-1 font-serif text-[13px] leading-snug">
                {preview.map((p, i) => (
                  <li key={i} className="truncate">
                    <span className="mr-1.5 text-xs font-semibold text-muted-foreground">{i + 1}</span>
                    {p}
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-12 px-5 text-sm font-semibold"
                  disabled={busy}
                  onClick={() => {
                    onApply(preview);
                    setResult(null);
                  }}
                >
                  이 구성으로 적용
                </Button>
                <Button type="button" variant="outline" className="h-12 px-5 text-sm" onClick={() => setResult(null)}>
                  적용하지 않고 닫기
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
