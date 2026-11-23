"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkFactsAction, polishChapterAction, suggestStructureAction } from "@/lib/actions/masterReviewActions";
import type { StructureChange } from "@/lib/claude/editing";
import type { FactFinding, FactFix } from "@/lib/claude/preprocessing";
import type { DialogueSplitMode } from "@/lib/dialogueSplit";
import {
  applyFactFixes,
  applyPolishes,
  buildCleanupBase,
  fetchChapterPolish,
  fetchChapterSuggestion,
  fetchFactCheck,
  summarizeChapter,
  type ChapterPolish,
  type ChapterSuggestion,
} from "@/lib/paragraphCleanup";
import type { MasterChapter } from "@/lib/masterReview";
import { Button } from "@/components/ui/button";

type Phase = "setup" | "running" | "facts" | "result";
type Decision = "accept" | "reject";
type Stage = "facts" | "polish" | "structure";

type Run = {
  /** 모달을 연 시점의 본문. 장별 변경 여부와 적용 체크의 기준이다. */
  original: MasterChapter[];
  /** ④에서 고른 정정을 적용한 본문. ③의 입력이다. */
  afterFacts: MasterChapter[];
  /** 이 실행에서 쓴 대사 나누기 방식(null이면 안 함) */
  split: DialogueSplitMode | null;
  findings: FactFinding[];
  factsError?: string;
  /** 편집자가 고른 ④ 정정 */
  fixes: FactFix[];
  polishes: Record<number, ChapterPolish>;
  suggestions: Record<number, ChapterSuggestion>;
};

const touch = "h-11 px-4 text-sm";

const sameParagraphs = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);
const changeKey = (chapterNumber: number, index: number) => `${chapterNumber}-${index}`;

function describe(change: StructureChange): string {
  const n = change.paragraphIndex + 1;
  return change.kind === "split" ? `${n}문단을 나눠요` : `${n}·${n + 1}문단을 합쳐요`;
}

const STAGE_LABEL: Record<Stage, string> = {
  facts: "Claude가 사실관계를 점검하는 중…",
  polish: "Claude가 문장을 다듬는 중…",
  structure: "Claude가 문단 구성을 살펴보는 중…",
};

/**
 * 문단 정리(마스터 전처리): 전 장에 ④ 사실관계 점검 → ③ 문장 다듬기 → ① 대사 나누기 → ② Claude 문단 구성 제안을 실행하고,
 * 장별로 확인한 뒤 한 번에 적용한다. 문장을 고치는 단계(④③)가 나누는 단계(①②)보다 먼저여야 ②가 인용하는 문장이 어긋나지 않는다.
 * ④가 모순을 찾으면 여기서 멈추고 편집자가 정정을 고른 뒤 ③부터 이어간다(고르지 않은 정정은 적용하지 않는다).
 * 열려 있는 동안만 마운트된다(부모가 닫으면 언마운트) — 그래서 열 때마다 상태가 새로 시작하고, 언마운트가 남은 호출을 멈춘다.
 * 모달이 편집 화면을 막고 있으므로 실행 중에 본문이 바뀌지 않는다(낡은 제안 처리가 필요 없다).
 * 설계: docs/superpowers/specs/2026-11-22-editor-cleanup-modal-titles-design.md, 2026-11-23-master-preprocess-design.md
 */
