// 마스터 검토/게시본 편집 화면이 서버·클라이언트 양쪽에서 쓰는 타입과 순수 로직.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서도 가져올 수 있다.
// 설계: story-generator/docs/superpowers/specs/2026-11-18-master-review-gate-design.md

export type MasterChapter = {
  chapterNumber: number;
  chapterTitle: string;
  paragraphs: string[];
};

export type CharacterInfo = {
  name: string;
  speechStyle: string | null;
};

// 정지 시점에 story-generator가 세션에 저장하는 레벨 기준(readability.js) — Claude 지시에 그대로 쓴다.
export type LevelGuidance = {
  sentenceLen: number;
  unit: string;
  stageLabel: string;
};

export type PreReviewItem = {
  chapterNumber: number;
  paragraphIndex: number;
  kind: string;
  text: string;
};

// 편집 화면이 받는 상세 데이터. mode가 'review'면 편집 대기 세션, 'published'면 게시된 한국어 소설.
export type EditorDetail = {
  mode: "review" | "published";
  id: string;
  title: string | null;
  level: string;
  executionPath: string | null;
  chapters: MasterChapter[];
  // 원본과 비교 표시에 쓴다(review: layer4Original, published: 열 당시 본문).
  original: MasterChapter[];
  characters: CharacterInfo[];
  narrativeStyle: string | null;
  levelGuidance: LevelGuidance | null;
  confirmedChapters: number[];
  gateNote: string | null;
  preReview: PreReviewItem[] | null;
};

// story-generator의 bodyToParagraphs(publishService.js)와 같은 규칙이어야 저장→게시 왕복에서 본문이 어긋나지 않는다.
export function bodyToParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function paragraphsToBody(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

// 편집 중인 문단에서 저장 가능한 문단 목록을 만든다 — 문단 안의 빈 줄은 문단 나눔으로, 공백뿐인 문단은 버린다.
export function normalizeParagraphs(paragraphs: string[]): string[] {
  return paragraphs.flatMap((p) => bodyToParagraphs(p));
}

const normalize = normalizeParagraphs;

function sameParagraphs(a: string[], b: string[]): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na.length === nb.length && na.every((p, i) => p === nb[i]);
}

export function isChapterEdited(current: MasterChapter, baseline: MasterChapter): boolean {
  return current.chapterTitle !== baseline.chapterTitle || !sameParagraphs(current.paragraphs, baseline.paragraphs);
}

// 수정한 문단 수(화면의 "수정 n곳"). 문단 수가 달라진 챕터는 문단을 1:1로 짝지을 수 없어서 챕터당 1곳으로 센다.
export function countEditedParagraphs(current: MasterChapter[], baseline: MasterChapter[]): number {
  let count = 0;
  for (const chapter of current) {
    const base = baseline.find((b) => b.chapterNumber === chapter.chapterNumber);
    if (!base) continue;
    const cur = normalize(chapter.paragraphs);
    const old = normalize(base.paragraphs);
    if (cur.length !== old.length) {
      if (!sameParagraphs(cur, old)) count += 1;
      continue;
    }
    count += cur.filter((p, i) => p !== old[i]).length;
  }
  return count;
}

// 마스터 검토 저장 API(adminSaveMasterReview)에 보낼 형태 — 저장된 기준과 달라진 챕터만, body로 합쳐서.
export function buildSaveEdits(
  current: MasterChapter[],
  baseline: MasterChapter[],
): { chapterNumber: number; chapterTitle: string; body: string }[] {
  const edits: { chapterNumber: number; chapterTitle: string; body: string }[] = [];
  for (const chapter of current) {
    const base = baseline.find((b) => b.chapterNumber === chapter.chapterNumber);
    if (base && !isChapterEdited(chapter, base)) continue;
    edits.push({
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.chapterTitle,
      body: paragraphsToBody(normalize(chapter.paragraphs)),
    });
  }
  return edits;
}

// 게시본 저장 API(adminEditPublishedStory)에 보낼 형태 — 달라진 챕터의 문단만. 게시본은 제목을 고치지 않는다.
export function buildPublishedEdits(
  current: MasterChapter[],
  baseline: MasterChapter[],
): { num: number; paragraphs: string[] }[] {
  const edits: { num: number; paragraphs: string[] }[] = [];
  for (const chapter of current) {
    const base = baseline.find((b) => b.chapterNumber === chapter.chapterNumber);
    if (base && sameParagraphs(chapter.paragraphs, base.paragraphs)) continue;
    edits.push({ num: chapter.chapterNumber, paragraphs: normalize(chapter.paragraphs) });
  }
  return edits;
}

const MAX_CHAPTERS = 20;
const MAX_TOTAL_CHARS = 300_000;

// 서버 액션이 클라이언트에서 받은 챕터 목록을 Claude 호출에 쓰기 전에 형태·크기를 확인한다.
export function isValidChaptersInput(value: unknown): value is MasterChapter[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHAPTERS) return false;
  let total = 0;
  for (const c of value) {
    if (!Number.isInteger(c?.chapterNumber) || typeof c?.chapterTitle !== "string") return false;
    if (!Array.isArray(c.paragraphs) || !c.paragraphs.every((p: unknown) => typeof p === "string")) return false;
    total += c.chapterTitle.length + c.paragraphs.reduce((n: number, p: string) => n + p.length, 0);
  }
  return total <= MAX_TOTAL_CHARS;
}
