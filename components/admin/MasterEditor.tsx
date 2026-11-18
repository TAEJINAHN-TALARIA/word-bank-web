"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  approveMasterReviewAction,
  editPublishedStoryAction,
  ensurePreReviewAction,
  saveMasterReviewAction,
} from "@/lib/actions/masterReviewActions";
import {
  buildPublishedEdits,
  buildSaveEdits,
  countEditedParagraphs,
  normalizeParagraphs,
  type EditorDetail,
  type MasterChapter,
  type PreReviewItem,
} from "@/lib/masterReview";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";
import { ClaudePanel } from "@/components/admin/ClaudePanel";
import { FullReadView } from "@/components/admin/FullReadView";
import { cn } from "@/lib/utils";

type Selected = { chapterNumber: number; paragraphIndex: number };

function paragraphAt(chapters: MasterChapter[], chapterNumber: number, index: number): string | undefined {
  return chapters.find((c) => c.chapterNumber === chapterNumber)?.paragraphs[index];
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort().every((n, i) => n === [...b].sort()[i]);
}

export function MasterEditor({ detail }: { detail: EditorDetail }) {
  const isReview = detail.mode === "review";

  const [chapters, setChapters] = useState<MasterChapter[]>(detail.chapters);
  const [baseline, setBaseline] = useState<MasterChapter[]>(detail.chapters);
  const [confirmed, setConfirmed] = useState<number[]>(detail.confirmedChapters);
  const [savedConfirmed, setSavedConfirmed] = useState<number[]>(detail.confirmedChapters);
  const [view, setView] = useState<"edit" | "read">("edit");
  const [selected, setSelected] = useState<Selected>(() => {
    const first = detail.preReview?.[0];
    return first
      ? { chapterNumber: first.chapterNumber, paragraphIndex: first.paragraphIndex }
      : { chapterNumber: detail.chapters[0]?.chapterNumber ?? 1, paragraphIndex: 0 };
  });
  const [showOriginal, setShowOriginal] = useState(false);
  const [showMemos, setShowMemos] = useState(true);
  const [showEdits, setShowEdits] = useState(true);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [preReview, setPreReview] = useState<PreReviewItem[] | null>(detail.preReview);
  const [memosError, setMemosError] = useState<string | null>(null);

  // 사전 검토 메모는 처음 열 때 한 번만 만든다(서버가 세션에 캐시). 개발 모드의 effect 이중 실행에도 한 번만 요청하도록 ref로 막는다.
  const requestedPreReview = useRef(false);
  useEffect(() => {
    if (!isReview || preReview !== null || requestedPreReview.current) return;
    requestedPreReview.current = true;
    ensurePreReviewAction(detail.id).then((result) => {
      if (result.error) setMemosError(result.error);
      else setPreReview(result.items ?? []);
    });
  }, [isReview, preReview, detail.id]);
  const memosLoading = isReview && preReview === null && memosError === null;

  const isEdited = (chapterNumber: number, index: number) =>
    paragraphAt(chapters, chapterNumber, index) !== paragraphAt(detail.original, chapterNumber, index);

  const memos = useMemo(
    () => (preReview ?? []).filter((m) => paragraphAt(chapters, m.chapterNumber, m.paragraphIndex) === paragraphAt(detail.original, m.chapterNumber, m.paragraphIndex)),
    [preReview, chapters, detail.original],
  );
  const memoByKey = useMemo(() => new Map(memos.map((m) => [`${m.chapterNumber}-${m.paragraphIndex}`, m.kind])), [memos]);
  const editedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of chapters) {
      c.paragraphs.forEach((_, i) => {
        if (paragraphAt(chapters, c.chapterNumber, i) !== paragraphAt(detail.original, c.chapterNumber, i)) keys.add(`${c.chapterNumber}-${i}`);
      });
    }
    return keys;
  }, [chapters, detail.original]);

  const dirty = isReview
    ? buildSaveEdits(chapters, baseline).length > 0 || !sameNumbers(confirmed, savedConfirmed)
    : buildPublishedEdits(chapters, baseline).length > 0;

  useEffect(() => {
    if (!dirty || approved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, approved]);

  const editedCount = countEditedParagraphs(chapters, detail.original);
  const allConfirmed = chapters.length > 0 && chapters.every((c) => confirmed.includes(c.chapterNumber));
  const locked = busy !== null || approved;
  const currentChapter = chapters.find((c) => c.chapterNumber === selected.chapterNumber) ?? chapters[0];
  const originalChapter = detail.original.find((c) => c.chapterNumber === currentChapter?.chapterNumber);

  function updateChapter(chapterNumber: number, update: (c: MasterChapter) => MasterChapter) {
    setSavedAt(false);
    setChapters((prev) => prev.map((c) => (c.chapterNumber === chapterNumber ? update(c) : c)));
  }

  function updateParagraph(chapterNumber: number, index: number, text: string) {
    updateChapter(chapterNumber, (c) => ({ ...c, paragraphs: c.paragraphs.map((p, i) => (i === index ? text : p)) }));
  }

  function jump(chapterNumber: number, paragraphIndex: number) {
    setView("edit");
    setSelected({ chapterNumber, paragraphIndex });
  }

  function openChapter(chapterNumber: number) {
    if (view === "read") {
      document.getElementById(`rch-${chapterNumber}`)?.scrollIntoView({ block: "start" });
      return;
    }
    setSelected({ chapterNumber, paragraphIndex: 0 });
  }

  function toggleConfirm(chapterNumber: number) {
    setSavedAt(false);
    setConfirmed((prev) => (prev.includes(chapterNumber) ? prev.filter((n) => n !== chapterNumber) : [...prev, chapterNumber]));
  }

  async function save(): Promise<boolean> {
    setError(null);
    // 문단 안에 넣은 빈 줄은 저장 시 문단 나눔이 되므로, 저장 전에 화면 상태도 같은 모양으로 맞춘다.
    const normalized = chapters.map((c) => ({ ...c, paragraphs: normalizeParagraphs(c.paragraphs) }));
    if (isReview) {
      const result = await saveMasterReviewAction({
        sessionId: detail.id,
        edits: buildSaveEdits(normalized, baseline),
        confirmedChapters: confirmed,
      });
      if (result.error) {
        setError(result.error);
        return false;
      }
    } else {
      const edits = buildPublishedEdits(normalized, baseline);
      if (edits.length) {
        const result = await editPublishedStoryAction({ docId: detail.id, edits });
        if (result.error) {
          setError(result.error);
          return false;
        }
        setNotices(result.warnings ?? []);
      }
    }
    setChapters(normalized);
    setBaseline(normalized);
    setSavedConfirmed(confirmed);
    setSavedAt(true);
    return true;
  }

  async function handleSave() {
    setBusy("save");
    await save();
    setBusy(null);
  }

  async function handleApprove() {
    setBusy("approve");
    if (!(await save())) {
      setBusy(null);
      return;
    }
    const result = await approveMasterReviewAction(detail.id);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotices(result.warnings ?? []);
    setApproved(true);
  }

  if (!currentChapter) return <InlineError message="챕터가 없는 원고입니다" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{detail.title ?? "(제목 없음)"}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{detail.level}</Badge>
            <Badge variant="outline">{isReview ? "한국어 마스터" : "게시된 한국어 소설"}</Badge>
            {detail.executionPath && <Badge variant="outline">{detail.executionPath === "onDemand" ? "온디맨드" : "월간 배치"}</Badge>}
            <span className="text-xs text-muted-foreground">{detail.id}</span>
          </div>
        </div>
        <Link href="/admin/edit" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          목록으로
        </Link>
      </div>

      {!isReview && (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
          게시된 소설은 <strong className="text-foreground">표현을 다듬는 수정만</strong> 할 수 있어요. 줄거리와 챕터 구조는 바꾸지 마세요.
          수정한 챕터의 추천 표현 하이라이트는 글자 위치가 바뀌어 제거되고, 다른 언어 번역본은 그대로 유지됩니다.
        </p>
      )}

      {isReview && detail.gateNote && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          <strong className="font-semibold">품질 게이트에서 이 마스터가 통과하지 못해 검토로 돌아왔어요.</strong>
          <span className="mt-1 block">{detail.gateNote}</span>
        </div>
      )}

      {approved && (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-900">
          <strong className="font-semibold">승인 완료.</strong> 편집본이 마스터로 확정됐고, 이어서 일러스트 생성 → 10개 언어 현지화 → 품질 게이트가 진행됩니다.{" "}
          <Link href="/admin/edit" className="underline">목록으로 돌아가기</Link>
        </div>
      )}

      {error && <InlineError message={error} />}
      {notices.length > 0 && (
        <ul role="status" className="flex list-disc flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 py-3 pr-4 pl-8 text-sm text-amber-900">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)_21rem] lg:items-start">
        <nav aria-label="챕터 목록" className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3">
          <h2 className="px-2 pt-1 pb-2 text-sm font-semibold">
            {isReview ? `챕터 ${confirmed.length}/${chapters.length} 확인` : `챕터 ${chapters.length}개`}
          </h2>
          {chapters.map((c) => {
            const active = view === "edit" && c.chapterNumber === selected.chapterNumber;
            const memoCount = memos.filter((m) => m.chapterNumber === c.chapterNumber).length;
            const chapterEdited = c.paragraphs.some((_, i) => isEdited(c.chapterNumber, i)) || c.paragraphs.length !== (detail.original.find((o) => o.chapterNumber === c.chapterNumber)?.paragraphs.length ?? c.paragraphs.length);
            let tag: { text: string; variant: "success" | "warning" | "secondary" | "outline" } = { text: "검토 중", variant: "secondary" };
            if (!isReview) tag = chapterEdited ? { text: "수정됨", variant: "outline" } : { text: "", variant: "outline" };
            else if (confirmed.includes(c.chapterNumber)) tag = { text: "확인 완료", variant: "success" };
            else if (memoCount > 0) tag = { text: `메모 ${memoCount}`, variant: "warning" };
            return (
              <button
                key={c.chapterNumber}
                type="button"
                onClick={() => openChapter(c.chapterNumber)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm",
                  active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted",
                )}
              >
                <span className="w-5 text-xs font-semibold text-muted-foreground">{c.chapterNumber}</span>
                <span className="flex-1 leading-snug">{c.chapterTitle}</span>
                {tag.text && <Badge variant={tag.variant}>{tag.text}</Badge>}
              </button>
            );
          })}
        </nav>

        <main className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="보기 방식" className="inline-flex gap-1 rounded-lg bg-muted p-1">
              <Button type="button" size="lg" variant={view === "edit" ? "default" : "ghost"} aria-pressed={view === "edit"} onClick={() => setView("edit")}>
                문단 편집
              </Button>
              <Button type="button" size="lg" variant={view === "read" ? "default" : "ghost"} aria-pressed={view === "read"} onClick={() => setView("read")}>
                전체 읽기
              </Button>
            </div>
            <span className="flex-1" />
            {view === "edit" ? (
              <Button type="button" size="lg" variant="outline" aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
                원본과 비교
              </Button>
            ) : (
              <>
                {isReview && (
                  <Button type="button" size="lg" variant="outline" aria-pressed={showMemos} onClick={() => setShowMemos((v) => !v)}>
                    Claude 메모 표시
                  </Button>
                )}
                <Button type="button" size="lg" variant="outline" aria-pressed={showEdits} onClick={() => setShowEdits((v) => !v)}>
                  수정한 곳 표시
                </Button>
              </>
            )}
            <Button type="button" size="lg" variant="outline" disabled={locked || !dirty} onClick={handleSave}>
              {busy === "save" ? "저장 중…" : savedAt && !dirty ? (isReview ? "임시 저장됨" : "저장됨") : isReview ? "임시 저장" : "저장"}
            </Button>
          </div>

          {view === "read" ? (
            <FullReadView
              title={detail.title}
              level={detail.level}
              chapters={chapters}
              memoByKey={memoByKey}
              editedKeys={editedKeys}
              showMemos={showMemos}
              showEdits={showEdits}
              confirmed={confirmed}
              canConfirm={isReview}
              disabled={locked}
              onOpenParagraph={jump}
              onToggleConfirm={toggleConfirm}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {isReview ? (
                  <input
                    aria-label={`${currentChapter.chapterNumber}장 제목`}
                    value={currentChapter.chapterTitle}
                    disabled={locked}
                    onChange={(e) => updateChapter(currentChapter.chapterNumber, (c) => ({ ...c, chapterTitle: e.target.value }))}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-lg font-semibold outline-none hover:border-input focus-visible:border-input focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                ) : (
                  <h2 className="flex-1 text-lg font-semibold">
                    {currentChapter.chapterNumber}장 · {currentChapter.chapterTitle}
                  </h2>
                )}
                {isReview && (
                  <Button
                    type="button"
                    size="lg"
                    variant={confirmed.includes(currentChapter.chapterNumber) ? "outline" : "default"}
                    disabled={locked}
                    onClick={() => toggleConfirm(currentChapter.chapterNumber)}
                  >
                    {confirmed.includes(currentChapter.chapterNumber) ? "확인 완료 취소" : "이 장 확인 완료"}
                  </Button>
                )}
              </div>

              {currentChapter.paragraphs.map((paragraph, i) => {
                const isSelected = selected.paragraphIndex === i && selected.chapterNumber === currentChapter.chapterNumber;
                const edited = isEdited(currentChapter.chapterNumber, i);
                const memoKind = memoByKey.get(`${currentChapter.chapterNumber}-${i}`);
                const original = originalChapter?.paragraphs[i];
                return (
                  <div key={i} className={cn("flex flex-col gap-2 rounded-xl border bg-card px-4 py-3", isSelected ? "border-primary" : "border-border")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">문단 {i + 1}</span>
                      {edited && <Badge variant="outline">수정됨</Badge>}
                      {memoKind && <Badge variant="warning">Claude 메모 · {memoKind}</Badge>}
                      <span className="flex-1" />
                      {!isSelected && (
                        <Button
                          type="button"
                          size="lg"
                          variant="outline"
                          aria-label={`문단 ${i + 1} 편집하고 Claude에 묻기`}
                          onClick={() => setSelected({ chapterNumber: currentChapter.chapterNumber, paragraphIndex: i })}
                        >
                          편집 · Claude에 묻기
                        </Button>
                      )}
                    </div>
                    {isSelected ? (
                      <textarea
                        aria-label={`문단 ${i + 1} 본문 수정`}
                        value={paragraph}
                        rows={5}
                        disabled={locked}
                        onChange={(e) => updateParagraph(currentChapter.chapterNumber, i, e.target.value)}
                        className="w-full resize-y rounded-lg border-2 border-primary bg-background px-3 py-2.5 font-serif text-[17px] leading-loose outline-none disabled:opacity-60"
                      />
                    ) : (
                      <p className="font-serif text-[17px] leading-loose">{paragraph}</p>
                    )}
                    {showOriginal && edited && original !== undefined && (
                      <p className="border-t border-dashed border-border pt-2 text-sm leading-relaxed text-muted-foreground">
                        <strong className="font-semibold">원본</strong> · <span className="line-through">{original}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        <ClaudePanel
          mode={detail.mode}
          id={detail.id}
          view={view}
          chapters={chapters}
          selected={selected}
          memos={memos}
          memosLoading={memosLoading}
          memosError={memosError}
          disabled={locked}
          onApplySuggestion={(target, after) => updateParagraph(target.chapterNumber, target.paragraphIndex, after)}
          onJump={jump}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex min-w-72 flex-1 flex-col gap-1">
          <p className="text-sm font-semibold">
            {isReview ? `확인 ${confirmed.length}/${chapters.length} · ` : ""}수정 {editedCount}곳
            {isReview && ` · 남은 Claude 메모 ${memos.length}건`}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isReview
              ? "모든 챕터를 확인 완료로 표시하면 승인할 수 있어요. 승인하면 편집본이 마스터로 확정되고 일러스트 → 현지화 → 품질 게이트가 이어서 실행됩니다."
              : "저장하면 게시된 본문이 바로 바뀌고, 수정 전 내용은 기록으로 남아요."}
          </p>
        </div>
        {isReview ? (
          <Button type="button" size="lg" className="h-10 px-5 text-sm" disabled={!allConfirmed || locked} onClick={handleApprove}>
            {approved ? "승인됨" : busy === "approve" ? "승인 중…" : allConfirmed ? "편집 완료, 다음 단계 진행" : "모든 챕터 확인 후 승인할 수 있어요"}
          </Button>
        ) : (
          <Button type="button" size="lg" className="h-10 px-5 text-sm" disabled={!dirty || locked} onClick={handleSave}>
            {busy === "save" ? "저장 중…" : "게시본에 저장"}
          </Button>
        )}
      </div>
    </div>
  );
}
