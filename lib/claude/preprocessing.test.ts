import { describe, it, expect } from "vitest";
import {
  MAX_CHAPTER_POLISH_CHANGES,
  buildChapterPolishSystemPrompt,
  buildChapterPolishTask,
  findLongSentences,
  validateChapterPolish,
  applyChapterPolish,
  type RawChapterPolishChange,
  MAX_FACT_FINDINGS,
  FACTS_SYSTEM_PROMPT,
  DIALOGUE_CHECK_SYSTEM_PROMPT,
  STYLE_CHECK_SYSTEM_PROMPT,
  buildFactsTask,
  buildDialogueCheckTask,
  buildStyleCheckTask,
  validateFactFindings,
  validateCheckFindings,
  type RawFactFinding,
} from "./preprocessing";
import { DATA_NOTICE, SPOKEN_DIALOGUE } from "./editing";
import { levelRubric } from "./levelRubric";
import type { MasterChapter } from "@/lib/masterReview";

const P = ["그녀는 아주아주 매우 조용하고 차분하게 문을 천천히 열었다.", "수진은 14살이었다. 그는 “가자.” 하고 말했다."];

const good: RawChapterPolishChange = {
  paragraphNumber: 1,
  before: "아주아주 매우 조용하고 차분하게 ",
  after: "",
  reason: "수식어가 겹쳐요",
};

