import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./structured");

import { suggestIdeas, polishParagraph, reviewStory, generatePreReview, suggestStructure, polishChapter, checkFacts } from "./editor";
import { SYSTEM_PROMPT, IDEAS_SYSTEM_PROMPT, POLISH_SYSTEM_PROMPT, STRUCTURE_SYSTEM_PROMPT } from "./editing";
import { CHAPTER_POLISH_SYSTEM_PROMPT, FACTS_SYSTEM_PROMPT } from "./preprocessing";
import * as structured from "./structured";
import type { MasterChapter } from "@/lib/masterReview";

const mockCall = vi.mocked(structured.callStructured);

const chapters: MasterChapter[] = [
  { chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["하린은 문을 열었다.", "하늘이 흐렸다. 비가 올 것 같았다."] },
  { chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["할아버지가 왔다."] },
];
const base = { title: "제목", level: "Lv3", chapters, characters: [], narrativeStyle: "-했다체", levelGuidance: null };

beforeEach(() => vi.clearAllMocks());

describe("suggestIdeas", () => {
  it("방향 제시 전용 시스템 프롬프트로 호출하고, 본문은 context로 대상 문단은 task로 넘긴다", async () => {
    mockCall.mockResolvedValueOnce({ ideas: [{ title: "젖지 않은 우산", sketch: "물이 안 떨어진다", link: "7장" }] });

    const ideas = await suggestIdeas({ ...base, chapterNumber: 1, paragraphIndex: 1, instruction: "더 긴장되게" });

    expect(ideas).toEqual([{ title: "젖지 않은 우산", sketch: "물이 안 떨어진다", link: "7장" }]);
    const call = mockCall.mock.calls[0][0];
    expect(call.system).toBe(IDEAS_SYSTEM_PROMPT);
    expect(call.effort).toBe("medium");
    expect(call.context).toContain("[2] 하늘이 흐렸다.");
    expect(call.task).toContain("1장 2문단");
    expect(call.task).toContain("더 긴장되게");
  });

  it("없는 문단이면 Claude를 부르지 않고 오류를 던진다", async () => {
    await expect(suggestIdeas({ ...base, chapterNumber: 9, paragraphIndex: 0 })).rejects.toThrow();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("쓸 수 있는 아이디어가 없으면 오류다", async () => {
    mockCall.mockResolvedValueOnce({ ideas: [{ title: "", sketch: "", link: "" }] });
    await expect(suggestIdeas({ ...base, chapterNumber: 1, paragraphIndex: 0 })).rejects.toThrow(/아이디어/);
  });
});

describe("polishParagraph", () => {
  it("다듬기 전용 시스템 프롬프트로 호출하고 고른 방향과 거절한 제안을 함께 보낸다", async () => {
    mockCall.mockResolvedValueOnce({ changes: [] });

    await polishParagraph({
      ...base,
      chapterNumber: 1,
      paragraphIndex: 1,
      direction: { title: "젖지 않은 우산", sketch: "물이 안 떨어진다" },
      rejected: [{ before: "비가 올", after: "비가 내릴" }],
    });

    const call = mockCall.mock.calls[0][0];
    expect(call.system).toBe(POLISH_SYSTEM_PROMPT);
    expect(call.task).toContain("젖지 않은 우산");
    expect(call.task).toContain("비가 올 → 비가 내릴");
    expect(call.task).toContain("하늘이 흐렸다. 비가 올 것 같았다.");
  });

  it("현재 글에 없는 인용이나 겹치는 항목은 걸러서 돌려준다", async () => {
    mockCall.mockResolvedValueOnce({
      changes: [
        { before: "하늘이 흐렸다.", after: "하늘이 잔뜩 흐렸다.", reason: "강조" },
        { before: "글에 없는 구절", after: "x", reason: "엉뚱함" },
      ],
    });

    const changes = await polishParagraph({ ...base, chapterNumber: 1, paragraphIndex: 1 });

    expect(changes).toEqual([{ before: "하늘이 흐렸다.", after: "하늘이 잔뜩 흐렸다.", reason: "강조" }]);
  });

  it("고칠 곳이 없으면 빈 배열이다", async () => {
    mockCall.mockResolvedValueOnce({ changes: [] });
    expect(await polishParagraph({ ...base, chapterNumber: 2, paragraphIndex: 0 })).toEqual([]);
  });

  it("없는 문단이면 Claude를 부르지 않고 오류를 던진다", async () => {
    await expect(polishParagraph({ ...base, chapterNumber: 2, paragraphIndex: 5 })).rejects.toThrow();
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe("suggestStructure", () => {
  it("문단 구성 전용 시스템 프롬프트로 호출하고, 본문은 context로 대상 챕터와 지시는 task로 넘긴다", async () => {
    mockCall.mockResolvedValueOnce({
      changes: [{ kind: "split", paragraphNumber: 2, splitBefore: "비가 올 것 같았다.", reason: "호흡이 길다" }],
    });

    const changes = await suggestStructure({ ...base, chapterNumber: 1, instruction: "대사 단위로" });

    expect(changes).toEqual([{ kind: "split", paragraphIndex: 1, splitBefore: "비가 올 것 같았다.", reason: "호흡이 길다" }]);
    const call = mockCall.mock.calls[0][0];
    expect(call.system).toBe(STRUCTURE_SYSTEM_PROMPT);
    expect(call.effort).toBe("medium");
    expect(call.context).toContain("[2] 하늘이 흐렸다.");
    expect(call.task).toContain("1장");
    expect(call.task).toContain("대사 단위로");
  });

  it("검증에서 걸러진 항목(없는 문단, 문단에 없는 나눌 문장)은 돌려주지 않는다", async () => {
    mockCall.mockResolvedValueOnce({
      changes: [
        { kind: "split", paragraphNumber: 9, splitBefore: "x", reason: "없는 문단" },
        { kind: "split", paragraphNumber: 2, splitBefore: "글에 없는 문장.", reason: "엉뚱함" },
      ],
    });
    expect(await suggestStructure({ ...base, chapterNumber: 1 })).toEqual([]);
  });

  it("없는 챕터면 Claude를 부르지 않고 오류를 던진다", async () => {
    await expect(suggestStructure({ ...base, chapterNumber: 9 })).rejects.toThrow();
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe("reviewStory", () => {
  it("점검용 시스템 프롬프트, effort high로 호출하고 위치를 인덱스로 바꾸며 없는 위치는 버린다", async () => {
    mockCall.mockResolvedValueOnce({
      title: "전체 흐름",
      items: [
        { chapterNumber: 1, paragraphNumber: 2, text: "정상" },
        { chapterNumber: 7, paragraphNumber: 1, text: "없는 챕터" },
      ],
    });

    const result = await reviewStory({ ...base, kind: "flow" });

    expect(mockCall.mock.calls[0][0].effort).toBe("high");
    expect(mockCall.mock.calls[0][0].system).toBe(SYSTEM_PROMPT);
    expect(result).toEqual({ title: "전체 흐름", items: [{ chapterNumber: 1, paragraphIndex: 1, text: "정상" }] });
  });

  it("제목이 비어 오면 점검 종류의 기본 제목을 쓴다", async () => {
    mockCall.mockResolvedValueOnce({ title: " ", items: [] });
    expect((await reviewStory({ ...base, kind: "seeds" })).title).toBe("복선 회수 점검");
  });
});

describe("generatePreReview", () => {
  it("메모를 화면 타입(paragraphIndex)으로 바꿔 돌려준다", async () => {
    mockCall.mockResolvedValueOnce({
      items: [{ chapterNumber: 2, paragraphNumber: 1, kind: "긴 문장", text: "길어요" }],
    });

    expect(await generatePreReview(base)).toEqual([{ chapterNumber: 2, paragraphIndex: 0, kind: "긴 문장", text: "길어요" }]);
    expect(mockCall.mock.calls[0][0].effort).toBe("high");
    expect(mockCall.mock.calls[0][0].system).toBe(SYSTEM_PROMPT);
  });
});

describe("polishChapter", () => {
  it("장 다듬기 전용 프롬프트로 호출하고 유효한 항목만 받은 개수와 함께 돌려준다", async () => {
    mockCall.mockResolvedValueOnce({
      changes: [
        { paragraphNumber: 2, before: "비가 올 것 같았다", after: "비가 올 듯했다", reason: "간결" },
        { paragraphNumber: 2, before: "글에 없는 구절", after: "x", reason: "엉뚱함" },
      ],
    });

    const result = await polishChapter({ ...base, chapterNumber: 1, instruction: "더 짧게" });

    expect(result).toEqual({
      changes: [{ paragraphIndex: 1, before: "비가 올 것 같았다", after: "비가 올 듯했다", reason: "간결" }],
      received: 2,
    });
    const call = mockCall.mock.calls[0][0];
    expect(call.system).toBe(CHAPTER_POLISH_SYSTEM_PROMPT);
    expect(call.effort).toBe("medium");
    expect(call.context).toContain("[2] 하늘이 흐렸다.");
    expect(call.task).toContain("1장 전체 문단");
    expect(call.task).toContain("더 짧게");
  });

  it("없는 장이면 Claude를 부르지 않고 오류를 던진다", async () => {
    await expect(polishChapter({ ...base, chapterNumber: 9 })).rejects.toThrow();
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe("checkFacts", () => {
  it("전체 원고를 high effort로 보내고 검증된 항목만 돌려준다", async () => {
    const fix = { chapterNumber: 2, paragraphNumber: 1, before: "할아버지", after: "할머니", reason: "처음 나온 값" };
    mockCall.mockResolvedValueOnce({
      findings: [
        {
          topic: "방문자",
          description: "설명",
          occurrences: [
            { chapterNumber: 1, paragraphNumber: 1, quote: "하린" },
            { chapterNumber: 2, paragraphNumber: 1, quote: "할아버지" },
          ],
          fix,
        },
        { topic: "엉뚱함", description: "d", occurrences: [{ chapterNumber: 1, paragraphNumber: 1, quote: "없는 구절" }], fix: { ...fix, before: "" } },
      ],
    });

    const result = await checkFacts(base);

    expect(result).toEqual([
      {
        topic: "방문자",
        description: "설명",
        occurrences: [
          { chapterNumber: 1, paragraphIndex: 0, quote: "하린" },
          { chapterNumber: 2, paragraphIndex: 0, quote: "할아버지" },
        ],
        fix: { chapterNumber: 2, paragraphIndex: 0, before: "할아버지", after: "할머니", reason: "처음 나온 값" },
      },
    ]);
    const call = mockCall.mock.calls[0][0];
    expect(call.system).toBe(FACTS_SYSTEM_PROMPT);
    expect(call.effort).toBe("high");
    expect(call.context).toContain("## 2장. 둘째");
    expect(call.context).toContain("## 1장. 첫째");
  });
});
