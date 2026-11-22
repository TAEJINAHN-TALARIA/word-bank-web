"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";
import type { ChatTurn } from "@/components/admin/useEditorChat";
import { stripFocus, type ChatFocus, type ChatScope } from "@/lib/chatProtocol";
import { cn } from "@/lib/utils";

// 대화에서 가리킬 대상. 문단은 지금 보는 문단, 제목은 소설 제목·지금 보는 장의 제목이다.
export type ChatTarget = "paragraph" | "chapterTitle" | "novelTitle";

const TARGETS: { value: ChatTarget; label: string }[] = [
  { value: "paragraph", label: "문단" },
  { value: "chapterTitle", label: "이 장 제목" },
  { value: "novelTitle", label: "소설 제목" },
];

// 읽는 범위. 문단을 보고 있을 때만 고를 수 있다(제목 대상·전체 읽기 화면은 항상 전체 원고).
const SCOPES: { value: ChatScope; label: string }[] = [
  { value: "paragraph", label: "이 문단 중심" },
  { value: "full", label: "전체 원고" },
];

function focusSummary(focus: ChatFocus, scope: ChatScope): string {
  if (!focus) return "전체 원고를 읽고 있어요";
  if ("novelTitle" in focus) return "소설 제목을 두고 이야기해요 · 전체 원고도 함께 읽고 있어요";
  if ("chapterTitle" in focus) return `${focus.chapterNumber}장 제목을 두고 이야기해요 · 전체 원고도 함께 읽고 있어요`;
  const where = `지금 보는 곳: ${focus.chapterNumber}장 ${focus.paragraphIndex + 1}문단`;
  return scope === "paragraph" ? `${where} · 이 문단과 앞뒤만 읽고 있어요` : `${where} · 전체 원고도 함께 읽고 있어요`;
}

// 오른쪽 패널의 "대화" 탭. Claude는 지금 보는 곳과 읽는 범위(이 문단과 앞뒤, 또는 원고 전체)를 알고 있고, 고칠 곳을 제안만 한다(본문은 바꾸지 않는다).
// 대화·입력 중인 글은 부모(ClaudePanel)가 들고 있어서 탭을 오가도 유지된다.
export function EditorChat({
  turns,
  sending,
  disabled,
  focus,
  target,
  onTargetChange,
  showTargets,
  scope,
  onScopeChange,
  showScope,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onClear,
}: {
  turns: ChatTurn[];
  sending: boolean;
  disabled: boolean;
  focus: ChatFocus;
  target: ChatTarget;
  onTargetChange: (target: ChatTarget) => void;
  // 문단을 편집하는 검토 화면에서만 제목 대상을 고를 수 있다.
  showTargets: boolean;
  // Claude가 읽는 원고의 범위. 문단을 보고 있을 때만 고를 수 있다.
  scope: ChatScope;
  onScopeChange: (scope: ChatScope) => void;
  showScope: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  // 대화(와 Claude가 기억하는 기록)를 모두 지운다. 입력 중인 글과 대상 선택은 그대로 둔다.
  onClear: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns]);

  const busy = disabled || sending;

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    onDraftChange("");
    onSend(text);
  }

  function clear() {
    // 저장해 둔 곳이 없어 되돌릴 수 없으므로 한 번 확인한다(버튼은 대화가 있을 때만 켜진다).
    if (!window.confirm("대화를 모두 지울까요? 되돌릴 수 없어요.")) return;
    onClear();
  }

  return (
    <section aria-label="Claude와 대화" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
      {showTargets && (
        <div role="group" aria-label="대화 대상" className="flex flex-wrap gap-1.5">
          {TARGETS.map((t) => (
            <Button
              key={t.value}
              type="button"
              size="sm"
              variant={target === t.value ? "default" : "outline"}
              aria-pressed={target === t.value}
              onClick={() => onTargetChange(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      )}
      {showScope && (
        <div role="group" aria-label="읽는 범위" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">읽는 범위</span>
          {SCOPES.map((s) => (
            <Button
              key={s.value}
              type="button"
              size="sm"
              variant={scope === s.value ? "default" : "outline"}
              aria-pressed={scope === s.value}
              onClick={() => onScopeChange(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs leading-snug text-muted-foreground">{focusSummary(focus, scope)}</p>
        <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={turns.length === 0} onClick={clear}>
          대화 지우기
        </Button>
      </div>

      <div ref={listRef} role="log" aria-live="polite" className="flex max-h-[28rem] min-h-24 flex-col gap-2 overflow-y-auto">
        {turns.length === 0 && (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
            이 글에 대해 무엇이든 물어보세요. Claude는 고칠 곳을 제안만 하고, 본문은 바꾸지 않아요.
          </p>
        )}
        {turns.map((turn, i) => {
          const last = i === turns.length - 1;
          const waiting = turn.role === "assistant" && last && sending && !turn.content && !turn.error;
          return (
            <div key={i} className={cn("flex flex-col gap-1", turn.role === "user" ? "items-end" : "items-start")}>
              {(turn.content || waiting) && (
                <p
                  className={cn(
                    "max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    turn.role === "user" ? "bg-primary/10" : "bg-muted",
                  )}
                >
                  {turn.role === "user" ? stripFocus(turn.content) : turn.content || "답을 쓰는 중…"}
                </p>
              )}
              {turn.error && <InlineError message={turn.error} />}
            </div>
          );
        })}
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Claude에게 보낼 메시지"
          placeholder="예: 이 문단 긴장감이 약한가?"
          rows={3}
          maxLength={3500}
          value={draft}
          disabled={disabled}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // 한글 입력 조합 중의 Enter는 글자 확정이므로 전송하지 않는다(안 그러면 마지막 글자가 중복 전송된다).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Enter 전송 · Shift+Enter 줄바꿈</span>
          {sending ? (
            <Button type="button" variant="outline" className="h-11 px-4 text-sm" onClick={onStop}>
              멈추기
            </Button>
          ) : (
            <Button type="submit" className="h-11 px-4 text-sm" disabled={busy || !draft.trim()}>
              보내기
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