export function ParagraphCleanupModal({
  mode,
  id,
  chapters,
  disabled,
  onClose,
  onApply,
}: {
  mode: "review" | "published";
  id: string;
  chapters: MasterChapter[];
  disabled: boolean;
  onClose: () => void;
  onApply: (next: Map<number, string[]>) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 실행마다 올라가는 번호. 멈추기·닫기·언마운트로 올리면 진행 중이던 반복이 다음 확인에서 그친다.
  const runToken = useRef(0);

  const [phase, setPhase] = useState<Phase>("setup");
  const [checkFacts, setCheckFacts] = useState(true);
  const [polish, setPolish] = useState(true);
  const [dialogue, setDialogue] = useState(true);
  const [dialogueMode, setDialogueMode] = useState<DialogueSplitMode>("separate");
  const [useClaude, setUseClaude] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [progress, setProgress] = useState<{ stage: Stage; done: number; total: number } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [factPicks, setFactPicks] = useState<Record<number, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      runToken.current++;
    };
  }, []);

  // 받은 ③ 결과와 ④ 정정을 반영한 본문에 대사 나누기를 적용한 작업본. 멈춰도 받지 못한 단계는 원문 그대로, ①은 전 장에 적용된다.
  const base = useMemo(() => (run ? buildCleanupBase(applyPolishes(run.afterFacts, run.polishes), run.split) : null), [run]);

  async function execute() {
    const token = ++runToken.current;
    const original = chapters;
    const split = dialogue ? dialogueMode : null;
    setRun({ original, afterFacts: original, split, findings: [], fixes: [], polishes: {}, suggestions: {} });
    setFactPicks({});
    setDecisions({});
    setOverrides({});
    setPhase("running");

    if (checkFacts) {
      setProgress({ stage: "facts", done: 0, total: 0 });
      const check = await fetchFactCheck(() => checkFactsAction({ mode, id, chapters: original }));
      if (runToken.current !== token) return;
      const findings = check.findings ?? [];
      setRun((prev) => (prev ? { ...prev, findings, factsError: check.error } : prev));
      if (findings.length > 0) {
        setProgress(null);
        setPhase("facts");
        return;
      }
    }
    await proceed(token, original, split);
  }

  // 고른 ④ 정정을 적용한 본문으로 ③부터 이어간다. 아무것도 고르지 않았으면 본문은 그대로다.
  async function continueAfterFacts() {
    if (!run) return;
    const token = ++runToken.current;
    const fixes = run.findings.flatMap((finding, index) => (factPicks[index] && finding.fix ? [finding.fix] : []));
    const afterFacts = applyFactFixes(run.original, fixes);
    setRun({ ...run, afterFacts, fixes });
    setPhase("running");
    await proceed(token, afterFacts, run.split);
  }

  // ③ 문장 다듬기(장마다) → ② Claude 문단 구성 제안(장마다). 한 장의 실패는 그 장의 오류로 남고 반복은 계속된다.
  async function proceed(token: number, afterFacts: MasterChapter[], split: DialogueSplitMode | null) {
    const polishes: Record<number, ChapterPolish> = {};
    if (polish) {
      const total = afterFacts.length;
      for (let i = 0; i < total; i++) {
        if (runToken.current !== token) return;
        setProgress({ stage: "polish", done: i, total });
        const { chapterNumber } = afterFacts[i];
        const result = await fetchChapterPolish(() => polishChapterAction({ mode, id, chapters: afterFacts, chapterNumber }));
        if (runToken.current !== token) return;
        polishes[chapterNumber] = result;
        setRun((prev) => (prev ? { ...prev, polishes: { ...prev.polishes, [chapterNumber]: result } } : prev));
      }
    }

    if (useClaude) {
      const structureBase = buildCleanupBase(applyPolishes(afterFacts, polishes), split);
      const total = structureBase.chapters.length;
      for (let i = 0; i < total; i++) {
        if (runToken.current !== token) return;
        setProgress({ stage: "structure", done: i, total });
        const chapter = structureBase.chapters[i];
        const suggestion = await fetchChapterSuggestion(() =>
          suggestStructureAction({ mode, id, chapters: structureBase.chapters, chapterNumber: chapter.chapterNumber, instruction }),
        );
        if (runToken.current !== token) return;
        setRun((prev) => (prev ? { ...prev, suggestions: { ...prev.suggestions, [chapter.chapterNumber]: suggestion } } : prev));
      }
    }
    setProgress(null);
    setPhase("result");
  }

  // 멈추면 지금까지 받은 결과만으로 결과 화면을 보여준다. 이미 나간 호출은 돌아와도 무시된다.
  function stop() {
    runToken.current++;
    setProgress(null);
    setPhase("result");
  }

  const outcomes =
    run && base
      ? base.chapters.map((baseChapter, i) => {
          const original = run.original[i];
          const suggestion = run.suggestions[baseChapter.chapterNumber];
          const polished = run.polishes[baseChapter.chapterNumber];
          const fixes = run.fixes.filter((f) => f.chapterNumber === baseChapter.chapterNumber);
          const changes = suggestion?.changes ?? [];
          const accepted = changes.filter((_, index) => decisions[changeKey(baseChapter.chapterNumber, index)] === "accept");
          const outcome = summarizeChapter(original, baseChapter, accepted);
          const changed = !sameParagraphs(original.paragraphs, outcome.final);
          const included = overrides[baseChapter.chapterNumber] ?? changed;
          return { baseChapter, original, suggestion, polished, fixes, changes, outcome, changed, included };
        })
      : [];
  const applyList = outcomes.filter((o) => o.included && o.changed);

  function acceptAll() {
    const next: Record<string, Decision> = {};
    for (const o of outcomes) o.changes.forEach((_, index) => (next[changeKey(o.baseChapter.chapterNumber, index)] = "accept"));
    setDecisions(next);
  }

  function apply() {
    onApply(new Map(applyList.map((o) => [o.baseChapter.chapterNumber, o.outcome.final])));
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="문단 정리"
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-4 text-foreground backdrop:bg-black/40 sm:p-5"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-28 flex-1 text-base font-semibold">문단 정리</h2>
          <Button type="button" variant="outline" className={touch} onClick={onClose}>
            닫기
          </Button>
        </div>

        {phase === "setup" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              모든 장에 한 번에 실행해요. 사실관계 점검 → 문장 다듬기 → 대사 나누기 → 문단 구성 제안 순서예요. 문장을 고치는 단계가 먼저예요. 결과는 장별로 확인한 뒤 적용해요.
            </p>

            <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={checkFacts} onChange={(e) => setCheckFacts(e.target.checked)} className="size-4" />
                사실관계 점검
              </label>
              <p className="text-xs text-muted-foreground">
                원고 전체를 한 번 읽고, 글에 적힌 나이·장소·시간 같은 사실이 서로 부딪히는 곳을 찾아요. 정정은 제안만 하고, 고른 것만 적용해요.
              </p>
            </fieldset>

            <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={polish} onChange={(e) => setPolish(e.target.checked)} className="size-4" />
                문장 다듬기
              </label>
              <p className="text-xs text-muted-foreground">
                장마다 Claude를 한 번씩 불러요({chapters.length}장이면 {chapters.length}번). 수식어와 군더더기를 덜어내요. 대사와 숫자·나이·날짜는 건드리지 않고, 통과한 항목은 모두 적용한 결과를 보여줘요.
              </p>
            </fieldset>

            <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={dialogue} onChange={(e) => setDialogue(e.target.checked)} className="size-4" />
                대사 나누기
              </label>
              <div role="group" aria-label="나누는 방식" className="flex flex-wrap gap-2">
                <Button type="button" className={touch} disabled={!dialogue} variant={dialogueMode === "separate" ? "default" : "outline"} aria-pressed={dialogueMode === "separate"} onClick={() => setDialogueMode("separate")}>
                  대사만 따로
                </Button>
                <Button type="button" className={touch} disabled={!dialogue} variant={dialogueMode === "attach" ? "default" : "outline"} aria-pressed={dialogueMode === "attach"} onClick={() => setDialogueMode("attach")}>
                  서술 붙이기
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">따옴표 대사 앞에서 문단을 나눠요. 글자는 바꾸지 않아요.</p>
            </fieldset>

            <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={useClaude} onChange={(e) => setUseClaude(e.target.checked)} className="size-4" />
                Claude 문단 구성 제안
              </label>
              <input
                aria-label="문단 구성을 제안받을 때 신경 쓸 점 (선택)"
                placeholder="신경 쓸 점 (선택) 예: 장면이 바뀌는 곳에서 나눠줘"
                value={instruction}
                maxLength={500}
                disabled={!useClaude}
                onChange={(e) => setInstruction(e.target.value)}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">장마다 Claude를 한 번씩 불러요({chapters.length}장이면 {chapters.length}번). 글자는 바꾸지 않고 문단 경계만 제안해요.</p>
            </fieldset>

            <Button type="button" className="h-12 self-start px-5 text-sm font-semibold" disabled={disabled || (!checkFacts && !polish && !dialogue && !useClaude)} onClick={() => void execute()}>
              실행
            </Button>
          </div>
        )}

        {phase === "running" && progress && (
          <div role="status" className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed">
              {STAGE_LABEL[progress.stage]}{" "}
              {progress.stage !== "facts" && <strong className="font-semibold">{progress.done + 1}/{progress.total}장</strong>}
            </p>
            <Button type="button" variant="outline" className={`${touch} self-start`} onClick={stop}>
              멈추고 지금까지 보기
            </Button>
          </div>
        )}

        {phase === "facts" && run && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">사실관계 점검 결과</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              글끼리 부딪히는 곳 {run.findings.length}건을 찾았어요. 어느 쪽이 맞는지는 편집자가 정해요. 고르지 않은 항목은 무시와 같아요.
            </p>

            {run.findings.map((finding, index) => {
              const picked = factPicks[index] === true;
              return (
                <div key={index} className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-3">
                  <p className="text-sm font-semibold">{finding.topic}</p>
                  <p className="text-sm leading-relaxed">{finding.description}</p>
                  {finding.occurrences.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {finding.occurrences.map((o, i) => (
                        <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                          {o.chapterNumber}장 {o.paragraphIndex + 1}문단 <span className="font-serif">“{o.quote}”</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {finding.fix ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2.5">
                      <p className="font-serif text-sm leading-relaxed">
                        {finding.fix.chapterNumber}장 {finding.fix.paragraphIndex + 1}문단: “{finding.fix.before}” → “{finding.fix.after}”
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{finding.fix.reason}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" className={touch} variant={picked ? "default" : "outline"} aria-pressed={picked} onClick={() => setFactPicks((prev) => ({ ...prev, [index]: true }))}>
                          이 정정 적용
                        </Button>
                        <Button type="button" className={touch} variant={!picked ? "secondary" : "outline"} aria-pressed={!picked} onClick={() => setFactPicks((prev) => ({ ...prev, [index]: false }))}>
                          무시
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">정정 제안 없음</p>
                  )}
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button type="button" className="h-12 px-5 text-sm font-semibold" onClick={() => void continueAfterFacts()}>
                계속
              </Button>
              <Button type="button" variant="outline" className="h-12 px-5 text-sm" onClick={onClose}>
                적용하지 않고 닫기
              </Button>
            </div>
          </div>
        )}

        {phase === "result" && run && (
          <div className="flex flex-col gap-3">
            {run.factsError && (
              <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-destructive">
                사실관계 점검을 받지 못했어요: {run.factsError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-28 flex-1 text-sm font-semibold">장별 결과</h3>
              {outcomes.some((o) => o.changes.length > 0) && (
                <Button type="button" variant="outline" className={touch} onClick={acceptAll}>
                  Claude 제안 모두 수락
                </Button>
              )}
            </div>

            {outcomes.map((o) => {
              const n = o.baseChapter.chapterNumber;
              const skipped = base?.skipped[n];
              const polishChanges = o.polished?.changes ?? [];
              return (
                <div key={n} className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-3">
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={`${n}장 적용`}
                      checked={o.included}
                      disabled={!o.changed}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, [n]: e.target.checked }))}
                    />
                    <span className="min-w-40 flex-1 font-semibold">
                      {n}장 · {o.baseChapter.chapterTitle}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      지금 {o.outcome.before}문단
                      {o.fixes.length > 0 && <> → 사실관계 정정 {o.fixes.length}곳</>}
                      {o.polished?.changes && <> → 문장 다듬기 {polishChanges.length}곳</>}
                      {" "}→ 대사 나누기 {o.outcome.afterSplit}문단 → 적용 시 {o.outcome.final.length}문단
                    </span>
                  </label>

                  {skipped && skipped.length > 0 && (
                    <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                      따옴표 짝이 맞지 않아 건너뛴 문단: {skipped.join(", ")}
                    </p>
                  )}
                  {o.polished?.error && (
                    <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-destructive">
                      문장 다듬기를 받지 못했어요: {o.polished.error}
                    </p>
                  )}
                  {o.suggestion?.error && (
                    <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-destructive">
                      Claude 제안을 받지 못했어요: {o.suggestion.error}
                    </p>
                  )}
                  {o.fixes.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm">사실관계 정정 {o.fixes.length}건</summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {o.fixes.map((fix, index) => (
                          <div key={index} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
                            <p className="font-serif text-sm leading-relaxed">
                              {fix.paragraphIndex + 1}문단: “{fix.before}” → “{fix.after}”
                            </p>
                            <p className="text-xs leading-relaxed text-muted-foreground">{fix.reason}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {o.polished?.changes && (o.polished.received ?? 0) > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        문장 다듬기 {polishChanges.length}곳 (받은 {o.polished.received}건 중 {polishChanges.length}건 적용)
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {polishChanges.map((change, index) => (
                          <div key={index} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
                            <p className="font-serif text-sm leading-relaxed">
                              {change.paragraphIndex + 1}문단: “{change.before}” → “{change.after}”
                            </p>
                            <p className="text-xs leading-relaxed text-muted-foreground">{change.reason}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {o.changes.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm">Claude 제안 {o.changes.length}건 (대사 나누기 뒤 문단 기준)</summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {o.changes.map((change, index) => {
                          const key = changeKey(n, index);
                          const decision = decisions[key];
                          return (
                            <div key={key} className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
                              <p className="text-sm font-semibold">{describe(change)}</p>
                              <p className="text-sm leading-relaxed">{change.reason}</p>
                              {change.kind === "split" && (
                                <p className="font-serif text-sm leading-relaxed text-muted-foreground">“{change.splitBefore}” 앞에서 나눠요</p>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <Button type="button" className={touch} variant={decision === "accept" ? "default" : "outline"} aria-pressed={decision === "accept"} onClick={() => setDecisions((prev) => ({ ...prev, [key]: "accept" }))}>
                                  수락
                                </Button>
                                <Button type="button" className={touch} variant={decision === "reject" ? "secondary" : "outline"} aria-pressed={decision === "reject"} onClick={() => setDecisions((prev) => ({ ...prev, [key]: "reject" }))}>
                                  거절
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {decision === "accept" ? "수락함" : decision === "reject" ? "거절함" : "아직 고르지 않았어요"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button type="button" className="h-12 px-5 text-sm font-semibold" disabled={disabled || applyList.length === 0} onClick={apply}>
                이 구성으로 {applyList.length}개 장 적용
              </Button>
              <Button type="button" variant="outline" className="h-12 px-5 text-sm" onClick={() => setPhase("setup")}>
                설정으로 돌아가기
              </Button>
              <Button type="button" variant="outline" className="h-12 px-5 text-sm" onClick={onClose}>
                적용하지 않고 닫기
              </Button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
