"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { DiffSegment } from "@/lib/textDiff";
import { cn } from "@/lib/utils";

// 입력창과 뒤쪽 색 층이 한 글자라도 다르게 그려지면 색이 글자와 어긋난다 — 글꼴·여백·줄바꿈 규칙을 한 곳에서 공유한다.
const TEXT_BOX = "w-full rounded-xl border-2 px-3.5 py-3 font-serif text-base leading-loose whitespace-pre-wrap break-words";

/**
 * 입력창 뒤에 "새로 쓴 곳" 색을 까는 입력창. `highlight`는 diffWords(이전 버전, value)의 결과다.
 * 입력창 높이를 글 길이에 맞춰 늘려서 안쪽 스크롤이 없으므로, 색 층과 스크롤을 맞출 필요가 없다.
 */
export function HighlightedTextarea({
  value,
  onChange,
  highlight,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  highlight: DiffSegment[] | null;
  disabled?: boolean;
  "aria-label": string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function fit() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight에는 테두리가 빠져 있다.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }

  useLayoutEffect(fit, [value]);

  // 칸 너비가 바뀌면(창 크기, 나란히 보기 켬/끔) 줄바꿈이 달라지므로 높이를 다시 맞춘다.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="relative rounded-xl bg-background">
      {highlight && (
        <div aria-hidden className={cn(TEXT_BOX, "pointer-events-none absolute inset-0 overflow-hidden border-transparent text-transparent")}>
          {highlight
            .filter((segment) => segment.type !== "del")
            .map((segment, i) =>
              segment.type === "ins" ? (
                <mark key={i} className="rounded-sm bg-emerald-400/35 text-transparent">
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          {/* 글이 줄바꿈으로 끝나도 마지막 빈 줄의 높이를 입력창과 맞춘다 */}
          {"​"}
        </div>
      )}
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        value={value}
        rows={6}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(TEXT_BOX, "relative block min-h-[11.5rem] resize-none overflow-hidden border-primary bg-transparent outline-none disabled:opacity-60")}
      />
    </div>
  );
}
