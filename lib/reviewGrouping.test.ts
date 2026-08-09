import { describe, it, expect } from "vitest";
import { groupBySession, getGroupLabel } from "./reviewGrouping";

describe("groupBySession", () => {
  it("같은 sessionId를 가진 항목들을 하나의 그룹으로 묶는다", () => {
    const items = [
      { sessionId: "s1", target: "master" },
      { sessionId: "s1", target: "en" },
      { sessionId: "s2", target: "master" },
    ];

    const groups = groupBySession(items, () => "unused");

    expect(groups).toEqual([
      { key: "s1", items: [items[0], items[1]] },
      { key: "s2", items: [items[2]] },
    ]);
  });

  it("sessionId가 없으면 fallback id로 각각 독립된 그룹이 된다", () => {
    const items = [
      { sessionId: undefined, id: "doc1" },
      { sessionId: undefined, id: "doc2" },
    ];

    const groups = groupBySession(items, (item) => item.id);

    expect(groups).toEqual([
      { key: "doc1", items: [items[0]] },
      { key: "doc2", items: [items[1]] },
    ]);
  });

  it("sessionId가 빈 문자열이어도 fallback id를 쓴다(빈 문자열끼리 잘못 뭉치지 않는다)", () => {
    const items = [
      { sessionId: "", id: "doc1" },
      { sessionId: "", id: "doc2" },
    ];

    const groups = groupBySession(items, (item) => item.id);

    expect(groups).toEqual([
      { key: "doc1", items: [items[0]] },
      { key: "doc2", items: [items[1]] },
    ]);
  });

  it("그룹이 처음 등장한 위치 순서를 유지한다", () => {
    const items = [{ sessionId: "s1" }, { sessionId: "s2" }, { sessionId: "s1" }];

    const groups = groupBySession(items, () => "unused");

    expect(groups.map((g) => g.key)).toEqual(["s1", "s2"]);
  });
});

describe("getGroupLabel", () => {
  it("target이 master인 항목의 title/level을 우선 쓴다", () => {
    const group = [
      { target: "en", lang: "en", level: "Lv6", title: "English Title" },
      { target: "master", lang: "ko", level: "Lv6", title: "한국어 제목" },
    ];

    expect(getGroupLabel(group)).toEqual({ title: "한국어 제목", level: "Lv6", languageCount: 2 });
  });

  it("master가 없으면 첫 항목을 쓴다", () => {
    const group = [
      { target: "en", lang: "en", level: "Lv6", title: "English Title" },
      { target: "ja", lang: "ja", level: "Lv6", title: "日本語タイトル" },
    ];

    expect(getGroupLabel(group)).toEqual({ title: "English Title", level: "Lv6", languageCount: 2 });
  });

  it("title이 null이면 기본 문구를 쓴다", () => {
    const group = [{ target: "master", lang: "ko", level: "Lv6", title: null }];

    expect(getGroupLabel(group)).toEqual({ title: "(제목 없음)", level: "Lv6", languageCount: 1 });
  });
});
