import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./structured");

import { suggestParagraph, reviewStory, generatePreReview } from "./editor";
import * as structured from "./structured";
import type { MasterChapter } from "@/lib/masterReview";

const mockCall = vi.mocked(structured.callStructured);

const chapters: MasterChapter[] = [
  { chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["하린은 문을 열었다.", "하늘이 흐렸다."] },
  { chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["할아버지가 왔다."] },
];
const base = { title: "제목", level: "Lv3", chapters, characters: [], narrativeStyle: "-했다체", levelGuidance: null };

beforeEach(() => vi.clearAllMocks());

describe("suggestParagraph", () => {
  it("대상 문단과 지시를 담아 호출하고 검증된 제안을 돌려준다 (effort medium, 본문은 context로)", async () => {
    mockCall.mockResolvedValueOnce({ reason: "짧게 했어요", after: "하린이 문을 열었다." });

    const result = await suggestParagraph({ ...base, chapterNumber: 1, paragraphIndex: 0, instruction: "문장 짧게" });

    expect(result).toEqual({ kind: "suggestion", reason: "짧게 했어요", after: "하린이 문을 열었다." });
    const call = mockCall.mock.calls[0][0];
    expect(call.effort).toBe("medium");
    expect(call.context).toContain("[1] 하린은 문을 열었다.");
    expect(call.task).toContain("1장 1문단");
    expect(call.task).toContain("문장 짧게");
  });

  it("모델이 원문 그대로 돌려주면 noChange다", async () => {
    mockCall.mockResolvedValueOnce({ reason: "이미 자연스러워요", after: "하린은 문을 열었다." });
    const result = await suggestParagraph({ ...base, chapterNumber: 1, paragraphIndex: 0, instruction: "더 자연스럽게" });
    expect(result).toEqual({ kind: "noChange", reason: "이미 자연스러워요" });
  });

  it("없는 문단을 가리키면 Claude를 부르지 않고 오류를 던진다", async () => {
    await expect(suggestParagraph({ ...base, chapterNumber: 9, paragraphIndex: 0, instruction: "x" })).rejects.toThrow();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("문단 구조를 바꾸는 제안(빈 줄)은 오류로 막는다", async () => {
    mockCall.mockResolvedValueOnce({ reason: "나눴어요", after: "하나.\n\n둘." });
    await expect(suggestParagraph({ ...base, chapterNumber: 1, paragraphIndex: 0, instruction: "x" })).rejects.toThrow(/문단/);
  });
});

describe("reviewStory", () => {
  it("effort high로 호출하고 위치를 인덱스로 바꾸며 없는 위치는 버린다", async () => {
    mockCall.mockResolvedValueOnce({
      title: "전체 흐름",
      items: [
        { chapterNumber: 1, paragraphNumber: 2, text: "정상" },
        { chapterNumber: 7, paragraphNumber: 1, text: "없는 챕터" },
      ],
    });

    const result = await reviewStory({ ...base, kind: "flow" });

    expect(mockCall.mock.calls[0][0].effort).toBe("high");
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
  });
});
