"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { discardPublishedDraftAction, savePublishedDraftAction } from "@/lib/actions/publishedDraftActions";
import {
  approveMasterReviewAction,
  editPublishedStoryAction,
  ensurePreReviewAction,
  saveMasterReviewAction,
} from "@/lib/actions/masterReviewActions";
import {
  applyPublishedEdits,
  buildPublishedEdits,
  buildSaveEdits,
  canApplyToLive,
  chaptersDiffer,
  countEditedParagraphs,
  editedParagraphKeys,
  findUnsavableDraftReason,
  findUnsavableReason,
  findUnsavableTitle,
  insertParagraph,
  locateMemos,
  MAX_TITLE_CHARS,
  moveParagraph,
  normalizeParagraphs,
  pairedParagraph,
  removeParagraph,
  type EditorDetail,
  type MasterChapter,
  type PreReviewItem,
  type PublishedDraft,
} from "@/lib/masterReview";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";
import { ClaudePanel } from "@/components/admin/ClaudePanel";
import { FullReadView } from "@/components/admin/FullReadView";
import { ParagraphWorkspace } from "@/components/admin/ParagraphWorkspace";
import { DownloadButton } from "@/components/admin/DownloadButton";
import { SaveStatusChip } from "@/components/admin/SaveStatusChip";
import { useAutosave } from "@/components/admin/useAutosave";
import { formatClock, type AutosaveResult } from "@/lib/autosaver";
import { downloadTextFile, printHtml } from "@/components/admin/manuscriptDownload";
import { buildManuscriptText, buildPrintHtml, manuscriptFileName } from "@/lib/manuscriptExport";
import { StructureSuggestions } from "@/components/admin/StructureSuggestions";
import { DialogueSplit } from "@/components/admin/DialogueSplit";
import { cn } from "@/lib/utils";

type Selected = { chapterNumber: number; paragraphIndex: number };

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort().every((n, i) => n === [...b].sort()[i]);
}

