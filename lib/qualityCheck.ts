// 편집 화면 "품질 점검"의 순수 로직. "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.
// 설계: docs/superpowers/specs/2026-11-22-master-quality-check-design.md
import { normalizeParagraphs, type MasterChapter } from "@/lib/masterReview";
import type { MasterEvaluation } from "@/lib/admin-functions/storyGenerator";

// 심사 항목 키 → 한국어 이름. characterVoiceConsistency는 판정에 넣지 않는 참고 항목이라 이름에도 밝힌다.
export const ITEM_LABELS: Record<string, string> = {
  contentSafety: "내용 안전성",
  culturalFit: "문화 적합성",
  narrativeCompleteness: "서사 완결성",
  characterConsistency: "인물 일관성",
  chapterTransition: "장 전환",
  levelFit: "레벨 적합성",
  comboFit: "설정 반영",
  technicalCleanliness: "기술적 흔적",
  narrativeStyleConsistency: "문체·시점 일관성",
  materialWeightFit: "소재 무게",
  characterVoiceConsistency: "인물 말투(참고)",
};

// 점수 구간. 게이트는 2점 이하를 탈락으로 본다.
export function scoreTone(score: number): "good" | "borderline" | "low" {
  if (score >= 4) return "good";
  if (score === 3) return "borderline";
  return "low";
}

const normalizeSpaces = (text: string) => text.replace(/\s+/g, " ").trim();

// 심사가 인용한 문제 구절이 든 첫 문단을 찾는다. 공백 차이는 무시한다(모델이 인용하며 공백을 바꿀 수 있다).
export function findPhraseLocation(
  chapters: MasterChapter[],
  phrase: string,
): { chapterNumber: number; paragraphIndex: number } | null {
  const needle = normalizeSpaces(phrase);
  if (!needle) return null;
  for (const chapter of chapters) {
    const index = chapter.paragraphs.findIndex((p) => normalizeSpaces(p).includes(needle));
    if (index >= 0) return { chapterNumber: chapter.chapterNumber, paragraphIndex: index };
  }
  return null;
}

// 점검한 뒤 글이 바뀌었는지 비교하는 열쇠. 장 번호·제목·문단이 하나라도 달라지면 달라진다.
// 점검은 저장과 같은 정규화(빈 문단 버림, 문단 안의 빈 줄은 문단 나눔)를 거친 글을 보내므로 열쇠도 정규화한 문단으로 만든다 —
// 그래야 저장이 화면 글을 정규화한 것만으로 "글이 바뀌었어요"가 뜨지 않는다.
export function chaptersKey(chapters: MasterChapter[]): string {
  return JSON.stringify(chapters.map((c) => [c.chapterNumber, c.chapterTitle, normalizeParagraphs(c.paragraphs)]));
}

// 승인 줄에 보여줄 한 줄. 승인은 막지 않는다(참고용).
export function approvalNote(evaluation: MasterEvaluation | null, stale: boolean): string {
  if (!evaluation) return "품질 점검을 아직 하지 않았어요";
  let summary: string;
  if (!evaluation.ruleBase.pass) summary = `규칙 검사 실패 ${evaluation.ruleBase.failures.length}건`;
  else if (!evaluation.llm) summary = "심사 결과 없음";
  else if ("error" in evaluation.llm) summary = "심사 실패";
  else if (evaluation.llm.pass) summary = "통과";
  else summary = `낮은 항목 ${evaluation.llm.failItems.length}개`;
  return `최근 품질 점검: ${summary}${stale ? " · 글이 바뀌었어요, 다시 점검을 권장해요" : ""}`;
}