describe("③ 문장 다듬기", () => {
  it("시스템 프롬프트에 핵심 규칙이 들어 있다", () => {
    const prompt = buildChapterPolishSystemPrompt("Lv6");
    expect(prompt).toContain(DATA_NOTICE);
    expect(prompt).toContain("대사(따옴표 안)는 건드리지");
    expect(prompt).toContain(`최대 ${MAX_CHAPTER_POLISH_CHANGES}건`);
    expect(prompt).toContain("최대 10건");
    expect(prompt).toContain("수·나이·날짜");
    expect(prompt).toContain("문장을 쪼개지 마세요");
    expect(prompt).toContain("120자 이하의 문장은 길다는 이유만으로 고치지 마세요");
    expect(prompt).toContain("은유");
    expect(prompt).toContain("뜻이 약해지는 낱말로도 바꾸지 마세요");
  });

  it("레벨을 알면 그 레벨 독자와 어휘·문장구조 기준을 담고, 모르면 기준 블록 없이 같은 원칙만 가진다", () => {
    const rubric = levelRubric("Lv6")!;
    const prompt = buildChapterPolishSystemPrompt("Lv6");
    expect(prompt).toContain(rubric.reader);
    expect(prompt).toContain(rubric.vocabulary);
    expect(buildChapterPolishSystemPrompt("Lv3")).toContain(levelRubric("Lv3")!.vocabulary);
    expect(buildChapterPolishSystemPrompt("Lv3")).not.toContain(rubric.vocabulary);

    for (const unknown of ["Lv9", ""]) {
      const generic = buildChapterPolishSystemPrompt(unknown);
      expect(generic).not.toContain("[레벨 기준");
      expect(generic).toContain("문장을 쪼개지 마세요");
      expect(generic).toContain("최대 10건");
    }
  });

  it("요청문에 장 번호와 지시가 들어간다", () => {
    const task = buildChapterPolishTask({ chapterNumber: 3, instruction: "더 짧게" });
    expect(task).toContain("3장 전체 문단");
    expect(task).toContain("더 짧게");
    expect(buildChapterPolishTask({ chapterNumber: 3 })).not.toContain("지시:");
  });

  it("대상 문장이 있으면 [반드시 손볼 문장] 블록에 문단 번호와 함께 싣고, 없거나 비면 블록이 없다", () => {
    const task = buildChapterPolishTask({
      chapterNumber: 3,
      targets: [
        { paragraphNumber: 2, sentence: "긴 문장 하나." },
        { paragraphNumber: 5, sentence: "긴 문장 둘." },
      ],
    });
    expect(task).toContain("[반드시 손볼 문장]");
    expect(task).toContain("- 2문단: 긴 문장 하나.");
    expect(task).toContain("- 5문단: 긴 문장 둘.");
    expect(buildChapterPolishTask({ chapterNumber: 3 })).not.toContain("[반드시 손볼 문장]");
    expect(buildChapterPolishTask({ chapterNumber: 3, targets: [] })).not.toContain("[반드시 손볼 문장]");
  });

  describe("findLongSentences", () => {
    const sentence = (n: number) => "가".repeat(n - 1) + "."; // 마침표 포함 n자

    it("120자를 넘는 문장만 문단 번호(1부터)와 함께 찾는다 — 정확히 120자는 제외", () => {
      const paragraphs = [`${sentence(120)} ${sentence(121)}`, sentence(50), `${sentence(30)} ${sentence(150)}`];
      expect(findLongSentences(paragraphs)).toEqual([
        { paragraphNumber: 1, sentence: sentence(121) },
        { paragraphNumber: 3, sentence: sentence(150) },
      ]);
    });

    it("따옴표 글자가 든 긴 문장은 제외한다", () => {
      expect(findLongSentences([`${"가".repeat(130)} “대사” 나나나나나.`])).toEqual([]);
      expect(findLongSentences([`${"가".repeat(130)}'나.`])).toEqual([]);
    });

    it("? ! 뒤 공백으로도 문장을 나누고, 120자 이하만 있으면 빈 배열", () => {
      expect(findLongSentences([`${"가".repeat(70)}? ${"나".repeat(70)}!`])).toEqual([]);
      expect(findLongSentences([])).toEqual([]);
    });
  });

  describe("validateChapterPolish", () => {
    it("좋은 항목은 문단 인덱스로 바뀌어 남고 received는 입력 길이다", () => {
      expect(validateChapterPolish([good], P)).toEqual({
        changes: [{ paragraphIndex: 0, before: good.before, after: "", reason: good.reason }],
        received: 1,
      });
    });

    it("문단이 빈 배열이면 변경 없이 received만 센다", () => {
      expect(validateChapterPolish([good, good], [])).toEqual({ changes: [], received: 2 });
    });

    it("대사 안쪽 구절은 버리고 같은 문단의 대사 밖 구절은 남긴다", () => {
      const paragraphs = ["그는 “가자, 정말 매우 빨리 가자.” 하고 말했다."];
      const inside = { paragraphNumber: 1, before: "정말 매우 빨리 ", after: "", reason: "r" };
      const outside = { paragraphNumber: 1, before: "하고 ", after: "", reason: "r" };
      const { changes } = validateChapterPolish([inside, outside], paragraphs);
      expect(changes.map((c) => c.before)).toEqual(["하고 "]);
    });

    it("따옴표 짝이 어긋난 문단은 어떤 항목도 남기지 않는다", () => {
      const paragraphs = ["그가 “열린 따옴표 안의 아주 긴 말"];
      const items = [
        { paragraphNumber: 1, before: "열린 따옴표 안의 ", after: "", reason: "r" },
        { paragraphNumber: 1, before: "그가 ", after: "", reason: "r" },
      ];
      expect(validateChapterPolish(items, paragraphs)).toEqual({ changes: [], received: 2 });
    });

    const bad: [string, RawChapterPolishChange][] = [
      ["문단 번호 0", { ...good, paragraphNumber: 0 }],
      ["없는 문단 번호", { ...good, paragraphNumber: 3 }],
      ["문단에 없는 before", { ...good, before: "존재하지 않는 구절" }],
      ["문단에 두 번 나오는 before", { ...good, paragraphNumber: 3, before: "가" }],
      ["before와 after가 같음", { ...good, after: good.before }],
      ["after에 빈 줄", { ...good, after: "가\n\n나" }],
      ["before가 14살 → after 16살", { paragraphNumber: 2, before: "14살", after: "16살", reason: "r" }],
      ["after가 before의 120% 초과이면서 8자도 넘게 늘어남", { ...good, before: "문을 ", after: "문을 아주아주 매우 천천히 조용하게 아주 " }],
      ...["“", "”", '"', "'", "‘", "’", "「", "」"].map((q): [string, RawChapterPolishChange] => [
        `after에 ${q}`,
        { ...good, after: `${q}` },
      ]),
    ];

    it.each(bad)("버린다: %s", (_name, item) => {
      // 세 번째 문단은 "가"가 두 번 나오는 경우를 위한 것이다.
      const paragraphs = [...P, "가나다가"];
      // before에 따옴표가 있는 항목은 문단에도 그 글자가 있어야 정확히 한 번 맞는지와 상관없이 가드가 먼저 걸러야 한다.
      expect(validateChapterPolish([item], paragraphs).changes).toEqual([]);
    });

    // 문단에는 따옴표가 실제로 있고(따옴표 짝은 맞다) before가 대사 구간에 통째로 들지 않아, 글자 가드만이 이 항목을 막는다.
    it.each([
      ["“", "그는 “조용히” 걸었다.", "그는 “"],
      ["”", "그는 “조용히” 걸었다.", "” 걸었다."],
      ['"', '그는 "조용히" 걸었다.', '그는 "'],
      ["'", "그는 '조용히 걸었다.", "그는 '"],
      ["‘", "그는 ‘조용히’ 걸었다.", "그는 ‘"],
      ["’", "그는 ‘조용히’ 걸었다.", "’ 걸었다."],
      ["「", "그는 「조용히」 걸었다.", "그는 「"],
      ["」", "그는 「조용히」 걸었다.", "」 걸었다."],
    ])("before에 %s가 있으면 버린다", (_q, paragraph, before) => {
      expect(validateChapterPolish([{ paragraphNumber: 1, before, after: "", reason: "r" }], [paragraph]).changes).toEqual([]);
    });

    it("길이 가드: 120% 이하는 통과, 120%를 넘어도 8자 이하로 늘면 통과, 120%를 넘고 8자도 넘게 늘면 버린다", () => {
      const paragraphs = ["그녀는 얇은 트레이싱지 위에 크로키를 했다."];
      const make = (before: string, after: string) =>
        validateChapterPolish([{ paragraphNumber: 1, before, after, reason: "r" }], paragraphs).changes;
      expect(make("트레이싱지", "얇은 종이")).toHaveLength(1); // 120% 이하
      expect(make("크로키", "빠르게 그린 스케치도")).toHaveLength(1); // 3자 → 11자: 120% 초과, 정확히 +8
      expect(make("크로키", "빠르게 그린 스케치그림")).toEqual([]); // 3자 → 12자: 120% 초과, +9
    });

    it("같은 문단 안에서 겹치는 두 번째 항목은 버린다", () => {
      const second = { ...good, before: "매우 조용하고 ", after: "" };
      const { changes, received } = validateChapterPolish([good, second], P);
      expect(changes).toHaveLength(1);
      expect(changes[0].before).toBe(good.before);
      expect(received).toBe(2);
    });

    it("장당 10건에서 자른다 (유효 11건을 세 문단에 나눠 줘서 장 한도가 걸리게 한다)", () => {
      const words = Array.from({ length: 11 }, (_, i) => `단어${String.fromCharCode(0xac00 + i)}`);
      const paragraphs = [0, 1, 2].map((p) => words.slice(p * 4, p * 4 + 4).join(" 그리고 ") + " 끝.");
      const raw: RawChapterPolishChange[] = words.map((w, i) => ({
        paragraphNumber: Math.floor(i / 4) + 1,
        before: `${w} `,
        after: "",
        reason: "r",
      }));
      const result = validateChapterPolish(raw, paragraphs);
      expect(result.received).toBe(11);
      expect(result.changes).toHaveLength(MAX_CHAPTER_POLISH_CHANGES);
      expect(result.changes.map((c) => c.before)).toEqual(raw.slice(0, 10).map((r) => r.before));
    });
  });

  describe("applyChapterPolish", () => {
    it("해당 문단만 바꾸고 입력 배열은 건드리지 않는다", () => {
      const input = [...P];
      const { changes } = validateChapterPolish([good], P);
      const out = applyChapterPolish(input, changes);
      expect(out).toEqual(["그녀는 문을 천천히 열었다.", P[1]]);
      expect(input).toEqual(P);
    });

    it("한 문단의 두 항목 중 앞을 고쳐도 뒤 항목이 제자리에 적용된다", () => {
      const paragraphs = ["그녀는 아주아주 매우 조용하게 문을 천천히 열었다."];
      const raw = [
        { paragraphNumber: 1, before: "아주아주 매우 ", after: "", reason: "r" },
        { paragraphNumber: 1, before: "천천히 ", after: "", reason: "r" },
      ];
      const { changes } = validateChapterPolish(raw, paragraphs);
      expect(changes).toHaveLength(2);
      expect(applyChapterPolish(paragraphs, changes)).toEqual(["그녀는 조용하게 문을 열었다."]);
    });
  });
});

