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

// 공백을 뺀 글자 수 기준 문장당 평균 길이(story-generator readability.js의 한국어 목표 "문장당 자 수"와 같은 척도).
// 마침표·물음표·느낌표와 줄바꿈을 문장 끝으로 본다. 레벨 문장 길이를 맞추라는 게 아니라 읽는 호흡을 보는 참고용이다.
export function averageSentenceLength(text: string): number {
  const sentences = text
    .split(/[.!?]+\s*|\n+/)
    .map((s) => s.replace(/\s/g, ""))
    .filter(Boolean);
  if (!sentences.length) return 0;
  return Math.round(sentences.reduce((n, s) => n + s.length, 0) / sentences.length);
}

// ── 문단 구조 편집 (작업 공간의 추가·삭제·이동). 입력을 바꾸지 않고 새 배열을 돌려준다. ──

function withParagraphs(
  chapters: MasterChapter[],
  chapterNumber: number,
  update: (paragraphs: string[]) => string[],
): MasterChapter[] {
  return chapters.map((c) => (c.chapterNumber === chapterNumber ? { ...c, paragraphs: update(c.paragraphs) } : c));
}

export function insertParagraph(chapters: MasterChapter[], chapterNumber: number, at: number): MasterChapter[] {
  return withParagraphs(chapters, chapterNumber, (p) => [...p.slice(0, at), "", ...p.slice(at)]);
}

// 챕터에는 문단이 하나 이상 있어야 하므로 마지막 한 문단은 지우지 않는다.
export function removeParagraph(chapters: MasterChapter[], chapterNumber: number, index: number): MasterChapter[] {
  return withParagraphs(chapters, chapterNumber, (p) => (p.length <= 1 ? p : p.filter((_, i) => i !== index)));
}

export function moveParagraph(chapters: MasterChapter[], chapterNumber: number, from: number, to: number): MasterChapter[] {
  return withParagraphs(chapters, chapterNumber, (p) => {
    if (from < 0 || from >= p.length || to < 0 || to >= p.length || from === to) return p;
    const next = [...p];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });
}

// 문단을 추가·이동하면 위치(index)가 밀리므로, 메모와 "수정됨" 표시는 위치가 아니라 문단 내용으로 따라간다.

const squash = (s: string) => s.replace(/\s/g, "");

// 불러온 문단이 현재 본문 어디에 있는지 찾는다. 문단을 나누거나 합쳐도 글자는 그대로이므로 공백을 뺀 글자로 비교한다.
// ① 그대로 있으면 그 위치, ② 나뉘었으면(이어 붙이면 원래 문단이 되는 연속 문단) 첫 조각, ③ 합쳐졌으면 그 문단을 통째로 담은 문단.
function findMemoParagraph(loadedText: string, current: string[]): number {
  const exact = current.findIndex((p) => p.trim() === loadedText);
  if (exact >= 0) return exact;

  const target = squash(loadedText);
  for (let i = 0; i < current.length; i++) {
    let joined = "";
    for (let j = i; j < current.length; j++) {
      joined += squash(current[j]);
      if (joined === target) return i;
      if (joined.length >= target.length) break;
    }
  }
  return current.findIndex((p) => squash(p).includes(target));
}

/**
 * 사전 검토 메모(불러온 본문 기준 위치)를 현재 본문 기준 위치로 다시 매긴다.
 * 문단을 나누면 메모는 첫 조각에, 합치면 합쳐진 문단에 붙는다.
 * 그 문단을 고치거나 지워서 내용이 더 이상 없으면 해결된 것으로 보고 뺀다.
 */
export function locateMemos(
  memos: PreReviewItem[],
  loaded: MasterChapter[],
  current: MasterChapter[],
): PreReviewItem[] {
  const located: PreReviewItem[] = [];
  for (const memo of memos) {
    const loadedText = loaded.find((c) => c.chapterNumber === memo.chapterNumber)?.paragraphs[memo.paragraphIndex]?.trim();
    if (!loadedText) continue;
    const paragraphs = current.find((c) => c.chapterNumber === memo.chapterNumber)?.paragraphs;
    if (!paragraphs) continue;
    const index = findMemoParagraph(loadedText, paragraphs);
    if (index < 0) continue;
    located.push({ ...memo, paragraphIndex: index });
  }
  return located;
}

/** 원본의 어느 문단과도 같지 않은 현재 문단의 키(`챕터-위치`) 집합. */
export function editedParagraphKeys(current: MasterChapter[], original: MasterChapter[]): Set<string> {
  const keys = new Set<string>();
  for (const chapter of current) {
    const originals = new Set(
      (original.find((o) => o.chapterNumber === chapter.chapterNumber)?.paragraphs ?? []).map((p) => p.trim()),
    );
    chapter.paragraphs.forEach((p, i) => {
      if (!originals.has(p.trim())) keys.add(`${chapter.chapterNumber}-${i}`);
    });
  }
  return keys;
}
