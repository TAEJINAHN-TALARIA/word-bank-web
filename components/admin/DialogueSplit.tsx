"use client";

import { useState } from "react";
import { splitDialogue, type DialogueSplitMode } from "@/lib/dialogueSplit";
import { Button } from "@/components/ui/button";

const touch = "h-11 px-4 text-sm";

/**
 * 챕터 하나의 따옴표 대사를 문단으로 나눈 결과를 미리 보고 적용한다(규칙 기반, 서버 호출 없음).
 * 두 방식(대사만 따로 / 서술 붙이기)의 결과를 모두 계산해 버튼에 문단 수를 보여 주고, 고른 방식을 미리 보기에 쓴다.
 * 미리 보기는 열려 있는 동안 현재 본문으로 매번 다시 계산하므로 낡은 제안이 생기지 않는다.
 * 챕터가 바뀌면 부모가 key를 바꿔 닫힌 상태·기본 방식(대사만 따로)으로 새로 시작한다.
 */
export function DialogueSplit({
  paragraphs,
  disabled,
  onApply,
}: {
  paragraphs: string[];
  disabled: boolean;
  onApply: (paragraphs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DialogueSplitMode>("separate");
  const results = open
    ? { separate: splitDialogue(paragraphs, "separate"), attach: splitDialogue(paragraphs, "attach") }
    : null;
  const result = results ? results[mode] : null;
  const changed = result !== null && result.paragraphs.length !== paragraphs.length;

  return (
    <section aria-label="대사 나누기" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-28 flex-1 text-sm font-semibold">대사 나누기</h3>
        <span className="text-xs text-muted-foreground">지금 {paragraphs.length}문단 · 따옴표 대사를 문단으로 나눠요. 글자는 바꾸지 않아요</span>
      </div>

      {!open && (
        <Button type="button" variant="outline" className={`${touch} self-start`} disabled={disabled || paragraphs.length === 0} onClick={() => setOpen(true)}>
          대사 나누기 미리 보기
        </Button>
      )}

      {results && result && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          <div role="group" aria-label="나누는 방식" className="flex flex-wrap gap-2">
            <Button type="button" className={touch} variant={mode === "separate" ? "default" : "outline"} aria-pressed={mode === "separate"} onClick={() => setMode("separate")}>
              대사만 따로 ({results.separate.paragraphs.length}문단)
            </Button>
            <Button type="button" className={touch} variant={mode === "attach" ? "default" : "outline"} aria-pressed={mode === "attach"} onClick={() => setMode("attach")}>
              서술 붙이기 ({results.attach.paragraphs.length}문단)
            </Button>
          </div>

          {result.skipped.length > 0 && (
            <p role="status" className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
              따옴표 짝이 맞지 않아 건너뛴 문단: {result.skipped.join(", ")}
            </p>
          )}

          {!changed && (
            <>
              <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                나눌 대사를 찾지 못했어요. 지금 구성을 그대로 써도 좋아요.
              </p>
              <Button type="button" variant="outline" className={`${touch} self-start`} onClick={() => setOpen(false)}>
                닫기
              </Button>
            </>
          )}

          {changed && (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-primary px-3.5 py-3">
              <p className="text-sm font-semibold text-primary">
                적용하면 {paragraphs.length}문단 → {result.paragraphs.length}문단이 돼요
              </p>
              <ol className="flex flex-col gap-1 font-serif text-[13px] leading-snug">
                {result.paragraphs.map((p, i) => (
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
                  disabled={disabled}
                  onClick={() => {
                    onApply(result.paragraphs);
                    setOpen(false);
                  }}
                >
                  이 구성으로 적용
                </Button>
                <Button type="button" variant="outline" className="h-12 px-5 text-sm" onClick={() => setOpen(false)}>
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
