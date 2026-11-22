// 문단 정리 모달의 순수 로직: 전 장에 대사 나누기를 적용한 "작업본"을 만들고, 장별 결과를 요약한다.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.
// 설계: docs/superpowers/specs/2026-11-22-editor-cleanup-modal-titles-design.md

import { splitDialogue, type DialogueSplitMode } from "@/lib/dialogueSplit";
import { applyStructureChanges, type StructureChange } from "@/lib/claude/editing";
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