describe("④ 사실관계 점검", () => {
  const chapters: MasterChapter[] = [
    { chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["수진은 14살이었다."] },
    { chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["열여섯 살의 수진이 왔다.", "“저 열네 살이에요.” 하고 수진이 말했다.", "그는 14살 14살 이라고 했다."] },
  ];

  const finding: RawFactFinding = {
    topic: "수진의 나이",
    description: "1장에서는 14살인데 2장에서는 열여섯 살이다.",
    occurrences: [
      { chapterNumber: 1, paragraphNumber: 1, quote: "14살" },
      { chapterNumber: 2, paragraphNumber: 1, quote: "열여섯 살" },
    ],
    fix: { chapterNumber: 2, paragraphNumber: 1, before: "열여섯 살", after: "열네 살", reason: "처음 나온 값에 맞춰요" },
  };

  it("시스템 프롬프트에 핵심 규칙이 들어 있다", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain(DATA_NOTICE);
    expect(FACTS_SYSTEM_PROMPT).toContain(`최대 ${MAX_FACT_FINDINGS}건`);
    expect(FACTS_SYSTEM_PROMPT).toContain("최대 8건");
    expect(FACTS_SYSTEM_PROMPT).toContain("처음 나온 값");
  });

  it("요청문이 항목 모양을 설명한다", () => {
    const task = buildFactsTask();
    for (const key of ["topic", "description", "occurrences", "fix"]) expect(task).toContain(key);
  });

  it("정상 항목은 문단 번호가 0부터의 인덱스로 바뀌고 fix가 남는다", () => {
    expect(validateFactFindings([finding], chapters)).toEqual([
      {
        topic: "수진의 나이",
        description: finding.description,
        occurrences: [
          { chapterNumber: 1, paragraphIndex: 0, quote: "14살" },
          { chapterNumber: 2, paragraphIndex: 0, quote: "열여섯 살" },
        ],
        fix: { chapterNumber: 2, paragraphIndex: 0, before: "열여섯 살", after: "열네 살", reason: "처음 나온 값에 맞춰요" },
      },
    ]);
  });

  it("문단에 없는 quote는 그 occurrence만 뺀다", () => {
    const raw = { ...finding, occurrences: [finding.occurrences[0], { chapterNumber: 2, paragraphNumber: 1, quote: "없는 구절" }] };
    const [out] = validateFactFindings([raw], chapters);
    expect(out.occurrences).toEqual([{ chapterNumber: 1, paragraphIndex: 0, quote: "14살" }]);
    expect(out.fix).not.toBeNull();
  });

  it("없는 장/문단을 가리키는 occurrence도 뺀다", () => {
    const raw = { ...finding, occurrences: [finding.occurrences[0], { chapterNumber: 9, paragraphNumber: 1, quote: "14살" }, { chapterNumber: 1, paragraphNumber: 5, quote: "14살" }] };
    expect(validateFactFindings([raw], chapters)[0].occurrences).toHaveLength(1);
  });

  it("모든 occurrence가 빠지고 fix도 없으면 항목이 사라진다", () => {
    const raw: RawFactFinding = {
      ...finding,
      occurrences: [{ chapterNumber: 1, paragraphNumber: 1, quote: "없는 구절" }],
      fix: { ...finding.fix, before: "" },
    };
    expect(validateFactFindings([raw], chapters)).toEqual([]);
  });

  it("occurrence가 모두 빠져도 fix가 남으면 항목은 남는다", () => {
    const raw = { ...finding, occurrences: [{ chapterNumber: 1, paragraphNumber: 1, quote: "없는 구절" }] };
    const [out] = validateFactFindings([raw], chapters);
    expect(out.occurrences).toEqual([]);
    expect(out.fix).not.toBeNull();
  });

  const badFixes: [string, RawFactFinding["fix"]][] = [
    ["없는 장", { ...finding.fix, chapterNumber: 9 }],
    ["없는 문단", { ...finding.fix, paragraphNumber: 7 }],
    ["문단에 없는 before", { ...finding.fix, before: "존재하지 않는 구절" }],
    ["문단에 두 번 나오는 before", { chapterNumber: 2, paragraphNumber: 3, before: "14살", after: "열네 살", reason: "r" }],
    ["before와 after가 같음", { ...finding.fix, after: finding.fix.before }],
    ["after에 빈 줄", { ...finding.fix, after: "열네 살\n\n이다" }],
    ["before가 빈 문자열", { ...finding.fix, before: "" }],
    ["after에서 따옴표를 뺌", { chapterNumber: 2, paragraphNumber: 2, before: "열네 살이에요.”", after: "열네 살이에요.", reason: "r" }],
    ["after에 따옴표를 더함", { ...finding.fix, after: "“열네 살”" }],
    ["따옴표 종류가 바뀜", { chapterNumber: 2, paragraphNumber: 2, before: "“저", after: "\"저", reason: "r" }],
  ];

  it.each(badFixes)("fix를 null로 만든다: %s", (_name, fix) => {
    const [out] = validateFactFindings([{ ...finding, fix }], chapters);
    expect(out.fix).toBeNull();
    expect(out.occurrences.length).toBeGreaterThan(0);
  });

  it("대사 안쪽 정정은 따옴표 글자가 같으면 남는다", () => {
    const fix = { chapterNumber: 2, paragraphNumber: 2, before: "열네 살이에요", after: "열여섯 살이에요", reason: "r" };
    const [out] = validateFactFindings([{ ...finding, fix }], chapters);
    expect(out.fix).toEqual({ chapterNumber: 2, paragraphIndex: 1, before: fix.before, after: fix.after, reason: "r" });
  });

  it("앞선 fix와 겹치는 뒤 항목의 fix는 null이 되고 앞 항목은 유지된다", () => {
    const second: RawFactFinding = {
      ...finding,
      topic: "다른 주제",
      fix: { chapterNumber: 2, paragraphNumber: 1, before: "여섯 살의", after: "네 살의", reason: "r" },
    };
    const [a, b] = validateFactFindings([finding, second], chapters);
    expect(a.fix).not.toBeNull();
    expect(b.fix).toBeNull();
  });

  it("겹치지 않는 같은 문단의 fix는 둘 다 남는다", () => {
    const second: RawFactFinding = {
      ...finding,
      topic: "다른 주제",
      fix: { chapterNumber: 2, paragraphNumber: 1, before: "수진이 왔다", after: "수진이 갔다", reason: "r" },
    };
    const [a, b] = validateFactFindings([finding, second], chapters);
    expect(a.fix).not.toBeNull();
    expect(b.fix).not.toBeNull();
  });

  it("9건을 주면 8건만 돌려준다", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...finding, topic: `주제${i}`, fix: { ...finding.fix, before: "" } }));
    const out = validateFactFindings(nine, chapters);
    expect(out).toHaveLength(MAX_FACT_FINDINGS);
    expect(out.map((f) => f.topic)).toEqual(nine.slice(0, 8).map((f) => f.topic));
  });
});

