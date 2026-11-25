// 마스터 문단 정리의 ③ 문장 다듬기 — 프롬프트 조립, 결과 검증, 적용의 순수 로직. API 호출은 actions가 맡는다.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.
// 설계: docs/superpowers/specs/2026-11-23-master-preprocess-design.md ③
import { quotedRanges } from "@/lib/dialogueSplit";
import { DATA_NOTICE, INTRO, JSON_ONLY, KEEP_STYLE, SPOKEN_DIALOGUE, applyChanges, validateChanges, type PolishChange } from "./editing";
import type { MasterChapter } from "@/lib/masterReview";
import { levelRubric } from "./levelRubric";

export const MAX_CHAPTER_POLISH_CHANGES = 10;

const MAX_SENTENCE_CHARS = 120;
// 모델은 글자 수를 세지 못해서, 이 길이를 넘는 문장은 코드가 찾아 대상 목록으로 건넨다(파일럿에서 규칙만으로는 움직이지 않았다).
export type LongSentence = { paragraphNumber: number; sentence: string };

/** 120자를 넘는 문장을 문단 번호(1부터)와 함께 찾는다. 따옴표 글자가 든 문장(대사 포함)은 제외한다. */
export function findLongSentences(paragraphs: string[]): LongSentence[] {
  const found: LongSentence[] = [];
  paragraphs.forEach((paragraph, i) => {
    for (const sentence of paragraph.split(/(?<=[.?!])\s+/)) {
      if (sentence.length > MAX_SENTENCE_CHARS && !QUOTE_CHARS.test(sentence)) found.push({ paragraphNumber: i + 1, sentence });
    }
  });
  return found;
}

// 장 전체를 그 레벨 독자가 막힐 곳만 마일드하게 손본다. 문단마다 고칠 구절 목록만 돌려받고, 대사·사실·문체·문장 모양은 건드리지 않는다.
// 레벨 기준표(levelRubric)를 아는 레벨이면 기준 블록을 싣는다. 파일럿은 Lv6에서만 돌렸다.
export function buildChapterPolishSystemPrompt(level: string): string {
  const rubric = levelRubric(level);
  const rubricBlock = rubric
    ? `[레벨 기준 — ${level}, ${rubric.reader}]
- 어휘·문장구조: ${rubric.vocabulary}
- 문장 길이 평균은 목표일 뿐이고 고치는 조건이 아닙니다.

`
    : "";
  return `${INTRO} 지금은 이 소설의 독자 수준(레벨)에 맞게 서술을 마일드하게 손보는 편집자입니다.

${rubricBlock}다듬기 원칙:
- 문장의 모양(한 문장인 것, 어순, 종결어미)은 그대로 두세요. 문장을 쪼개지 마세요. 이 레벨 독자가 막힐 곳만 최소한으로 고치세요.
- 고칠 곳: (1) 이 레벨에도 어려운 낱말·전문어를 쉬운 말로 바꾸기, (2) 같은 뜻을 겹쳐 꾸미는 말 중 가장 무거운 한 겹 덜기, (3) 레벨 기준을 크게 넘는 얽힌 문장은 가장 무거운 부분만 손보기.
- 이 레벨 독자가 이미 읽을 수 있는 문장은 건드리지 마세요. ${MAX_SENTENCE_CHARS}자 이하의 문장은 길다는 이유만으로 고치지 마세요.
- ${MAX_SENTENCE_CHARS}자를 넘는 문장은 그 레벨 독자에게 너무 얽혀 있으므로, 문장을 하나로 유지한 채 가장 무거운 꾸밈 한 겹이나 한 덩어리를 덜어 읽기 쉽게 하세요(뜻이 되는 부분은 남기세요).
- 비유, 어조, 분위기, 정서를 만드는 표현을 장식이라는 이유로 지우지 마세요. 정서를 만드는 감각어와 은유는 그대로 두고, 뜻이 약해지는 낱말로도 바꾸지 마세요.
- 의미, 줄거리, 인물, 시점은 바꾸지 마세요. 새 내용을 더하지 마세요.
- 수·나이·날짜 표현은 그대로 두세요. 아라비아 숫자뿐 아니라 '열네 살', '이틀 뒤'처럼 말로 쓴 것도 바꾸지 마세요.
- 대사(따옴표 안)는 건드리지 마세요. 따옴표(“ ” " ' ‘ ’ 「 」)가 들어간 구절은 before와 after에 쓰지 마세요.
- 고친 곳마다 paragraphNumber(문단 번호), before(그 문단에 있는 구절), after(바꾼 구절), reason(왜 바꿨는지 한 문장)을 쓰세요. before는 그 문단에서 글자 하나 다르지 않게 그대로 옮기고, 한 문단 안에서 서로 겹치지 않게 하세요. 항목 하나는 문단 하나에 대한 변경만 씁니다.
- after는 before보다 짧거나 비슷하게 쓰세요. 낱말을 풀어 쓰느라 늘어나는 경우도 8자 이내로 하세요.
- 고칠 곳이 없으면 changes를 빈 배열로 돌려주세요. 장당 최대 ${MAX_CHAPTER_POLISH_CHANGES}건입니다.
${KEEP_STYLE}
${DATA_NOTICE}
${JSON_ONLY}`;
}

