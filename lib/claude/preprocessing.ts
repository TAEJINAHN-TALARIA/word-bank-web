// 마스터 문단 정리의 ③ 문장 다듬기 — 프롬프트 조립, 결과 검증, 적용의 순수 로직. API 호출은 actions가 맡는다.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.
// 설계: docs/superpowers/specs/2026-11-23-master-preprocess-design.md ③
import { quotedRanges } from "@/lib/dialogueSplit";
import { DATA_NOTICE, INTRO, JSON_ONLY, KEEP_STYLE, applyChanges, validateChanges, type PolishChange } from "./editing";

export const MAX_CHAPTER_POLISH_CHANGES = 20;

// 장 전체를 담백하게 다듬는다. 문단마다 고칠 구절 목록만 돌려받고, 대사·사실·문체는 건드리지 않는다.
export const CHAPTER_POLISH_SYSTEM_PROMPT = `${INTRO} 지금은 장 전체의 서술을 담백하게 다듬는 편집자입니다.

다듬기 원칙:
- 수식어, 부사, 겹치는 꾸밈말이 많은 서술을 줄이고 군더더기를 덜어내세요. 문단을 다시 쓰지 말고 고칠 구절만 고르세요.
- 의미, 줄거리, 인물, 시점은 바꾸지 마세요. 새 내용을 더하지 마세요.
- 수·나이·날짜 표현은 그대로 두세요. 아라비아 숫자뿐 아니라 '열네 살', '이틀 뒤'처럼 말로 쓴 것도 바꾸지 마세요.
- 대사(따옴표 안)는 건드리지 마세요. 따옴표(“ ” " ' ‘ ’ 「 」)가 들어간 구절은 before와 after에 쓰지 마세요.
- 고친 곳마다 paragraphNumber(문단 번호), before(그 문단에 있는 구절), after(바꾼 구절), reason(왜 바꿨는지 한 문장)을 쓰세요. before는 그 문단에서 글자 하나 다르지 않게 그대로 옮기고, 한 문단 안에서 서로 겹치지 않게 하세요. 항목 하나는 문단 하나에 대한 변경만 씁니다.
- after는 before보다 짧거나 비슷하게 쓰세요.
- 고칠 곳이 없으면 changes를 빈 배열로 돌려주세요. 장당 최대 ${MAX_CHAPTER_POLISH_CHANGES}건입니다.
${KEEP_STYLE}
${DATA_NOTICE}
${JSON_ONLY}`;

export function buildChapterPolishTask(input: { chapterNumber: number; instruction?: string }): string {
  const instruction = input.instruction?.trim();
  return `[요청]
대상: ${input.chapterNumber}장 전체 문단
${instruction ? `지시: ${instruction}\n` : ""}
이 장에서 담백하게 다듬을 곳을 changes로 돌려주세요. paragraphNumber는 [소설 본문]에서 이 장의 문단 앞에 붙은 번호, before는 그 문단에 있는 구절을 그대로 옮긴 것, after는 바꾼 구절, reason은 한 문장으로 쓰세요.`;
}

export type RawChapterPolishChange = { paragraphNumber: number; before: string; after: string; reason: string };
export type ChapterPolishChange = { paragraphIndex: number; before: string; after: string; reason: string };
export type ChapterPolishResult = { changes: ChapterPolishChange[]; received: number };

const QUOTE_CHARS = /[“”"'‘’「」]/;

// 사실(나이·날짜)은 ④의 일이다. 아라비아 숫자 덩어리가 after에 그대로 남아야 한다(한글 수사는 못 잡는다 — 프롬프트로만 막는다).
function keepsNumbers(before: string, after: string): boolean {
  return (before.match(/\d+/g) ?? []).every((n) => after.includes(n));
}

/**
 * 장 단위 다듬기 결과 검증. 항목마다 가드(따옴표 글자, 대사 안쪽, 숫자 보존, 길이 120% 이하, 존재하는 문단)를 먼저 걸고,
 * 문단별로 묶어 기존 validateChanges(정확히 한 번·겹침·빈 줄·문단당 8건)로 마무리한 뒤, 합쳐서 앞에서부터 장당 20건에서 자른다.
 * 따옴표 짝이 어긋난 문단은 안쪽·바깥을 알 수 없어 그 문단의 항목을 전부 버린다. received는 받은 항목 수다.
 */
export function validateChapterPolish(raw: RawChapterPolishChange[], paragraphs: string[]): ChapterPolishResult {
  const ranges = paragraphs.map((p) => quotedRanges(p));
  const byParagraph = new Map<number, PolishChange[]>();

  for (const c of raw) {
    const index = c.paragraphNumber - 1;
    const paragraph = paragraphs[index];
    if (paragraph === undefined) continue;
    const quoted = ranges[index];
    if (!quoted) continue;
    if (QUOTE_CHARS.test(c.before) || QUOTE_CHARS.test(c.after)) continue;
    if (!keepsNumbers(c.before, c.after)) continue;
    if (c.after.length > c.before.length * 1.2) continue;
    const start = c.before ? paragraph.indexOf(c.before) : -1;
    const end = start + c.before.length;
    if (start >= 0 && quoted.some(([s, e]) => start >= s && end <= e)) continue;

    const list = byParagraph.get(index) ?? [];
    list.push({ before: c.before, after: c.after, reason: c.reason });
    byParagraph.set(index, list);
  }

  const changes: ChapterPolishChange[] = [];
  for (const [paragraphIndex, list] of byParagraph) {
    for (const c of validateChanges(list, paragraphs[paragraphIndex])) changes.push({ paragraphIndex, ...c });
  }
  return { changes: changes.slice(0, MAX_CHAPTER_POLISH_CHANGES), received: raw.length };
}

// 검증을 통과한 항목을 문단별로 적용한다. 입력 배열은 바꾸지 않는다.
export function applyChapterPolish(paragraphs: string[], changes: ChapterPolishChange[]): string[] {
  return paragraphs.map((paragraph, index) =>
    applyChanges(
      paragraph,
      changes.filter((c) => c.paragraphIndex === index),
    ),
  );
}
