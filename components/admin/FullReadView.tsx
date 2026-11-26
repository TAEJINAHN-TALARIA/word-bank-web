"use client";

import type { MasterChapter } from "@/lib/masterReview";
import { Button } from "@/components/ui/button";

// 원고를 처음부터 끝까지 이어서 읽는 화면. 문단을 누르면 그 문단의 편집 화면으로 이동한다.
export function FullReadView({
  title,
  level,
  chapters,
  memoByKey,
  editedKeys,
  showMemos,
  showEdits,
  confirmed,
  canConfirm,
  disabled,
  onOpenParagraph,
  onToggleConfirm,
}: {
  title: string | null;
  level: string;
  chapters: MasterChapter[];
  memoByKey: Map<string, string>;
  editedKeys: Set<string>;
  showMemos: boolean;
  showEdits: boolean;
  confirmed: number[];
  canConfirm: boolean;
  disabled: boolean;
  onOpenParagraph: (chapterNumber: number, paragraphIndex: number) => void;
  onToggleConfirm: (chapterNumber: number) => void;
}) {
  return (
    <div
      role="region"
      aria-label="소설 전체 읽기"
      tabIndex={0}
      className="max-h-[78vh] overflow-y-auto rounded-xl border border-border bg-card px-6 py-10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-10"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <header className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs font-medium tracking-widest text-muted-foreground">{level} · 한국어</p>
          <h2 className="font-serif text-3xl font-semibold">{title ?? "(제목 없음)"}</h2>
        </header>

        {chapters.map((chapter) => (
          <section key={chapter.chapterNumber} id={`rch-${chapter.chapterNumber}`} className="flex flex-col gap-3">
            <h3 className="font-serif text-xl font-semibold">
              {chapter.chapterNumber}장 · {chapter.chapterTitle}
            </h3>
            {chapter.paragraphs.map((paragraph, i) => {
              const key = `${chapter.chapterNumber}-${i}`;
              const memo = showMemos ? memoByKey.get(key) : undefined;
              const edited = showEdits && editedKeys.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${chapter.chapterNumber}장 ${i + 1}문단 편집으로 이동`}
                  onClick={() => onOpenParagraph(chapter.chapterNumber, i)}
                  className={`block w-full rounded-md px-2.5 py-1.5 text-left ${memo ? "bg-amber-50" : edited ? "bg-primary/10" : "bg-transparent"}`}
                >
                  <span className="block font-serif text-lg leading-loose">{paragraph}</span>
                  {memo && <span className="mt-1 inline-block text-xs font-medium text-amber-800">AI 메모 · {memo}</span>}
                </button>
              );
            })}
            {canConfirm && (
              <Button
                type="button"
                size="lg"
                variant={confirmed.includes(chapter.chapterNumber) ? "outline" : "default"}
                className="self-start"
                disabled={disabled}
                onClick={() => onToggleConfirm(chapter.chapterNumber)}
              >
                {confirmed.includes(chapter.chapterNumber)
                  ? `${chapter.chapterNumber}장 확인 완료 취소`
                  : `${chapter.chapterNumber}장 확인 완료`}
              </Button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