export function buildChapterPolishTask(input: { chapterNumber: number; instruction?: string; targets?: LongSentence[] }): string {
  const instruction = input.instruction?.trim();
  const targets = input.targets?.length
    ? `

[반드시 손볼 문장]
아래 문장은 ${MAX_SENTENCE_CHARS}자를 넘어 이 레벨 독자에게 너무 얽혀 있습니다. 각 문장마다 문장은 하나로 유지한 채 가장 무거운 꾸밈 한 겹이나 한 덩어리를 덜어 changes에 넣으세요(뜻이 되는 부분은 남기세요).
${input.targets.map((t) => `- ${t.paragraphNumber}문단: ${t.sentence}`).join("\n")}`
    : "";
  return `[요청]
대상: ${input.chapterNumber}장 전체 문단
${instruction ? `지시: ${instruction}\n` : ""}
이 장에서 이 레벨 독자가 막힐 곳만 최소한으로 고칠 곳을 changes로 돌려주세요. paragraphNumber는 [소설 본문]에서 이 장의 문단 앞에 붙은 번호, before는 그 문단에 있는 구절을 그대로 옮긴 것, after는 바꾼 구절, reason은 한 문장으로 쓰세요.${targets}`;
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
 * 장 단위 다듬기 결과 검증. 항목마다 가드(따옴표 글자, 대사 안쪽, 숫자 보존, 길이 120% 이하(또는 +8자 이하), 존재하는 문단)를 먼저 걸고,
 * 문단별로 묶어 기존 validateChanges(정확히 한 번·겹침·빈 줄·문단당 8건)로 마무리한 뒤, 합쳐서 앞에서부터 장당 10건에서 자른다.
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
    // 길이 가드: 120% 이하이거나, 낱말 풀이로 8자 이하만 늘어난 것은 통과한다.
    if (c.after.length > c.before.length * 1.2 && c.after.length - c.before.length > 8) continue;
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

// ── ④ 사실관계 점검 ─────────────────────────────────────────────────────────────────────────────
// 글에 적힌 사실끼리 충돌하는 곳만 찾는다(정답 기준값은 없다). 원고 전체를 한 번에 보고, 정정은 편집자가 고른 것만 적용한다.
export const MAX_FACT_FINDINGS = 8;

export const FACTS_SYSTEM_PROMPT = `${INTRO} 지금은 소설 전체에서 사실 관계가 서로 충돌하는 곳을 찾는 편집자입니다.

점검 원칙:
- 같은 인물의 나이·직업·관계·외모, 장소, 시간(계절·요일·날짜), 사물의 수·색처럼 글에 적힌 사실이 서로 충돌하는 곳만 찾으세요. 글에 적히지 않은 설정을 추측해서 지적하지 마세요.
- 확실한 것만 최대 ${MAX_FACT_FINDINGS}건 돌려주세요. 해석이 갈리는 연출, 복선, 인물의 오해, 거짓말하는 인물의 대사는 모순으로 보지 마세요. 충돌이 없으면 findings를 빈 배열로 돌려주세요.
- 항목마다 topic(예: "수진의 나이"), description(한 문장), occurrences(충돌하는 위치 전부: chapterNumber, paragraphNumber, quote), fix(정정 제안)를 쓰세요. quote는 그 문단에 있는 구절을 글자 하나 다르지 않게 그대로 옮기세요.
- fix는 한 곳만 고치세요. 가능하면 처음 나온 값을 기준으로 뒤를 맞추고, 글의 흐름이 다른 쪽을 가리키면 그쪽에 맞추세요. 숫자나 단어 하나 수준으로 최소한만 바꾸고, before는 그 문단에 한 번만 나오는 구절을 그대로 옮기세요. 따옴표는 더하거나 빼거나 옮기지 마세요.
- 어느 쪽이 맞는지 알 수 없으면 fix.before를 빈 문자열로 두세요.
- 줄거리, 인물, 시점, 문체는 바꾸지 마세요.
${DATA_NOTICE}
${JSON_ONLY}`;

export function buildFactsTask(): string {
  return `[요청]
대상: 소설 전체
[소설 본문] 전체에서 사실 관계가 서로 충돌하는 곳을 findings로 돌려주세요. 항목마다 topic(주제), description(한 문장 설명), occurrences(충돌하는 위치마다 chapterNumber, paragraphNumber, quote), fix(chapterNumber, paragraphNumber, before, after, reason)를 쓰세요. 정정 제안을 하지 않으려면 fix.before를 빈 문자열로 쓰세요.`;
}

export type RawFactFinding = {
  topic: string;
  description: string;
  occurrences: { chapterNumber: number; paragraphNumber: number; quote: string }[];
  fix: { chapterNumber: number; paragraphNumber: number; before: string; after: string; reason: string }; // before === "" 이면 정정 제안 없음
};
export type FactOccurrence = { chapterNumber: number; paragraphIndex: number; quote: string };
export type FactFix = { chapterNumber: number; paragraphIndex: number; before: string; after: string; reason: string };
export type FactFinding = { topic: string; description: string; occurrences: FactOccurrence[]; fix: FactFix | null };

// ①이 따옴표 짝으로 대사를 나누므로, 정정이 따옴표 글자를 더하거나 빼거나 옮기면 짝이 깨진다.
function sameQuoteChars(before: string, after: string): boolean {
  return (["“", "”", '"'] as const).every((q) => before.split(q).length === after.split(q).length);
}

/**
 * 사실관계 점검 결과 검증. 위치(장·문단)가 없거나 quote가 그 문단에 없는 occurrence는 위치 표시에서만 뺀다.
 * fix는 before가 문단에 정확히 한 번 있고, 아무 것도 안 바꾸거나 빈 줄을 더하거나 따옴표 글자를 바꾸지 않고,
 * 앞서 채택한 fix와 겹치지 않을 때만 남긴다. 못 쓰게 된 fix는 null로 두고 항목(발견)은 남긴다. 항목은 앞에서부터 8건에서 자른다.
 */
export function validateFactFindings(raw: RawFactFinding[], chapters: MasterChapter[]): FactFinding[] {
  const claimed = new Map<string, [number, number][]>();
  const out: FactFinding[] = [];

  for (const r of raw) {
    if (out.length === MAX_FACT_FINDINGS) break;

    const occurrences: FactOccurrence[] = [];
    for (const o of r.occurrences) {
      const paragraph = chapters.find((c) => c.chapterNumber === o.chapterNumber)?.paragraphs[o.paragraphNumber - 1];
      if (paragraph === undefined || !o.quote || !paragraph.includes(o.quote)) continue;
      occurrences.push({ chapterNumber: o.chapterNumber, paragraphIndex: o.paragraphNumber - 1, quote: o.quote });
    }

    let fix: FactFix | null = null;
    let span: { key: string; range: [number, number] } | null = null;
    const f = r.fix;
    const paragraph = chapters.find((c) => c.chapterNumber === f.chapterNumber)?.paragraphs[f.paragraphNumber - 1];
    if (paragraph !== undefined && f.before && f.before !== f.after && !/\n\s*\n/.test(f.after) && sameQuoteChars(f.before, f.after)) {
      const start = paragraph.indexOf(f.before);
      if (start >= 0 && paragraph.indexOf(f.before, start + 1) < 0) {
        const range: [number, number] = [start, start + f.before.length];
        const key = `${f.chapterNumber}:${f.paragraphNumber - 1}`;
        if (!(claimed.get(key) ?? []).some(([s, e]) => range[0] < e && s < range[1])) {
          fix = { chapterNumber: f.chapterNumber, paragraphIndex: f.paragraphNumber - 1, before: f.before, after: f.after, reason: f.reason.trim() };
          span = { key, range };
        }
      }
    }

    if (occurrences.length === 0 && !fix) continue;
    if (span) claimed.set(span.key, [...(claimed.get(span.key) ?? []), span.range]);
    out.push({ topic: r.topic, description: r.description, occurrences, fix });
  }
  return out;
}

// ── ⑤ 대사 구어체 · ⑥ 서술 문체 점검 ─────────────────────────────────────────────────────────────
// ④와 같은 모양(FactFinding)의 점검형 단계다. 원고 전체를 한 번에 보고, 정정은 편집자가 고른 것만 적용한다.
// 같은 구절을 ④⑤⑥ 둘 이상이 고치자고 할 수 있어서, 적용할 때 겹치면 뒤의 것을 건너뛴다(paragraphCleanup.applyCheckFixes).
const FINDING_SHAPE =
  "항목마다 topic(주제), description(한 문장 설명), occurrences(해당 위치마다 chapterNumber, paragraphNumber, quote), fix(정정 제안)를 쓰세요. quote는 그 문단에 있는 구절을 글자 하나 다르지 않게 그대로 옮기세요.";

export const DIALOGUE_CHECK_SYSTEM_PROMPT = `${INTRO} 지금은 소설 전체의 대사가 실제로 입으로 하는 말처럼 들리는지 점검하는 편집자입니다.

점검 원칙:
${SPOKEN_DIALOGUE}
- 따옴표 안의 대사만 보세요. 공문·문어체·번역투처럼 읽히는 대사(예: "~하는 바입니다", "~에 대해서는 추후 연락드리겠습니다")를 찾으세요. 인물 말투([설정]의 인물 말투)는 입말로만 바꾸고 그대로 유지하세요. 격식체 인물은 격식을 유지한 채 입말로, 사투리·반말도 그 인물의 것을 지키세요.
- 확실한 것만 최대 ${MAX_FACT_FINDINGS}건 돌려주세요. 입말로 자연스러운 대사, 인물 설정상 일부러 딱딱한 대사는 지적하지 마세요. 문제가 없으면 findings를 빈 배열로 돌려주세요.
- ${FINDING_SHAPE} 항목 하나는 대사 한 곳입니다.
- fix는 그 대사의 입말 대안 하나입니다. 대사의 뜻·내용·사실·숫자는 바꾸지 마세요. fix.before와 fix.after는 따옴표 글자(“ ” ")를 넣지 말고 대사 안쪽 구절만 쓰고, before는 그 문단에 한 번만 나오는 구절을 그대로 옮기세요.
- 어떻게 고칠지 확실하지 않으면 fix.before를 빈 문자열로 두세요.
- 서술 문장(따옴표 밖), 줄거리, 인물, 시점은 건드리지 마세요.
${DATA_NOTICE}
${JSON_ONLY}`;

export const STYLE_CHECK_SYSTEM_PROMPT = `${INTRO} 지금은 소설 전체에서 서술 문체가 갑자기 달라지는 곳을 찾는 편집자입니다.

점검 원칙:
- [설정]의 서술 문체를 기준으로, 서술(따옴표 밖) 문장이 그 문체에서 벗어나는 곳을 찾으세요: 종결어미가 갑자기 바뀌는 곳(예: -했다체 서술에 -했어요체가 끼는 곳), 서술 시점이 갑자기 달라지는 곳, 장 사이에서 어조가 눈에 띄게 달라지는 곳, 한 장만 수식어 밀도가 유난히 높거나 낮은 곳.
- 확실한 것만 최대 ${MAX_FACT_FINDINGS}건 돌려주세요. 장면의 분위기 때문에 일부러 바꾼 어조, 인물의 생각을 그대로 옮긴 문장은 지적하지 마세요. 문제가 없으면 findings를 빈 배열로 돌려주세요.
- ${FINDING_SHAPE}
- fix는 고칠 구절이 분명할 때만 쓰세요. 최소한만 바꾸고, before는 그 문단에 한 번만 나오는 구절을 그대로 옮기세요. fix.before와 fix.after에 따옴표 글자(“ ” ")를 넣지 말고, 숫자·사실은 바꾸지 마세요. 고칠 구절이 분명하지 않으면(예: 장 전체의 어조 차이) fix.before를 빈 문자열로 두고 occurrences로 위치만 알리세요.
- 대사(따옴표 안)는 보지 마세요. 줄거리, 인물, 시점 설정은 바꾸지 마세요.
${DATA_NOTICE}
${JSON_ONLY}`;

export function buildDialogueCheckTask(): string {
  return `[요청]
대상: 소설 전체
[소설 본문] 전체에서 따옴표 안의 대사 중 입말로 자연스럽지 않은 곳을 findings로 돌려주세요. 항목마다 topic(주제), description(한 문장 설명), occurrences(위치마다 chapterNumber, paragraphNumber, quote), fix(chapterNumber, paragraphNumber, before, after, reason)를 쓰세요. 정정 제안을 하지 않으려면 fix.before를 빈 문자열로 쓰세요.`;
}

export function buildStyleCheckTask(): string {
  return `[요청]
대상: 소설 전체
[소설 본문] 전체에서 서술 문체가 갑자기 달라지는 곳을 findings로 돌려주세요. 항목마다 topic(주제), description(한 문장 설명), occurrences(위치마다 chapterNumber, paragraphNumber, quote), fix(chapterNumber, paragraphNumber, before, after, reason)를 쓰세요. 정정 제안을 하지 않으려면 fix.before를 빈 문자열로 쓰세요.`;
}

/**
 * ⑤⑥ 점검 결과 검증. validateFactFindings의 규칙(위치·정확히 한 번·따옴표 글자·겹침·8건)에 더해,
 * 아라비아 숫자 덩어리가 after에 없는 fix는 못 쓰게 한다. 못 쓰게 된 fix는 겹침 자리도 차지하지 않도록 먼저 비운다(항목은 위치가 있으면 남는다).
 */
export function validateCheckFindings(raw: RawFactFinding[], chapters: MasterChapter[]): FactFinding[] {
  return validateFactFindings(
    raw.map((r) => (keepsNumbers(r.fix.before, r.fix.after) ? r : { ...r, fix: { ...r.fix, before: "" } })),
    chapters,
  );
}