describe("⑤ 대사 구어체 · ⑥ 서술 문체 점검", () => {
  const chapters: MasterChapter[] = [
    { chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["그는 “본인은 귀하의 방문을 환영하는 바입니다.” 하고 말했다.", "수진은 14살이었다."] },
    { chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["“그 건에 대해서는 추후 연락드리겠습니다.” 한민우가 말했다."] },
  ];
  const raw = (fix: Partial<RawFactFinding["fix"]> = {}, rest: Partial<RawFactFinding> = {}): RawFactFinding => ({
    topic: "한민우의 공문식 대사",
    description: "공문처럼 딱딱한 대사예요.",
    occurrences: [{ chapterNumber: 1, paragraphNumber: 1, quote: "본인은 귀하의 방문을 환영하는 바입니다." }],
    fix: {
      chapterNumber: 1,
      paragraphNumber: 1,
      before: "본인은 귀하의 방문을 환영하는 바입니다.",
      after: "어서 와요, 잘 오셨어요.",
      reason: "입말로",
    },
    ...rest,
    ...(Object.keys(fix).length ? { fix: { ...raw().fix, ...fix } } : {}),
  });

  describe("프롬프트", () => {
    it("⑤: 따옴표 안의 대사만, 입말로만 바꾸고 말투·내용·숫자는 유지, 확실한 것만 최대 8건, 대사 안쪽 구절로 정정", () => {
      const p = DIALOGUE_CHECK_SYSTEM_PROMPT;
      expect(p).toContain(DATA_NOTICE);
      expect(p).toContain(SPOKEN_DIALOGUE);
      expect(p).toContain("따옴표 안의 대사");
      expect(p).toContain("인물 말투");
      expect(p).toContain("입말로만");
      expect(p).toContain("숫자");
      expect(p).toContain("확실한 것만 최대 8건");
      expect(p).toContain("따옴표 글자");
      expect(p).toContain("fix.before");
    });

    it("⑥: [설정]의 서술 문체 기준, 종결어미 급변·시점 이탈·장 사이 어조·수식 밀도, 최대 8건, 분명할 때만 정정", () => {
      const p = STYLE_CHECK_SYSTEM_PROMPT;
      expect(p).toContain(DATA_NOTICE);
      expect(p).toContain("[설정]");
      expect(p).toContain("서술 문체");
      expect(p).toContain("종결어미");
      expect(p).toContain("시점");
      expect(p).toContain("장 사이");
      expect(p).toContain("수식");
      expect(p).toContain("확실한 것만 최대 8건");
      expect(p).toContain("분명할 때만");
      expect(p).toContain("fix.before");
      expect(p).not.toContain(SPOKEN_DIALOGUE); // 대사는 ⑤의 일이다
    });

    it("요청문이 항목 모양을 설명한다", () => {
      for (const task of [buildDialogueCheckTask(), buildStyleCheckTask()]) {
        for (const key of ["topic", "description", "occurrences", "fix"]) expect(task).toContain(key);
      }
    });
  });

  describe("validateCheckFindings", () => {
    it("정상 항목은 위치가 0부터의 인덱스로 바뀌고 fix가 남는다", () => {
      const [out] = validateCheckFindings([raw()], chapters);
      expect(out.occurrences).toEqual([{ chapterNumber: 1, paragraphIndex: 0, quote: "본인은 귀하의 방문을 환영하는 바입니다." }]);
      expect(out.fix).toEqual({
        chapterNumber: 1,
        paragraphIndex: 0,
        before: "본인은 귀하의 방문을 환영하는 바입니다.",
        after: "어서 와요, 잘 오셨어요.",
        reason: "입말로",
      });
    });

    it("숫자가 사라지는 fix는 null이 되고 항목은 남는다", () => {
      const items = validateCheckFindings(
        [raw({ paragraphNumber: 2, before: "수진은 14살이었다.", after: "수진은 열네 살이었다." }, { occurrences: [{ chapterNumber: 1, paragraphNumber: 2, quote: "14살" }] })],
        chapters,
      );
      expect(items).toHaveLength(1);
      expect(items[0].fix).toBeNull();
      expect(items[0].occurrences).toHaveLength(1);
    });

    it("숫자가 그대로 있으면 fix가 남는다", () => {
      const [out] = validateCheckFindings([raw({ paragraphNumber: 2, before: "수진은 14살이었다.", after: "수진은 14살이야." })], chapters);
      expect(out.fix?.after).toBe("수진은 14살이야.");
    });

    it("숫자 때문에 버려진 fix는 자리를 차지하지 않아 뒤 항목의 겹치는 fix가 남는다", () => {
      const lostDigits = raw({ paragraphNumber: 2, before: "수진은 14살이었다.", after: "수진은 열네 살이었다." });
      const next = raw({ paragraphNumber: 2, before: "14살이었다.", after: "14살이야." }, { topic: "다음" });
      const [, second] = validateCheckFindings([lostDigits, next], chapters);
      expect(second.fix).not.toBeNull();
    });

    it("따옴표 글자가 달라지는 fix는 null이 된다", () => {
      for (const after of ["“어서 와요.”", "”어서 와요", '어서 "와요']) {
        const [out] = validateCheckFindings([raw({ after })], chapters);
        expect(out.fix).toBeNull();
        expect(out.occurrences).toHaveLength(1);
      }
    });

    it("before가 문단에 두 번 나오면 fix는 null이 된다", () => {
      const twice: MasterChapter[] = [{ chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["“응.” 그가 말했다. “응.” 그가 웃었다."] }];
      const [out] = validateCheckFindings(
        [raw({ before: "응.", after: "그래." }, { occurrences: [{ chapterNumber: 1, paragraphNumber: 1, quote: "응." }] })],
        twice,
      );
      expect(out.fix).toBeNull();
    });

    it("위치를 못 찾는 occurrence는 위치에서만 빠진다", () => {
      const [out] = validateCheckFindings(
        [raw({}, { occurrences: [{ chapterNumber: 1, paragraphNumber: 1, quote: "없는 구절" }, { chapterNumber: 9, paragraphNumber: 1, quote: "x" }] })],
        chapters,
      );
      expect(out.occurrences).toEqual([]);
      expect(out.fix).not.toBeNull();
    });

    it("빈 fix.before는 정정 제안 없음이고, 위치가 있으면 항목은 남는다", () => {
      const [out] = validateCheckFindings([raw({ before: "", after: "" })], chapters);
      expect(out.fix).toBeNull();
      expect(out.occurrences).toHaveLength(1);
    });

    it("위치도 fix도 없는 항목은 사라진다", () => {
      expect(validateCheckFindings([raw({ before: "", after: "" }, { occurrences: [] })], chapters)).toEqual([]);
    });

    it("9건을 주면 8건에서 자른다", () => {
      const nine = Array.from({ length: 9 }, (_, i) => raw({ before: "", after: "" }, { topic: `주제${i}` }));
      const out = validateCheckFindings(nine, chapters);
      expect(out).toHaveLength(8);
      expect(out.map((f) => f.topic)).toEqual(nine.slice(0, 8).map((f) => f.topic));
    });
  });
});
