import "server-only";
import type { CharacterInfo, LevelGuidance, MasterChapter, PreReviewItem } from "@/lib/masterReview";
import {
  IDEAS_SYSTEM_PROMPT,
  POLISH_SYSTEM_PROMPT,
  STRUCTURE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildIdeasTask,
  buildPolishTask,
  buildPreReviewTask,
  buildStoryContext,
  buildStoryReviewTask,
  buildStructureTask,
  locateItems,
  storyReviewTitle,
  validateChanges,
  validateIdeas,
  validateStructureChanges,
  type Idea,
  type IdeaDirection,
  type PolishChange,
  type RejectedChange,
  type StoryReviewKind,
  type StructureChange,
} from "./editing";
import {
  CHAPTER_POLISH_SYSTEM_PROMPT,
  FACTS_SYSTEM_PROMPT,
  buildChapterPolishTask,
  buildFactsTask,
  validateChapterPolish,
  validateFactFindings,
  type ChapterPolishResult,
  type FactFinding,
} from "./preprocessing";
import { chapterPolishSchema, factsSchema, ideasSchema, polishSchema, preReviewSchema, storyReviewSchema, structureSchema } from "./schemas";
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

function paragraphOf(input: EditorContextInput, chapterNumber: number, paragraphIndex: number): string {
  const paragraph = input.chapters.find((c) => c.chapterNumber === chapterNumber)?.paragraphs[paragraphIndex];
  if (paragraph === undefined) throw new Error(`${chapterNumber}장 ${paragraphIndex + 1}문단을 찾을 수 없습니다`);
  return paragraph;
}

// ① 방향 제시 — 편집자가 직접 쓸 재료(완성 글이 아닌 스케치)를 3가지 낸다.
export async function suggestIdeas(
  input: EditorContextInput & { chapterNumber: number; paragraphIndex: number; instruction?: string },
): Promise<Idea[]> {
  const paragraph = paragraphOf(input, input.chapterNumber, input.paragraphIndex);
  const raw = await callStructured({
    schema: ideasSchema,
    effort: "medium",
    system: IDEAS_SYSTEM_PROMPT,
    context: buildStoryContext(input),
    task: buildIdeasTask({ chapterNumber: input.chapterNumber, paragraphIndex: input.paragraphIndex, paragraph, instruction: input.instruction }),
  });
  return validateIdeas(raw.ideas);
}

// ③ 다듬기 — 편집자가 쓴 문단(= 현재 본문)에서 고칠 곳만 목록으로 돌려준다. 본문은 바꾸지 않는다.
export async function polishParagraph(
  input: EditorContextInput & {
    chapterNumber: number;
    paragraphIndex: number;
    direction?: IdeaDirection | null;
    rejected?: RejectedChange[];
    instruction?: string;
  },
): Promise<PolishChange[]> {
  const draft = paragraphOf(input, input.chapterNumber, input.paragraphIndex);
  const raw = await callStructured({
    schema: polishSchema,
    effort: "medium",
    system: POLISH_SYSTEM_PROMPT,
    context: buildStoryContext(input),
    task: buildPolishTask({
      chapterNumber: input.chapterNumber,
      paragraphIndex: input.paragraphIndex,
      draft,
      direction: input.direction,
      rejected: input.rejected,
      instruction: input.instruction,
    }),
  });
  return validateChanges(raw.changes, draft);
}

// ④ 문단 구성 — 챕터 전체를 읽고 문단을 나누거나 합칠 곳 목록만 돌려준다. 본문은 바꾸지 않는다.
export async function suggestStructure(
  input: EditorContextInput & { chapterNumber: number; instruction?: string },
): Promise<StructureChange[]> {
  const chapter = input.chapters.find((c) => c.chapterNumber === input.chapterNumber);
  if (!chapter) throw new Error(`${input.chapterNumber}장을 찾을 수 없습니다`);
  const raw = await callStructured({
    schema: structureSchema,
    effort: "medium",
    system: STRUCTURE_SYSTEM_PROMPT,
    context: buildStoryContext(input),
    task: buildStructureTask({ chapterNumber: input.chapterNumber, instruction: input.instruction }),
  });
  return validateStructureChanges(raw.changes, chapter.paragraphs);
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
    system: SYSTEM_PROMPT,
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
    system: SYSTEM_PROMPT,
    context: buildStoryContext(input),
    task: buildPreReviewTask(),
  });
  return locateItems(raw.items, input.chapters);
}

// 전처리 ③ 문장 다듬기 — 챕터 전체를 읽고 담백하게 다듬을 곳 목록만 돌려준다. 본문은 바꾸지 않는다.
export async function polishChapter(
  input: EditorContextInput & { chapterNumber: number; instruction?: string },
): Promise<ChapterPolishResult> {
  const chapter = input.chapters.find((c) => c.chapterNumber === input.chapterNumber);
  if (!chapter) throw new Error(`${input.chapterNumber}장을 찾을 수 없습니다`);
  const raw = await callStructured({
    schema: chapterPolishSchema,
    effort: "medium",
    system: CHAPTER_POLISH_SYSTEM_PROMPT,
    context: buildStoryContext(input),
    task: buildChapterPolishTask({ chapterNumber: input.chapterNumber, instruction: input.instruction }),
  });
  return validateChapterPolish(raw.changes, chapter.paragraphs);
}

// 전처리 ④ 사실관계 점검 — 모순은 장을 가로질러야 보이므로 원고 전체를 한 번에 읽는다.
export async function checkFacts(input: EditorContextInput): Promise<FactFinding[]> {
  const raw = await callStructured({
    schema: factsSchema,
    effort: "high",
    system: FACTS_SYSTEM_PROMPT,
    context: buildStoryContext(input),
    task: buildFactsTask(),
  });
  return validateFactFindings(raw.findings, input.chapters);
}
