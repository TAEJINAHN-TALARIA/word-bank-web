"use client";

import { useState } from "react";
import { suggestParagraphAction, reviewStoryAction } from "@/lib/actions/masterReviewActions";
import type { StoryReviewKind } from "@/lib/claude/editing";
import type { MasterChapter, PreReviewItem } from "@/lib/masterReview";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";

const EDIT_CHIPS = [
  { label: "더 자연스럽게", instruction: "더 자연스러운 한국어가 되도록 다듬어 주세요" },
  { label: "레벨에 맞게 쉽게", instruction: "독자 수준에 맞게 어휘와 문장을 더 쉽게 다듬어 주세요" },
  { label: "문장 짧게", instruction: "긴 문장을 더 짧게 나눠 주세요" },
  { label: "말투 통일", instruction: "서술 문체와 인물 말투가 설정과 일치하도록 통일해 주세요" },
];

const READ_CHIPS: { label: string; kind: StoryReviewKind }[] = [
  { label: "전체 흐름 점검", kind: "flow" },
  { label: "복선 회수 확인", kind: "seeds" },
  { label: "말투 일관성 점검", kind: "voice" },
];

type Selected = { chapterNumber: number; paragraphIndex: number };

type Response =
  | { scope: string; type: "suggestion"; label: string; reason: string; before: string; after: string; target: Selected }
  | { scope: string; type: "noChange"; label: string; reason: string }
  | { scope: string; type: "review"; label: string; title: string; items: { chapterNumber: number; paragraphIndex: number; text: string }[] }
  | { scope: string; type: "error"; label: string; message: string };

