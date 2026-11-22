"use client";

import type { MasterEvaluation } from "@/lib/admin-functions/storyGenerator";
import { ITEM_LABELS, findPhraseLocation, scoreTone } from "@/lib/qualityCheck";
import type { MasterChapter } from "@/lib/masterReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";

const TONE_BADGE = { good: "success", borderline: "warning", low: "destructive" } as const;

/**
 * 승인 전 "품질 점검": 마스터 게이트(Layer 6)와 같은 규칙 검사 + Gemini 심사를 지금 글에 돌려 본 결과를 보여준다.
 * 결과는 점검한 시점의 글 기준이라, 그 뒤 글이 바뀌면(stale) 다시 점검하라고 알린다. 승인을 막지는 않는다.
 * 부모(MasterEditor)가 결과·진행 상태를 들고 있어 탭을 오가도 유지된다.
 */
export function QualityCheckPanel({
  evaluation,
  stale,
  running,
  error,
  disabled,
  chapters,
  onRun,
  onJump,
}: {
  evaluation: MasterEvaluation | null;
  stale: boolean;
  running: boolean;
  error: string | null;
  disabled: boolean;
  chapters: MasterChapter[];
  onRun: () => void;
  onJump: (chapterNumber: number, paragraphIndex: number) => void;
}) {
  const llm = evaluation?.llm ?? null;
  const judged = llm && !("error" in llm) ? llm : null;

  return (
    <section aria-label="품질 점검" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-sm font-semibold">승인 전 품질 점검</h3>
      <p className="text-xs leading-snug text-muted-foreground">
        마스터 품질 게이트와 같은 규칙 검사와 Gemini 심사를 지금 글에 돌려 봐요. 참고용이라 승인은 막지 않아요. 심사는 본문 발췌를 보고 매번 조금씩 달라질 수 있어요.
      </p>
      <Button type="button" variant="outline" className="h-11 self-start px-4 text-sm" disabled={disabled || running} onClick={onRun}>
        {running ? "점검하는 중… 수십 초 걸려요" : evaluation ? "다시 점검" : "점검 실행"}
      </Button>
      {error && <InlineError message={error} />}

      {evaluation && stale && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
          점검한 뒤 글이 바뀌었어요. 다시 점검하면 지금 글 기준으로 볼 수 있어요.
        </p>
      )}

      {evaluation && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">
              규칙 검사 <Badge variant={evaluation.ruleBase.pass ? "success" : "destructive"}>{evaluation.ruleBase.pass ? "통과" : "실패"}</Badge>
            </p>
            {evaluation.ruleBase.failures.length > 0 && (
              <ul className="list-disc pl-5 text-sm leading-relaxed text-destructive">
                {evaluation.ruleBase.failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            {evaluation.ruleBase.warnings.length > 0 && (
              <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
                {evaluation.ruleBase.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>

          {llm === null && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
              규칙 검사를 통과하지 못해 Gemini 심사는 건너뛰었어요. 위 실패를 고친 뒤 다시 점검해 주세요.
            </p>
          )}
          {llm && "error" in llm && <InlineError message={`Gemini 심사를 받지 못했어요: ${llm.error}`} />}

          {judged && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">
                Gemini 심사{" "}
                <Badge variant={judged.pass ? "success" : "destructive"}>{judged.pass ? "통과" : `낮은 항목 ${judged.failItems.length}개`}</Badge>
              </p>
              {judged.items.map((item) => (
                <div key={item.key} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="flex-1">{ITEM_LABELS[item.key] ?? item.key}</span>
                    {!item.gated && <span className="text-xs font-normal text-muted-foreground">판정 제외</span>}
                    <Badge variant={TONE_BADGE[scoreTone(item.score)]}>{item.score}점</Badge>
                  </p>
                  {item.reason && <p className="text-sm leading-relaxed">{item.reason}</p>}
                  {item.problemPhrases?.map((phrase) => {
                    const at = findPhraseLocation(chapters, phrase);
                    return (
                      <div key={phrase} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 font-serif text-sm leading-snug text-muted-foreground">“{phrase}”</span>
                        {at && (
                          <Button type="button" variant="outline" size="sm" onClick={() => onJump(at.chapterNumber, at.paragraphIndex)}>
                            {at.chapterNumber}장 {at.paragraphIndex + 1}문단으로 이동
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
