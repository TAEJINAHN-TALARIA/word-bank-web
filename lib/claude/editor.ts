import "server-only";
import type { CharacterInfo, LevelGuidance, MasterChapter, PreReviewItem } from "@/lib/masterReview";
import {
  buildPreReviewTask,
  buildStoryContext,
  buildStoryReviewTask,
  buildSuggestTask,
  locateItems,
  storyReviewTitle,
  validateSuggestion,
  type StoryReviewKind,
} from "./editing";
import { preReviewSchema, storyReviewSchema, suggestionSchema } from "./schemas";
import { callStructured } from "./structured";

// 편집 화면이 서버 액션에 넘기는 소설 상태 — 본문은 화면에서 편집 중인 현재 본이다.
export type EditorContextInput = {
  title: string | null;
  level: string;
  chapters: MasterChapter[];
  characters: CharacterInfo[];
  narrativeStyle: string | null;
  levelGuidance: LevelGuidance | null;
};

export type SuggestionResult =
  | { kind: "suggestion"; reason: string; after: string }
  | { kind: "noChange"; reason: string };

export async function suggestParagraph(
  input: EditorContextInput & { chapterNumber: number; paragraphIndex: number; instruction: string },
): Promise<SuggestionResult> {
  const paragraph = input.chapters.find((c) => c.chapterNumber === input.chapterNumber)?.paragraphs[input.paragraphIndex];
  if (paragraph === undefined) throw new Error(`${input.chapterNumber}장 ${input.paragraphIndex + 1}문단을 찾을 수 없습니다`);

  const raw = await callStructured({
    schema: suggestionSchema,
    effort: "medium",
    context: buildStoryContext(input),
    task: buildSuggestTask({
      chapterNumber: input.chapterNumber,
      paragraphIndex: input.paragraphIndex,
      instruction: input.instruction,
      paragraph,
    }),
  });

  const validated = validateSuggestion(raw, paragraph);
  return validated ? { kind: "suggestion", ...validated } : { kind: "noChange", reason: raw.reason.trim() };
}

export type StoryReviewResult = {
  title: string;
  items: { chapterNumber: number; paragraphIndex: number; text: string }[];
};

export async function reviewStory(
  input: EditorContextInput & { kind: StoryReviewKind; instruction?: string },
): Promise<StoryReviewResult> {
  const raw = await callStructured({
    schema: storyReviewSchema,
    effort: "high",
    context: buildStoryContext(input),
    task: buildStoryReviewTask({ kind: input.kind, instruction: input.instruction }),
  });
  return {
    title: raw.title.trim() || storyReviewTitle(input.kind),
    items: locateItems(raw.items, input.chapters),
  };
}

export async function generatePreReview(input: EditorContextInput): Promise<PreReviewItem[]> {
  const raw = await callStructured({
    schema: preReviewSchema,
    effort: "high",
    context: buildStoryContext(input),
    task: buildPreReviewTask(),
  });
  return locateItems(raw.items, input.chapters);
}
