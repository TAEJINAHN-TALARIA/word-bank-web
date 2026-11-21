"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";
import type { ChatTurn } from "@/components/admin/useEditorChat";
import { stripFocus, type ChatFocus } from "@/lib/chatProtocol";
import { cn } from "@/lib/utils";

// 오른쪽 패널의 "대화" 탭. Claude는 원고 전체와 지금 보는 곳을 알고 있고, 고칠 곳을 제안만 한다(본문은 바꾸지 않는다).
// 대화·입력 중인 글은 부모(ClaudePanel)가 들고 있어서 탭을 오가도 유지된다.
export function EditorChat({
  turns,
  sending,
  disabled,
  focus,
  draft,
  onDraftChange,
  onSend,
  onStop,
}: {
  turns: ChatTurn[];
  sending: boolean;
  disabled: boolean;
  focus: ChatFocus;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
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

  return (
    <section aria-label="Claude와 대화" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs leading-snug text-muted-foreground">
        {focus
          ? `지금 보는 곳: ${focus.chapterNumber}장 ${focus.paragraphIndex + 1}문단 · 전체 원고도 함께 읽고 있어요`
          : "전체 원고를 읽고 있어요"}
      </p>

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
