// 문단 정리 모달의 순수 로직: 전 장에 대사 나누기를 적용한 "작업본"을 만들고, 장별 결과를 요약한다.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.
// 설계: docs/superpowers/specs/2026-11-22-editor-cleanup-modal-titles-design.md

import { splitDialogue, type DialogueSplitMode } from "@/lib/dialogueSplit";
import { applyStructureChanges, type StructureChange } from "@/lib/claude/editing";
import {
  applyChapterPolish,
  type ChapterPolishChange,
  type FactFinding,
  type FactFix,
} from "@/lib/claude/preprocessing";
import type { MasterChapter } from "@/lib/masterReview";

export type CleanupBase = {
  chapters: MasterChapter[];
  /** 따옴표 짝이 맞지 않아 건너뛴 문단이 있는 장 → 그 문단 번호(1부터). */
  skipped: Record<number, number[]>;
};

/**
 * 모든 장에 대사 나누기를 적용한 작업본. Claude의 구성 제안은 이 작업본의 문단 번호·문장을 기준으로
 * 받아야 어긋나지 않는다. dialogue가 null이면 글을 그대로(복사만) 돌려준다.
 */
export function buildCleanupBase(chapters: MasterChapter[], dialogue: DialogueSplitMode | null): CleanupBase {
  const skipped: Record<number, number[]> = {};
  const next = chapters.map((chapter) => {
    if (!dialogue) return { ...chapter, paragraphs: [...chapter.paragraphs] };
    const result = splitDialogue(chapter.paragraphs, dialogue);
    if (result.skipped.length > 0) skipped[chapter.chapterNumber] = result.skipped;
    return { ...chapter, paragraphs: result.paragraphs };
  });
  return { chapters: next, skipped };
}

export type ChapterSuggestion = { changes?: StructureChange[]; error?: string };

const SUGGESTION_FAILED = "문단 구성 제안을 받지 못했습니다";

/**
 * 한 장의 Claude 구성 제안을 받아 그 장의 결과로 정리한다. 서버 액션은 실패를 { error }로 돌려주지만, 호출 자체가
 * 던질 수 있다(네트워크 끊김, 긴 실행 중 재배포 등). 던져도 한 장의 오류로 남겨야 장 순차 반복이 멈추지 않는다.
 */
export async function fetchChapterSuggestion(
  request: () => Promise<{ error?: string; changes?: StructureChange[] }>,
): Promise<ChapterSuggestion> {
  try {
    const response = await request();
    if (response.error || !response.changes) return { error: response.error ?? SUGGESTION_FAILED };
    return { changes: response.changes };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : SUGGESTION_FAILED };
  }
}

export type ChapterOutcome = {
  chapterNumber: number;
  /** 원래(열었을 때) 문단 수 */
  before: number;
  /** 대사 나누기를 적용한 작업본의 문단 수 */
  afterSplit: number;
  /** 수락한 Claude 제안까지 적용한 최종 문단 */
  final: string[];
};

export function summarizeChapter(original: MasterChapter, base: MasterChapter, accepted: StructureChange[]): ChapterOutcome {
  return {
    chapterNumber: original.chapterNumber,
    before: original.paragraphs.length,
    afterSplit: base.paragraphs.length,
    final: applyStructureChanges(base.paragraphs, accepted),
  };
}

// ── 마스터 전처리: ④ 사실관계 점검, ③ 문장 다듬기 ──
// 한 단계의 실패가 나머지를 멈추지 않도록, 서버 액션이 { error }를 돌려주든 호출이 던지든 결과의 오류 한 줄로 남긴다.
async function settle<T extends { error?: string }>(
  request: () => Promise<{ error?: string } & Partial<T>>,
  ok: (response: Partial<T>) => T | null,
  fallback: string,
): Promise<T | { error: string }> {
  try {
    const response = await request();
    if (response.error) return { error: response.error };
    return ok(response) ?? { error: fallback };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : fallback };
  }
}

export type FactCheck = { findings?: FactFinding[]; error?: string };

/** ④⑤⑥ 점검 하나의 결과를 받는다. 던져도 { error }로 바꿔 다른 점검과 이후 단계가 멈추지 않게 한다. */
export function fetchCheck(
  request: () => Promise<{ error?: string; findings?: FactFinding[] }>,
  failedMessage: string,
): Promise<FactCheck> {
  return settle<FactCheck>(request, (r) => (r.findings ? { findings: r.findings } : null), failedMessage);
}

export function fetchFactCheck(request: () => Promise<{ error?: string; findings?: FactFinding[] }>): Promise<FactCheck> {
  return fetchCheck(request, "사실관계 점검을 받지 못했습니다");
}

export type ChapterPolish = { changes?: ChapterPolishChange[]; received?: number; error?: string };

export function fetchChapterPolish(
  request: () => Promise<{ error?: string; changes?: ChapterPolishChange[]; received?: number }>,
): Promise<ChapterPolish> {
  return settle<ChapterPolish>(
    request,
    (r) => (r.changes ? { changes: r.changes, received: r.received ?? r.changes.length } : null),
    "문장 다듬기를 받지 못했습니다",
  );
}

/**
 * 편집자가 고른 ④⑤⑥ 정정을 **주어진 순서대로** 한 건씩 적용한다. 같은 구절을 둘 이상의 점검이 고치자고 하면 앞의 것이 먼저
 * 바꾸고, 그 시점의 문단에 before가 정확히 한 번 있지 않은 뒤의 것은 건너뛴다(건너뛴 수를 돌려준다). 입력은 바꾸지 않는다.
 */
export function applyCheckFixes(chapters: MasterChapter[], fixes: FactFix[]): { chapters: MasterChapter[]; skipped: number } {
  const next = chapters.map((chapter) => ({ ...chapter, paragraphs: [...chapter.paragraphs] }));
  let skipped = 0;
  for (const fix of fixes) {
    const paragraphs = next.find((c) => c.chapterNumber === fix.chapterNumber)?.paragraphs;
    const paragraph = paragraphs?.[fix.paragraphIndex];
    const start = paragraph === undefined || !fix.before ? -1 : paragraph.indexOf(fix.before);
    if (!paragraphs || paragraph === undefined || start < 0 || paragraph.indexOf(fix.before, start + 1) >= 0) {
      skipped += 1;
      continue;
    }
    paragraphs[fix.paragraphIndex] = paragraph.slice(0, start) + fix.after + paragraph.slice(start + fix.before.length);
  }
  return { chapters: next, skipped };
}

/** ③ 문장 다듬기 결과(장 번호별)를 적용한다. 오류이거나 아직 받지 못한 장은 원문 그대로다. */
export function applyPolishes(chapters: MasterChapter[], polishes: Record<number, ChapterPolish>): MasterChapter[] {
  return chapters.map((chapter) => {
    const changes = polishes[chapter.chapterNumber]?.changes;
    return { ...chapter, paragraphs: changes ? applyChapterPolish(chapter.paragraphs, changes) : [...chapter.paragraphs] };
  });
}
