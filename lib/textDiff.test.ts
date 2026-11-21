import { describe, it, expect } from "vitest";
import { diffWords, type DiffSegment } from "./textDiff";

const join = (segments: DiffSegment[], ...types: DiffSegment["type"][]) =>
  segments.filter((s) => types.includes(s.type)).map((s) => s.text).join("");

const BEFORE = "하늘이 흐렸다. 비가 올 것 같았다. 하린은 우산을 하나 꺼내 가게 앞에 놓았다.";
const AFTER =
  "하늘이 낮고 어두웠다. 바람에서 비 냄새가 났다. 하린은 우산을 하나 꺼내 가게 앞에 놓았다. 그때 간판 위로 첫 빗방울이 떨어졌다.";

describe("diffWords", () => {
  it("같은 글이면 same 하나다", () => {
    expect(diffWords("가 나", "가 나")).toEqual([{ type: "same", text: "가 나" }]);
  });

  it("빈 글은 비교할 것이 없거나 통째로 새로 쓴 것이다", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("", "새 글")).toEqual([{ type: "ins", text: "새 글" }]);
    expect(diffWords("옛 글", "")).toEqual([{ type: "del", text: "옛 글" }]);
  });

  it("바뀐 문장은 del/ins로, 그대로인 문장은 same으로 나온다", () => {
    const segments = diffWords(BEFORE, AFTER);
    expect(segments.some((s) => s.type === "same" && s.text.includes("하린은 우산을 하나 꺼내 가게 앞에 놓았다."))).toBe(true);
    expect(join(segments, "del")).toContain("흐렸다.");
    // 어절 사이의 공백은 양쪽에 공통이라 same이 되므로, 이어 붙인 del에는 공백이 없다.
    expect(join(segments, "del")).toContain("같았다.");
    expect(segments.some((s) => s.type === "ins" && s.text.includes("그때 간판 위로 첫 빗방울이 떨어졌다."))).toBe(true);
  });

  it("same+del을 이으면 이전 글, same+ins를 이으면 새 글이 된다(공백·줄바꿈 포함)", () => {
    const pairs: [string, string][] = [
      [BEFORE, AFTER],
      ["가  나\n\n다", "가 나\n다 라"],
      ["하나 둘 셋", "하나 셋"],
      ["하나 셋", "하나 둘 셋"],
      ["완전히 다른 글", "전혀 새로운 문장입니다"],
      [" 앞뒤 공백 ", "앞뒤 공백"],
    ];
    for (const [before, after] of pairs) {
      const segments = diffWords(before, after);
      expect(join(segments, "same", "del")).toBe(before);
      expect(join(segments, "same", "ins")).toBe(after);
    }
  });

  it("같은 종류가 이어지면 하나로 합친다", () => {
    const segments = diffWords(BEFORE, AFTER);
    segments.forEach((s, i) => {
      if (i > 0) expect(s.type).not.toBe(segments[i - 1].type);
    });
  });

  it("한 변경 구간에서는 del이 ins보다 앞에 온다", () => {
    expect(diffWords("가 나 다", "가 라 다")).toEqual([
      { type: "same", text: "가 " },
      { type: "del", text: "나" },
      { type: "ins", text: "라" },
      { type: "same", text: " 다" },
    ]);
  });

  it("끝에 어절만 더하면 ins 하나만 늘어난다", () => {
    expect(diffWords("가 나", "가 나 다")).toEqual([
      { type: "same", text: "가 나" },
      { type: "ins", text: " 다" },
    ]);
  });

  it("너무 긴 글은 비교를 생략하고 통째로 바뀐 것으로 본다", () => {
    const before = Array.from({ length: 600 }, (_, i) => `옛${i}`).join(" ");
    const after = Array.from({ length: 600 }, (_, i) => `새${i}`).join(" ");
    expect(diffWords(before, after)).toEqual([
      { type: "del", text: before },
      { type: "ins", text: after },
    ]);
  });
});
