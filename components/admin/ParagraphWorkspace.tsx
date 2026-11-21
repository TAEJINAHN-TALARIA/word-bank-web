"use client";

import { useMemo, useState } from "react";
import { polishParagraphAction, suggestIdeasAction } from "@/lib/actions/masterReviewActions";
import { applyChanges, type Idea, type PolishChange, type RejectedChange } from "@/lib/claude/editing";
import type { MasterChapter } from "@/lib/masterReview";
import { diffWords } from "@/lib/textDiff";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";
import { HighlightedTextarea } from "@/components/admin/HighlightedTextarea";
import { cn } from "@/lib/utils";

type Decision = "accept" | "reject";
type Version = { label: string; text: string };

const touch = "h-11 px-3.5 text-sm";

/**
 * 문단 하나를 놓고 "Claude가 방향 제안 → 내가 쓰기 → Claude가 다듬기"를 반복하는 작업 공간.
 * 내 글이 원고이고 Claude는 제안만 한다. 대화(고른 방향, 거절한 제안)는 이 화면이 열려 있는 동안만 기억한다.
 * 문단이 바뀌면(부모가 key를 바꿔) 작업 공간이 새로 시작된다.
 */
export function ParagraphWorkspace({
  mode,
  id,
  chapters,
  chapterNumber,
  paragraphIndex,
  paragraphCount,
  text,
  compareText,
  compareLabel,
  showCompare,
  disabled,
  onTextChange,
  onInsert,
  onRemove,
  onMove,
}: {
  mode: "review" | "published";
  id: string;
  chapters: MasterChapter[];
  chapterNumber: number;
  paragraphIndex: number;
  paragraphCount: number;
  text: string;
  // 나란히 볼 이전 버전의 같은 문단. 문단 구조가 바뀌어 짝이 맞지 않으면 undefined.
  compareText: string | undefined;
  compareLabel: string;
  showCompare: boolean;
  disabled: boolean;
  onTextChange: (text: string) => void;
  onInsert: (where: "above" | "below") => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const canRestructure = mode === "review";
  const canIdeas = mode === "review";

  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [ideasNote, setIdeasNote] = useState("");
  const [picked, setPicked] = useState<Idea | null>(null);

  const [polish, setPolish] = useState<{ changes: PolishChange[]; decisions: Record<number, Decision> } | null>(null);
  const [polishLoading, setPolishLoading] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [polishNote, setPolishNote] = useState("");
  const [rejected, setRejected] = useState<RejectedChange[]>([]);

  const [versions, setVersions] = useState<Version[]>([{ label: "원문", text }]);

  const busy = disabled || ideasLoading || polishLoading;
  const segments = useMemo(() => (compareText === undefined ? null : diffWords(compareText, text)), [compareText, text]);

  async function askIdeas() {
    setIdeasLoading(true);
    setIdeasError(null);
    const result = await suggestIdeasAction({ mode, id, chapters, chapterNumber, paragraphIndex, instruction: ideasNote });
    setIdeasLoading(false);
    if (result.error || !result.ideas) {
      setIdeasError(result.error ?? "아이디어를 받지 못했습니다");
      return;
    }
    setIdeas(result.ideas);
    setPicked(null);
  }

  function handleType(next: string) {
    setPolish(null); // 글이 바뀌면 이전 다듬기 결과는 낡은 것이다
    onTextChange(next);
  }

  async function askPolish() {
    setPolishLoading(true);
    setPolishError(null);
    setVersions((prev) => (prev[prev.length - 1].text === text ? prev : [...prev, { label: "내 초안", text }]));
    const result = await polishParagraphAction({
      mode,
      id,
      chapters,
      chapterNumber,
      paragraphIndex,
      direction: picked ? { title: picked.title, sketch: picked.sketch } : null,
      rejected,
      instruction: polishNote,
    });
    setPolishLoading(false);
    if (result.error || !result.changes) {
      setPolishError(result.error ?? "다듬기 결과를 받지 못했습니다");
      return;
    }
    setPolish({ changes: result.changes, decisions: {} });
  }

  function decide(index: number, decision: Decision) {
    if (!polish) return;
    const change = polish.changes[index];
    setPolish({ ...polish, decisions: { ...polish.decisions, [index]: decision } });
    // 거절한 제안은 다음 다듬기에서 다시 나오지 않게 기억한다. 마음을 바꿔 수락하면 기억에서 뺀다.
    setRejected((prev) => {
      const without = prev.filter((r) => !(r.before === change.before && r.after === change.after));
      return decision === "reject" ? [...without, { before: change.before, after: change.after }] : without;
    });
  }

  const accepted = polish ? polish.changes.filter((_, i) => polish.decisions[i] === "accept") : [];
  const preview = applyChanges(text, accepted);

  function applyAccepted() {
    onTextChange(preview);
    setVersions((prev) => [...prev, { label: "다듬은 본", text: preview }]);
    setPolish(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-28 flex-1 text-base font-semibold">문단 {paragraphIndex + 1}</h2>
          {canRestructure && (
            <div role="group" aria-label="문단 편집 도구" className="flex flex-wrap gap-1.5">
              <Button type="button" variant="outline" className={touch} disabled={busy || paragraphIndex === 0} onClick={() => onMove(-1)}>
                위로
              </Button>
              <Button type="button" variant="outline" className={touch} disabled={busy || paragraphIndex === paragraphCount - 1} onClick={() => onMove(1)}>
                아래로
              </Button>
              <Button type="button" variant="outline" className={touch} disabled={busy} onClick={() => onInsert("above")}>
                위에 추가
              </Button>
              <Button type="button" variant="outline" className={touch} disabled={busy} onClick={() => onInsert("below")}>
                아래에 추가
              </Button>
              <Button type="button" variant="destructive" className={touch} disabled={busy || paragraphCount <= 1} onClick={onRemove}>
                삭제
              </Button>
            </div>
          )}
        </div>

        {canIdeas && (
          <section aria-labelledby="ws-ideas" className="flex flex-col gap-2.5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <h3 id="ws-ideas" className="min-w-28 flex-1 text-sm font-semibold">Claude의 방향 제안</h3>
              <Button type="button" variant="outline" className={cn(touch, "border-primary text-primary")} disabled={busy} onClick={askIdeas}>
                {ideasLoading ? "제안 중…" : ideas ? "다시 제안 받기" : "방향 제안 받기"}
              </Button>
            </div>
            <input
              aria-label="원하는 분위기나 방향 (선택)"
              placeholder="원하는 분위기 (선택) 예: 더 긴장되게"
              value={ideasNote}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setIdeasNote(e.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            {ideasError && <InlineError message={ideasError} />}

            {picked && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 px-3 py-2.5">
                <p className="min-w-40 flex-1 text-sm leading-snug">
                  <strong>선택한 방향</strong> · {picked.title}
                </p>
                <Button type="button" variant="outline" className={touch} onClick={() => setPicked(null)}>
                  선택 해제
                </Button>
              </div>
            )}

            {ideas?.map((idea) => {
              const on = picked?.title === idea.title && picked.sketch === idea.sketch;
              return (
                <div key={idea.title} className={cn("flex flex-col gap-1.5 rounded-xl border-2 px-3.5 py-3", on ? "border-primary bg-primary/5" : "border-border")}>
                  <p className="text-sm font-semibold">{idea.title}</p>
                  <p className="font-serif text-sm leading-relaxed">{idea.sketch}</p>
                  <p className="text-xs leading-snug text-muted-foreground">다른 장과의 연결 · {idea.link}</p>
                  <Button
                    type="button"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    className={cn(touch, "self-start", !on && "border-primary text-primary")}
                    onClick={() => setPicked(on ? null : idea)}
                  >
                    {on ? "이 방향으로 쓰는 중" : "이 방향으로 쓰기"}
                  </Button>
                </div>
              );
            })}
          </section>
        )}

        <section aria-labelledby="ws-write" className={cn("flex flex-col gap-2.5", canIdeas && "border-t border-border pt-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{canIdeas ? 2 : 1}</span>
            <h3 id="ws-write" className="min-w-28 flex-1 text-sm font-semibold">내가 쓰기</h3>
            <span className="text-xs text-muted-foreground">{text.replace(/\s/g, "").length}자</span>
          </div>
          {/* xl 이상에서는 이전 버전(왼쪽)과 내 글(오른쪽)을 나란히, 그보다 좁으면 위아래로 쌓는다 */}
          <div className={cn("grid gap-3", showCompare && "xl:grid-cols-2")}>
            {showCompare && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-muted-foreground">
                  이전 버전 · {compareLabel} <span className="font-normal">· 읽기 전용</span>
                </p>
                <div className="min-h-[11.5rem] rounded-xl border-2 border-border bg-muted/40 px-3.5 py-3 font-serif text-base leading-loose whitespace-pre-wrap break-words">
                  {compareText === undefined ? (
                    <span className="font-sans text-sm leading-relaxed text-muted-foreground">
                      문단을 추가·삭제·이동해서 이전 버전과 짝을 맞출 수 없어요
                    </span>
                  ) : compareText === text ? (
                    <>
                      {compareText}
                      <span className="mt-2 block font-sans text-sm text-muted-foreground">아직 바꾼 곳이 없어요</span>
                    </>
                  ) : (
                    segments
                      ?.filter((segment) => segment.type !== "ins")
                      .map((segment, i) =>
                        segment.type === "del" ? (
                          <del key={i} className="rounded-sm bg-red-500/15 text-red-700 decoration-red-700/60 dark:text-red-300">
                            {segment.text}
                          </del>
                        ) : (
                          <span key={i}>{segment.text}</span>
                        ),
                      )
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {showCompare && <p className="text-xs font-semibold text-muted-foreground">내가 고쳐쓰는 중</p>}
              <HighlightedTextarea
                aria-label={`문단 ${paragraphIndex + 1} 본문`}
                value={text}
                disabled={disabled}
                onChange={handleType}
                highlight={showCompare && compareText !== text ? segments : null}
              />
            </div>
          </div>
          <input
            aria-label="다듬을 때 신경 쓸 점 (선택)"
            placeholder="신경 쓸 점 (선택) 예: 대사를 더 부드럽게"
            value={polishNote}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setPolishNote(e.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button type="button" className="h-12 self-start px-5 text-sm font-semibold" disabled={busy || !text.trim()} onClick={askPolish}>
            {polishLoading ? "다듬는 중…" : "Claude에게 다듬기 요청"}
          </Button>
          {polishError && <InlineError message={polishError} />}
        </section>

        {polish && (
          <section aria-labelledby="ws-polish" className="flex flex-col gap-2.5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{canIdeas ? 3 : 2}</span>
              <h3 id="ws-polish" className="min-w-28 flex-1 text-sm font-semibold">바뀐 곳 {polish.changes.length}건</h3>
              {polish.changes.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className={touch}
                  onClick={() => setPolish({ ...polish, decisions: Object.fromEntries(polish.changes.map((_, i) => [i, "accept"])) })}
                >
                  모두 수락
                </Button>
              )}
            </div>

            {polish.changes.length === 0 && (
              <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                고칠 곳을 찾지 못했어요. 지금 글을 그대로 써도 좋아요.
              </p>
            )}

            {polish.changes.map((change, i) => {
              const decision = polish.decisions[i];
              return (
                <div key={`${change.before}-${i}`} className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-3">
                  <p className="text-sm leading-relaxed">{change.reason}</p>
                  <p className="font-serif text-sm leading-relaxed text-muted-foreground line-through">{change.before}</p>
                  <p className="rounded-md bg-primary/10 px-2.5 py-1.5 font-serif text-sm leading-relaxed">{change.after}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" className={touch} variant={decision === "accept" ? "default" : "outline"} aria-pressed={decision === "accept"} onClick={() => decide(i, "accept")}>
                      수락
                    </Button>
                    <Button type="button" className={touch} variant={decision === "reject" ? "secondary" : "outline"} aria-pressed={decision === "reject"} onClick={() => decide(i, "reject")}>
                      거절
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {decision === "accept" ? "수락함" : decision === "reject" ? "거절함 — 다음 다듬기에서 다시 제안하지 않아요" : "아직 고르지 않았어요"}
                    </span>
                  </div>
                </div>
              );
            })}

            {accepted.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border-2 border-primary px-3.5 py-3">
                <p className="text-sm font-semibold text-primary">수락한 {accepted.length}건을 적용한 모습</p>
                <p className="font-serif text-[15px] leading-loose">{preview}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="h-12 px-5 text-sm font-semibold" disabled={busy} onClick={applyAccepted}>
                    내 글에 반영
                  </Button>
                  <Button type="button" variant="outline" className="h-12 px-5 text-sm" onClick={() => setPolish(null)}>
                    반영하지 않고 다시 쓰기
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold">이 문단의 버전 기록</h3>
        {versions.map((v, i) => {
          const current = v.text === text;
          return (
            <div key={i} className={cn("flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2", current && "bg-primary/5")}>
              <span className="w-7 text-xs font-semibold text-muted-foreground">v{i + 1}</span>
              <span className="text-sm font-medium">{v.label}</span>
              <span className="min-w-32 flex-1 truncate text-sm text-muted-foreground">{v.text.trim() || "(비어 있음)"}</span>
              {current ? (
                <span className="text-xs font-semibold text-emerald-700">현재</span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className={touch}
                  aria-label={`v${i + 1}로 되돌리기`}
                  disabled={busy}
                  onClick={() => {
                    setPolish(null);
                    onTextChange(v.text);
                  }}
                >
                  되돌리기
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
