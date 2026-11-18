import { describe, it, expect } from "vitest";
import {
  bodyToParagraphs,
  paragraphsToBody,
  buildSaveEdits,
  countEditedParagraphs,
  isChapterEdited,
  isValidChaptersInput,
  normalizeParagraphs,
  buildPublishedEdits,
  type MasterChapter,
} from "./masterReview";

function chapter(n: number, paragraphs: string[]): MasterChapter {
  return { chapterNumber: n, chapterTitle: `제${n}장`, paragraphs };
}

describe("bodyToParagraphs / paragraphsToBody", () => {
  it("빈 줄 기준으로 문단을 나누고 앞뒤 공백과 빈 문단을 버린다 (story-generator의 bodyToParagraphs와 같은 규칙)", () => {
    expect(bodyToParagraphs("  첫 문단.  \n\n\n\n 둘째 문단. ")).toEqual(["첫 문단.", "둘째 문단."]);
  });

  it("문단을 빈 줄 하나로 이어 body를 만든다", () => {
    expect(paragraphsToBody(["첫 문단.", "둘째 문단."])).toBe("첫 문단.\n\n둘째 문단.");
  });

  it("body → 문단 → body 왕복에서 정규화된 본문은 그대로다", () => {
    const body = "하나.\n\n둘.\n\n셋.";
    expect(paragraphsToBody(bodyToParagraphs(body))).toBe(body);
  });
});

describe("isChapterEdited / countEditedParagraphs", () => {
  const base = [chapter(1, ["a", "b"]), chapter(2, ["c", "d"])];

  it("기준과 같으면 수정되지 않은 것이다", () => {
    expect(isChapterEdited(base[0], base[0])).toBe(false);
    expect(countEditedParagraphs(base, base)).toBe(0);
  });

  it("문단 내용이 바뀐 만큼 센다", () => {
    const edited = [chapter(1, ["a", "B"]), chapter(2, ["C", "D"])];
    expect(countEditedParagraphs(edited, base)).toBe(3);
  });

  it("문단 수가 늘거나 줄어도 바뀐 챕터로 본다", () => {
    expect(isChapterEdited(chapter(1, ["a"]), base[0])).toBe(true);
    expect(isChapterEdited(chapter(1, ["a", "b", "c"]), base[0])).toBe(true);
    expect(countEditedParagraphs([chapter(1, ["a", "b", "c"]), base[1]], base)).toBe(1);
  });

  it("제목만 바뀌어도 수정된 챕터다", () => {
    expect(isChapterEdited({ ...base[0], chapterTitle: "새 제목" }, base[0])).toBe(true);
  });
});

describe("buildSaveEdits", () => {
  const baseline = [chapter(1, ["a", "b"]), chapter(2, ["c", "d"]), chapter(3, ["e"])];

  it("저장된 기준과 달라진 챕터만 body로 합쳐 돌려준다", () => {
    const current = [chapter(1, ["a", "b"]), chapter(2, ["c", "D"]), chapter(3, ["e"])];
    expect(buildSaveEdits(current, baseline)).toEqual([
      { chapterNumber: 2, chapterTitle: "제2장", body: "c\n\nD" },
    ]);
  });

  it("바뀐 게 없으면 빈 배열이다", () => {
    expect(buildSaveEdits(baseline, baseline)).toEqual([]);
  });

  it("공백뿐인 문단은 비교와 저장 본문에서 제외한다", () => {
    const onlyBlankAdded = [chapter(1, ["a", "   ", "b"]), baseline[1], baseline[2]];
    expect(buildSaveEdits(onlyBlankAdded, baseline)).toEqual([]);

    const blankAndEdit = [chapter(1, ["a", "   ", "B"]), baseline[1], baseline[2]];
    expect(buildSaveEdits(blankAndEdit, baseline)).toEqual([
      { chapterNumber: 1, chapterTitle: "제1장", body: "a\n\nB" },
    ]);
  });
});

describe("isValidChaptersInput", () => {
  it("챕터 번호와 문자열 문단 배열이 있는 챕터 목록만 통과시킨다", () => {
    expect(isValidChaptersInput([chapter(1, ["a"]), chapter(2, ["b", "c"])])).toBe(true);
  });

  it("배열이 아니거나 비어 있으면 거절한다", () => {
    expect(isValidChaptersInput(null)).toBe(false);
    expect(isValidChaptersInput([])).toBe(false);
  });

  it("형태가 틀린 챕터가 하나라도 있으면 거절한다", () => {
    expect(isValidChaptersInput([{ chapterNumber: "1", chapterTitle: "t", paragraphs: ["a"] }])).toBe(false);
    expect(isValidChaptersInput([{ chapterNumber: 1, chapterTitle: "t", paragraphs: [1] }])).toBe(false);
    expect(isValidChaptersInput([{ chapterNumber: 1, chapterTitle: 3, paragraphs: ["a"] }])).toBe(false);
  });

  it("챕터가 너무 많거나 본문이 너무 길면 거절한다 (Claude 호출 비용 방어)", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => chapter(i + 1, ["a"]));
    expect(isValidChaptersInput(tooMany)).toBe(false);
    expect(isValidChaptersInput([chapter(1, ["가".repeat(300_001)])])).toBe(false);
  });
});

describe("normalizeParagraphs", () => {
  it("문단 안의 빈 줄은 문단 나눔으로 보고, 공백뿐인 문단은 버린다", () => {
    expect(normalizeParagraphs(["첫째.\n\n둘째.", "   ", " 셋째. "])).toEqual(["첫째.", "둘째.", "셋째."]);
  });

  it("문단 안의 한 줄 바꿈은 그대로 둔다", () => {
    expect(normalizeParagraphs(["한 줄\n다음 줄"])).toEqual(["한 줄\n다음 줄"]);
  });

  it("문단 안에 빈 줄을 넣으면 수정(문단 수 변화)으로 센다", () => {
    const base = [chapter(1, ["a", "b"])];
    expect(isChapterEdited(chapter(1, ["a\n\nx", "b"]), base[0])).toBe(true);
  });
});

describe("buildPublishedEdits", () => {
  const baseline = [chapter(1, ["a", "b"]), chapter(2, ["c"])];

  it("달라진 챕터만 { num, paragraphs }로 돌려준다", () => {
    const current = [chapter(1, ["a", "B"]), chapter(2, ["c"])];
    expect(buildPublishedEdits(current, baseline)).toEqual([{ num: 1, paragraphs: ["a", "B"] }]);
  });

  it("제목만 바꾼 건 게시본 편집 대상이 아니다 (게시본은 문단만 고친다)", () => {
    const current = [{ ...baseline[0], chapterTitle: "새 제목" }, baseline[1]];
    expect(buildPublishedEdits(current, baseline)).toEqual([]);
  });

  it("문단 안에 넣은 빈 줄은 문단으로 나눠서 보낸다", () => {
    const current = [chapter(1, ["a\n\nx", "b"]), baseline[1]];
    expect(buildPublishedEdits(current, baseline)).toEqual([{ num: 1, paragraphs: ["a", "x", "b"] }]);
  });
});