export function MasterEditor({ detail }: { detail: EditorDetail }) {
  const isReview = detail.mode === "review";

  // 게시본: 이어 쓰던 초안이 있고 그 사이 게시본이 바뀌지 않았으면 그 글로 시작한다(바뀌었으면 아래 staleDraft로 묻는다).
  const [start] = useState(() => {
    const draft = detail.mode === "published" && detail.draft && !detail.draft.stale ? detail.draft : null;
    return { chapters: draft ? applyPublishedEdits(detail.chapters, draft.edits) : detail.chapters, draftAt: draft ? draft.updatedAt : null };
  });
  const [chapters, setChapters] = useState<MasterChapter[]>(start.chapters);
  // baseline: 마지막으로 (초안·임시) 저장한 글. 게시본에서는 liveBaseline이 게시된 글이다.
  const [baseline, setBaseline] = useState<MasterChapter[]>(start.chapters);
  const [liveBaseline, setLiveBaseline] = useState<MasterChapter[]>(detail.chapters);
  const [liveVersion, setLiveVersion] = useState(detail.contentVersion ?? 0);
  const [draftInfo, setDraftInfo] = useState<{ updatedAt: number } | null>(start.draftAt !== null ? { updatedAt: start.draftAt } : null);
  const [staleDraft, setStaleDraft] = useState<PublishedDraft | null>(!isReview && detail.draft?.stale ? detail.draft : null);
  const [confirmed, setConfirmed] = useState<number[]>(detail.confirmedChapters);
  const [savedConfirmed, setSavedConfirmed] = useState<number[]>(detail.confirmedChapters);
  // 소설 제목은 검토 모드에서만 고친다(게시본은 표현 수정만). savedTitle은 마지막으로 저장한(다듬은) 제목이다.
  const [novelTitle, setNovelTitle] = useState(detail.title ?? "");
  const [savedTitle, setSavedTitle] = useState((detail.title ?? "").trim());
  const [view, setView] = useState<"edit" | "read">("edit");
  const [selected, setSelected] = useState<Selected>(() => {
    const first = detail.preReview?.[0];
    return first
      ? { chapterNumber: first.chapterNumber, paragraphIndex: first.paragraphIndex }
      : { chapterNumber: detail.chapters[0]?.chapterNumber ?? 1, paragraphIndex: 0 };
  });
  const [showCompare, setShowCompare] = useState(true);
  // 이전 버전으로 무엇을 보여줄지: 원본(layer4Original) 또는 화면을 열었을 때의 저장본.
  const [compareBase, setCompareBase] = useState<"original" | "opened">("original");
  const [openedChapters] = useState<MasterChapter[]>(detail.chapters);
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

  // 문단을 추가·이동하면 위치(index)가 밀리므로 메모와 "수정됨" 표시는 위치가 아니라 문단 내용으로 따라간다.
  const memos = useMemo(() => locateMemos(preReview ?? [], detail.chapters, chapters), [preReview, detail.chapters, chapters]);
  const memoByKey = useMemo(() => new Map(memos.map((m) => [`${m.chapterNumber}-${m.paragraphIndex}`, m.kind])), [memos]);
  const editedKeys = useMemo(() => editedParagraphKeys(chapters, detail.original), [chapters, detail.original]);

  const dirty = isReview
    ? buildSaveEdits(chapters, baseline).length > 0 || !sameNumbers(confirmed, savedConfirmed) || novelTitle.trim() !== savedTitle
    : buildPublishedEdits(chapters, baseline).length > 0;
  // 게시본에 반영할 수 있는 글(게시된 글과 다름). dirty는 "초안으로도 아직 저장 안 됨"이다.
  const canApply = !isReview && canApplyToLive(chapters, liveBaseline, staleDraft !== null);

  useEffect(() => {
    if (!dirty || approved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, approved]);

  const editedCount = countEditedParagraphs(chapters, detail.original);
  const allConfirmed = chapters.length > 0 && chapters.every((c) => confirmed.includes(c.chapterNumber));
  const locked = busy !== null || approved;

  // ── 자동 임시 저장 ──
  // 화면 글(chapters)은 건드리지 않고, 서버에 보낸 정규화본으로 baseline만 올린다(타이핑 중 커서·내용을 지키고,
  // 저장하는 동안 이어 쓴 글은 계속 "저장 안 됨"으로 남는다).
  async function autosaveSave(): Promise<AutosaveResult> {
    const normalized = chapters.map((c) => ({ ...c, paragraphs: normalizeParagraphs(c.paragraphs) }));
    if (!isReview) {
      if (buildPublishedEdits(normalized, baseline).length === 0) return { ok: true };
      // 게시본이 바뀐 뒤의 옛 초안이 남아 있으면 새 초안이 그것을 덮어쓰지 않게, 먼저 불러오거나 버리게 한다.
      if (staleDraft) return { skipped: "이전 초안을 먼저 불러오거나 버려 주세요" };
      const draftEdits = buildPublishedEdits(normalized, liveBaseline);
      const emptied = findUnsavableDraftReason(draftEdits);
      if (emptied) return { skipped: emptied };
      const saved = await savePublishedDraftAction({ docId: detail.id, edits: draftEdits, baseContentVersion: liveVersion });
      if (saved.error) return { error: saved.error };
      setBaseline(normalized);
      setDraftInfo(draftEdits.length ? { updatedAt: Date.now() } : null);
      return { ok: true };
    }
    const edits = buildSaveEdits(normalized, baseline);
    const titleChanged = novelTitle.trim() !== savedTitle;
    if (edits.length === 0 && sameNumbers(confirmed, savedConfirmed) && !titleChanged) return { ok: true };
    // 마스터 저장은 제목·본문이 빈 챕터와 빈 소설 제목을 거절한다. 글을 쓰다 잠깐 비는 순간은 오류가 아니라 건너뛴다.
    const reason = findUnsavableReason(edits) ?? (titleChanged ? findUnsavableTitle(novelTitle) : null);
    if (reason) return { skipped: reason };
    const result = await saveMasterReviewAction({
      sessionId: detail.id,
      edits,
      confirmedChapters: confirmed,
      ...(titleChanged && { title: novelTitle.trim() }),
    });
    if (result.error) return { error: result.error };
    setBaseline(normalized);
    setSavedConfirmed(confirmed);
    setSavedTitle(novelTitle.trim());
    return { ok: true };
  }
  // 저장·반영·승인·초안 버리기 중에는 자동 저장이 끼어들지 않게, 효과·이벤트에서 읽는 최신 잠금 상태.
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  });
  const autosave = useAutosave(autosaveSave);
  const { notify: notifyAutosave, flush: flushAutosave } = autosave;

  useEffect(() => {
    if (dirty && !locked) notifyAutosave();
  }, [chapters, confirmed, novelTitle, dirty, locked, notifyAutosave]);

  // 문단을 옮기거나 화면이 가려질 때는 기다리지 않고 바로 저장한다.
  useEffect(() => {
    if (!lockedRef.current) void flushAutosave();
  }, [selected.chapterNumber, selected.paragraphIndex, flushAutosave]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && !lockedRef.current) void flushAutosave();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [flushAutosave]);

  // 열 때부터 이미 원본과 다른 저장본이 있을 때만 "이전 버전" 선택창을 보여준다.
  const hasOpenedDiff = useMemo(
    () => isReview && chaptersDiffer(detail.chapters, detail.original),
    [isReview, detail.chapters, detail.original],
  );
  const currentChapter = chapters.find((c) => c.chapterNumber === selected.chapterNumber) ?? chapters[0];
  // 문단을 지운 뒤 등으로 선택 위치가 범위를 벗어나면 마지막 문단으로 맞춘다.
  const paragraphIndex = currentChapter ? Math.min(selected.paragraphIndex, currentChapter.paragraphs.length - 1) : 0;
  const currentText = currentChapter?.paragraphs[paragraphIndex] ?? "";
  // 문단 수가 같을 때만 같은 위치의 이전 버전 문단을 비교 대상으로 보여준다(구조가 바뀌면 짝이 맞지 않는다).
  const compareText = currentChapter
    ? pairedParagraph(compareBase === "opened" ? openedChapters : detail.original, currentChapter.chapterNumber, paragraphIndex, currentChapter.paragraphs.length)
    : undefined;

  function updateChapter(chapterNumber: number, update: (c: MasterChapter) => MasterChapter) {
    setSavedAt(false);
    setChapters((prev) => prev.map((c) => (c.chapterNumber === chapterNumber ? update(c) : c)));
  }

  function updateParagraph(chapterNumber: number, index: number, text: string) {
    updateChapter(chapterNumber, (c) => ({ ...c, paragraphs: c.paragraphs.map((p, i) => (i === index ? text : p)) }));
  }

  // 문단 구성 제안·대사 나누기가 같은 방식으로 현재 장의 문단을 통째로 바꾼다.
  function applyParagraphs(paragraphs: string[]) {
    if (!currentChapter) return;
    updateChapter(currentChapter.chapterNumber, (c) => ({ ...c, paragraphs }));
    setSelected({ chapterNumber: currentChapter.chapterNumber, paragraphIndex: 0 });
  }

  function insertAt(chapterNumber: number, at: number) {
    setSavedAt(false);
    setChapters((prev) => insertParagraph(prev, chapterNumber, at));
    setSelected({ chapterNumber, paragraphIndex: at });
  }

  function removeAt(chapterNumber: number, index: number) {
    setSavedAt(false);
    setChapters((prev) => removeParagraph(prev, chapterNumber, index));
    setSelected({ chapterNumber, paragraphIndex: Math.max(0, index - 1) });
  }

  function moveBy(chapterNumber: number, index: number, delta: -1 | 1) {
    setSavedAt(false);
    setChapters((prev) => moveParagraph(prev, chapterNumber, index, index + delta));
    setSelected({ chapterNumber, paragraphIndex: index + delta });
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
      const titleChanged = novelTitle.trim() !== savedTitle;
      const result = await saveMasterReviewAction({
        sessionId: detail.id,
        edits: buildSaveEdits(normalized, baseline),
        confirmedChapters: confirmed,
        ...(titleChanged && { title: novelTitle.trim() }),
      });
      if (result.error) {
        setError(result.error);
        return false;
      }
      setSavedTitle(novelTitle.trim());
    } else {
      // 게시본의 임시 저장은 초안 저장이다. 게시된 글은 handleApply(게시본에 반영)만 바꾼다.
      if (staleDraft) {
        setError("이전 초안을 먼저 불러오거나 버려 주세요");
        return false;
      }
      const draftEdits = buildPublishedEdits(normalized, liveBaseline);
      const emptied = findUnsavableDraftReason(draftEdits);
      if (emptied) {
        setError(emptied);
        return false;
      }
      const result = await savePublishedDraftAction({ docId: detail.id, edits: draftEdits, baseContentVersion: liveVersion });
      if (result.error) {
        setError(result.error);
        return false;
      }
      setDraftInfo(draftEdits.length ? { updatedAt: Date.now() } : null);
    }
    setChapters(normalized);
    setBaseline(normalized);
    setSavedConfirmed(confirmed);
    setSavedAt(true);
    return true;
  }

  async function handleSave() {
    setBusy("save");
    await flushAutosave();
    await save();
    setBusy(null);
  }

  // 게시본에 반영: 지금 화면의 글을 게시된 글과 비교해 게시본을 바꾼다(규칙 검사·수정 기록은 서버가 한다).
  async function handleApply() {
    setBusy("save");
    await flushAutosave();
    setError(null);
    const normalized = chapters.map((c) => ({ ...c, paragraphs: normalizeParagraphs(c.paragraphs) }));
    const edits = buildPublishedEdits(normalized, liveBaseline);
    if (edits.length) {
      const result = await editPublishedStoryAction({ docId: detail.id, edits });
      if (result.error) {
        setError(result.error);
        setBusy(null);
        return;
      }
      setNotices(result.warnings ?? []);
      setLiveVersion(result.contentVersion ?? liveVersion + 1);
    }
    setChapters(normalized);
    setBaseline(normalized);
    setLiveBaseline(normalized);
    setDraftInfo(null);
    setStaleDraft(null);
    setSavedAt(true);
    setBusy(null);
  }

  async function handleDiscardDraft() {
    if (!window.confirm("초안을 버리고 게시된 내용으로 되돌릴까요?")) return;
    // 지우는 동안 입력과 자동 저장을 막아, 쓰던 글이 덮이거나 지운 초안이 다시 만들어지지 않게 한다.
    setBusy("save");
    await flushAutosave();
    const result = await discardPublishedDraftAction(detail.id);
    if (result.error) {
      setError(result.error);
      setBusy(null);
      return;
    }
    setError(null);
    setChapters(liveBaseline);
    setBaseline(liveBaseline);
    setDraftInfo(null);
    setBusy(null);
  }

  // 게시본이 바뀐 뒤의 옛 초안: 불러오면 그 장의 문단이 초안 내용으로 바뀐다. baseline은 그대로라 곧 새 버전 기준으로 자동 저장된다.
  function handleLoadStaleDraft() {
    if (!staleDraft) return;
    setSavedAt(false);
    setChapters((prev) => applyPublishedEdits(prev, staleDraft.edits));
    setStaleDraft(null);
  }

  async function handleDiscardStaleDraft() {
    const result = await discardPublishedDraftAction(detail.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStaleDraft(null);
  }

  async function handleApprove() {
    setBusy("approve");
    await flushAutosave();
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

  // 검토 모드는 편집 중인 소설 제목(비어 있으면 제목 없음), 게시본은 게시된 제목을 쓴다.
  const shownTitle = isReview ? novelTitle.trim() || null : detail.title;

  // 저장 여부와 상관없이 지금 화면의 원고(chapters)를 내려받는다.
  function handleDownload(format: "txt" | "pdf") {
    const fileName = manuscriptFileName(shownTitle, detail.id, format);
    if (format === "txt") {
      downloadTextFile(fileName, buildManuscriptText({ title: shownTitle, chapters }));
    } else {
      printHtml(buildPrintHtml({ title: shownTitle, level: detail.level, chapters }), fileName.replace(/\.pdf$/, ""));
    }
  }

  if (!currentChapter) return <InlineError message="챕터가 없는 원고입니다" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          {isReview ? (
            <input
              aria-label="소설 제목"
              placeholder="(제목 없음)"
              value={novelTitle}
              maxLength={MAX_TITLE_CHARS}
              disabled={locked}
              onChange={(e) => {
                setSavedAt(false);
                setNovelTitle(e.target.value);
              }}
              className="h-10 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-xl font-semibold tracking-tight outline-none hover:border-input focus-visible:border-input focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-w-96"
            />
          ) : (
            <h1 className="text-xl font-semibold tracking-tight">{detail.title ?? "(제목 없음)"}</h1>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{detail.level}</Badge>
            <Badge variant="outline">{isReview ? "한국어 마스터" : "게시된 한국어 소설"}</Badge>
            {detail.executionPath && <Badge variant="outline">{detail.executionPath === "onDemand" ? "온디맨드" : "월간 배치"}</Badge>}
            <span className="text-xs text-muted-foreground">{detail.id}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isReview && (
            <Link href={`/admin/generation/${detail.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              생성 상세
            </Link>
          )}
          <Link href={isReview ? "/admin/edit" : "/admin/published"} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            목록으로
          </Link>
        </div>
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

      {!isReview && draftInfo && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span className="min-w-48 flex-1 leading-relaxed">
            <strong className="font-semibold">초안으로 저장됨{draftInfo.updatedAt ? ` · ${formatClock(draftInfo.updatedAt)}` : ""}</strong>
            <span className="ml-2">아직 게시본에는 반영되지 않았어요</span>
          </span>
          <Button type="button" size="lg" variant="outline" disabled={locked} onClick={handleDiscardDraft}>
            초안 버리기
          </Button>
        </div>
      )}
      {!isReview && staleDraft && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="min-w-48 flex-1 leading-relaxed">
            <strong className="font-semibold">초안을 만든 뒤 게시본이 바뀌었어요.</strong>
            <span className="ml-2">불러오면 초안에 든 장의 문단이 초안 내용으로 바뀝니다.</span>
          </span>
          <Button type="button" size="lg" variant="outline" disabled={locked} onClick={handleLoadStaleDraft}>
            불러오기
          </Button>
          <Button type="button" size="lg" variant="outline" disabled={locked} onClick={handleDiscardStaleDraft}>
            초안 버리기
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)_21rem] lg:items-start">
        <nav aria-label="챕터 목록" className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-3">
          <h2 className="px-2 pt-1 pb-2 text-sm font-semibold">
            {isReview ? `챕터 ${confirmed.length}/${chapters.length} 확인` : `챕터 ${chapters.length}개`}
          </h2>
          {/* 좁은 화면에서는 옆으로 미는 한 줄로 두어 편집 영역이 아래로 밀리지 않게 한다 */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {chapters.map((c) => {
            const active = view === "edit" && c.chapterNumber === selected.chapterNumber;
            const memoCount = memos.filter((m) => m.chapterNumber === c.chapterNumber).length;
            const chapterEdited =
              [...editedKeys].some((k) => k.startsWith(`${c.chapterNumber}-`)) ||
              c.paragraphs.length !== (detail.original.find((o) => o.chapterNumber === c.chapterNumber)?.paragraphs.length ?? c.paragraphs.length);
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
                  "flex min-h-11 w-52 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm lg:w-auto lg:shrink",
                  active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted",
                )}
              >
                <span className="w-5 text-xs font-semibold text-muted-foreground">{c.chapterNumber}</span>
                <span className="flex-1 leading-snug">{c.chapterTitle}</span>
                {tag.text && <Badge variant={tag.variant}>{tag.text}</Badge>}
              </button>
            );
          })}
          </div>
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
              <>
                {hasOpenedDiff && showCompare && (
                  <select
                    aria-label="이전 버전 선택"
                    value={compareBase}
                    onChange={(e) => setCompareBase(e.target.value as "original" | "opened")}
                    className="h-10 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    <option value="original">원본</option>
                    <option value="opened">열었을 때</option>
                  </select>
                )}
                <Button type="button" size="lg" variant="outline" aria-pressed={showCompare} onClick={() => setShowCompare((v) => !v)}>
                  나란히 보기
                </Button>
              </>
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
            <SaveStatusChip status={autosave.status} onRetry={() => void flushAutosave()} />
            <DownloadButton onSelect={handleDownload} />
            <Button type="button" size="lg" variant="outline" disabled={locked || !dirty} onClick={handleSave}>
              {busy === "save" ? "저장 중…" : savedAt && !dirty ? "임시 저장됨" : "임시 저장"}
            </Button>
          </div>

          {view === "read" ? (
            <FullReadView
              title={shownTitle}
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

              <div role="group" aria-label="문단 선택" className="flex gap-2 overflow-x-auto pb-1.5">
                {currentChapter.paragraphs.map((paragraph, i) => {
                  const on = i === paragraphIndex;
                  const memoKind = memoByKey.get(`${currentChapter.chapterNumber}-${i}`);
                  const edited = editedKeys.has(`${currentChapter.chapterNumber}-${i}`);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      aria-label={`문단 ${i + 1} 선택`}
                      onClick={() => setSelected({ chapterNumber: currentChapter.chapterNumber, paragraphIndex: i })}
                      className={cn(
                        "flex min-h-14 w-44 shrink-0 flex-col gap-0.5 rounded-xl border-2 px-3 py-2 text-left",
                        on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-1 text-xs font-semibold text-muted-foreground">
                        문단 {i + 1}
                        {edited && <Badge variant="outline">수정됨</Badge>}
                        {memoKind && <Badge variant="warning">메모</Badge>}
                      </span>
                      <span className="w-full truncate text-[13px] leading-snug">{paragraph.trim() || "(새 문단)"}</span>
                    </button>
                  );
                })}
                {isReview && (
                  <button
                    type="button"
                    aria-label="맨 뒤에 새 문단 추가"
                    disabled={locked}
                    onClick={() => insertAt(currentChapter.chapterNumber, currentChapter.paragraphs.length)}
                    className="min-h-14 shrink-0 rounded-xl border-2 border-dashed border-border px-3.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    + 문단 추가
                  </button>
                )}
              </div>

              {isReview && (
                <StructureSuggestions
                  key={currentChapter.chapterNumber}
                  mode={detail.mode}
                  id={detail.id}
                  chapters={chapters}
                  chapterNumber={currentChapter.chapterNumber}
                  disabled={locked}
                  onApply={applyParagraphs}
                />
              )}

              {isReview && (
                <DialogueSplit
                  key={`dialogue-${currentChapter.chapterNumber}`}
                  paragraphs={currentChapter.paragraphs}
                  disabled={locked}
                  onApply={applyParagraphs}
                />
              )}

              <ParagraphWorkspace
                key={`${currentChapter.chapterNumber}-${paragraphIndex}`}
                mode={detail.mode}
                id={detail.id}
                chapters={chapters}
                chapterNumber={currentChapter.chapterNumber}
                paragraphIndex={paragraphIndex}
                paragraphCount={currentChapter.paragraphs.length}
                text={currentText}
                compareText={compareText}
                compareLabel={compareBase === "opened" ? "열었을 때" : "원본"}
                showCompare={showCompare}
                disabled={locked}
                onTextChange={(text) => updateParagraph(currentChapter.chapterNumber, paragraphIndex, text)}
                onInsert={(where) => insertAt(currentChapter.chapterNumber, paragraphIndex + (where === "below" ? 1 : 0))}
                onRemove={() => removeAt(currentChapter.chapterNumber, paragraphIndex)}
                onMove={(delta) => moveBy(currentChapter.chapterNumber, paragraphIndex, delta)}
              />
            </div>
          )}
        </main>

        <ClaudePanel
          mode={detail.mode}
          id={detail.id}
          view={view}
          focus={view === "edit" ? { chapterNumber: currentChapter.chapterNumber, paragraphIndex } : null}
          novelTitle={isReview ? novelTitle : undefined}
          chapters={chapters}
          currentText={currentText}
          level={detail.level}
          levelGuidance={detail.levelGuidance}
          characters={detail.characters}
          narrativeStyle={detail.narrativeStyle}
          memos={memos}
          memosLoading={memosLoading}
          memosError={memosError}
          disabled={locked}
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
              : "게시본에 반영을 누르기 전까지는 초안으로만 남고 게시된 글은 바뀌지 않아요. 반영하면 바로 공개되고 수정 전 내용은 기록으로 남아요."}
          </p>
        </div>
        {isReview ? (
          <Button type="button" size="lg" className="h-10 px-5 text-sm" disabled={!allConfirmed || locked} onClick={handleApprove}>
            {approved ? "승인됨" : busy === "approve" ? "승인 중…" : allConfirmed ? "편집 완료, 다음 단계 진행" : "모든 챕터 확인 후 승인할 수 있어요"}
          </Button>
        ) : (
          <Button type="button" size="lg" className="h-10 px-5 text-sm" disabled={!canApply || locked} onClick={handleApply}>
            {busy === "save" ? "반영 중…" : "게시본에 반영"}
          </Button>
        )}
      </div>
    </div>
  );
}