export function ClaudePanel({
  mode,
  id,
  view,
  chapters,
  selected,
  memos,
  memosLoading,
  memosError,
  disabled,
  onApplySuggestion,
  onJump,
}: {
  mode: "review" | "published";
  id: string;
  view: "edit" | "read";
  chapters: MasterChapter[];
  selected: Selected;
  memos: PreReviewItem[];
  memosLoading: boolean;
  memosError: string | null;
  disabled: boolean;
  onApplySuggestion: (target: Selected, after: string) => void;
  onJump: (chapterNumber: number, paragraphIndex: number) => void;
}) {
  const [response, setResponse] = useState<Response | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // 응답은 요청한 문단(또는 전체 읽기)에 속한다 — 선택이 바뀌면 화면에서 감춘다.
  const scope = view === "read" ? "read" : `${selected.chapterNumber}-${selected.paragraphIndex}`;
  const visible = response && response.scope === scope ? response : null;
  const selectedText = chapters.find((c) => c.chapterNumber === selected.chapterNumber)?.paragraphs[selected.paragraphIndex] ?? "";

  async function runSuggest(label: string, instruction: string) {
    setPendingLabel(label);
    setResponse(null);
    const result = await suggestParagraphAction({
      mode,
      id,
      chapters,
      chapterNumber: selected.chapterNumber,
      paragraphIndex: selected.paragraphIndex,
      instruction,
    });
    setPendingLabel(null);
    if ("error" in result && result.error) {
      setResponse({ scope, type: "error", label, message: result.error });
    } else if ("kind" in result && result.kind === "suggestion") {
      setResponse({ scope, type: "suggestion", label, reason: result.reason, before: selectedText, after: result.after, target: selected });
    } else if ("kind" in result) {
      setResponse({ scope, type: "noChange", label, reason: result.reason });
    }
  }

  async function runReview(label: string, kind: StoryReviewKind, instruction?: string) {
    setPendingLabel(label);
    setResponse(null);
    const result = await reviewStoryAction({ mode, id, chapters, kind, instruction });
    setPendingLabel(null);
    if (result.error || !result.result) {
      setResponse({ scope, type: "error", label, message: result.error ?? "점검 결과가 없습니다" });
    } else {
      setResponse({ scope, type: "review", label, title: result.result.title, items: result.result.items });
    }
  }

  function sendDraft() {
    const text = draft.trim();
    if (!text || pendingLabel) return;
    setDraft("");
    if (view === "read") void runReview(text, "custom", text);
    else void runSuggest(text, text);
  }

  const busy = pendingLabel !== null || disabled;

  return (
    <aside aria-label="Claude 편집 패널" className="flex flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
          C
        </span>
        <h2 className="text-sm font-semibold">Claude와 편집</h2>
      </div>

      {mode === "review" && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold text-muted-foreground">
            사전 검토 메모 · 남은 {memos.length}건
          </h3>
          {memosLoading && <p className="text-sm text-muted-foreground">Claude가 먼저 읽고 있어요…</p>}
          {memosError && <InlineError message={memosError} />}
          {!memosLoading && !memosError && memos.length === 0 && (
            <p className="text-sm text-muted-foreground">남은 메모가 없어요.</p>
          )}
          {memos.map((m) => (
            <button
              key={`${m.chapterNumber}-${m.paragraphIndex}-${m.kind}`}
              type="button"
              onClick={() => onJump(m.chapterNumber, m.paragraphIndex)}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm leading-snug text-amber-900 hover:bg-amber-100"
            >
              <strong className="font-semibold">
                {m.chapterNumber}장 {m.paragraphIndex + 1}문단 · {m.kind}
              </strong>
              <span className="block">{m.text}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 px-4 py-3">
        {view === "edit" && (
          <p className="text-sm text-muted-foreground">
            선택한 문단: <strong className="text-foreground">{selected.chapterNumber}장 {selected.paragraphIndex + 1}문단</strong>
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {view === "edit"
            ? EDIT_CHIPS.map((chip) => (
                <Button key={chip.label} type="button" variant="outline" size="sm" disabled={busy} onClick={() => runSuggest(chip.label, chip.instruction)}>
                  {chip.label}
                </Button>
              ))
            : READ_CHIPS.map((chip) => (
                <Button key={chip.label} type="button" variant="outline" size="sm" disabled={busy} onClick={() => runReview(chip.label, chip.kind)}>
                  {chip.label}
                </Button>
              ))}
        </div>

        {pendingLabel && (
          <p role="status" className="text-sm text-muted-foreground">
            “{pendingLabel}” 요청 중… 전체 점검은 1분 가까이 걸릴 수 있어요.
          </p>
        )}

        {!visible && !pendingLabel && (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
            {view === "edit"
              ? "문단을 선택하고 요청을 보내면 제안이 여기에 표시돼요. "
              : "원고 전체를 대상으로 점검을 요청할 수 있어요. 결과는 본문을 바꾸지 않고, 항목을 누르면 해당 문단의 편집 화면으로 이동합니다. "}
            {view === "edit" && <strong className="text-foreground">적용을 누르기 전에는 본문이 바뀌지 않습니다.</strong>}
          </p>
        )}

        {visible?.type === "error" && <InlineError message={visible.message} />}

        {visible?.type === "noChange" && (
          <div className="rounded-lg border border-border px-3 py-2.5 text-sm leading-relaxed">
            <p>이 문단에서는 고칠 곳을 찾지 못했어요. {visible.reason}</p>
            <p className="mt-1 text-muted-foreground">어떤 느낌으로 바꾸고 싶은지 구체적으로 적어 주세요.</p>
          </div>
        )}

        {visible?.type === "suggestion" && (
          <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
            <p className="text-sm leading-relaxed">{visible.reason}</p>
            <p className="text-xs font-semibold text-muted-foreground">현재</p>
            <p className="font-serif text-sm leading-relaxed text-muted-foreground line-through">{visible.before}</p>
            <p className="text-xs font-semibold text-primary">제안</p>
            <p className="rounded-md bg-primary/10 px-2.5 py-2 font-serif text-sm leading-relaxed">{visible.after}</p>
            {selectedText !== visible.before && (
              <p className="text-xs text-destructive">문단이 바뀌어서 이 제안은 적용할 수 없어요. 다시 요청해 주세요.</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled || selectedText !== visible.before}
                onClick={() => {
                  onApplySuggestion(visible.target, visible.after);
                  setResponse(null);
                }}
              >
                적용
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setResponse(null)}>
                닫기
              </Button>
            </div>
          </div>
        )}

        {visible?.type === "review" && (
          <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
            <p className="text-sm font-semibold">{visible.title}</p>
            {visible.items.length === 0 && <p className="text-sm text-muted-foreground">짚을 만한 항목이 없어요.</p>}
            {visible.items.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onJump(item.chapterNumber, item.paragraphIndex)}
                className="rounded-lg border border-border px-3 py-2 text-left text-sm leading-snug hover:bg-muted"
              >
                <strong className="font-semibold">
                  {item.chapterNumber}장 {item.paragraphIndex + 1}문단
                </strong>{" "}
                · {item.text}
              </button>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setResponse(null)}>
              닫기
            </Button>
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendDraft();
          }}
        >
          <input
            aria-label="Claude에게 보낼 지시"
            placeholder={view === "edit" ? "예: 대사를 더 부드럽게" : "예: 결말이 급한지 봐줘"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button type="submit" size="lg" disabled={busy || !draft.trim()}>
            보내기
          </Button>
        </form>
      </div>
    </aside>
  );
}
