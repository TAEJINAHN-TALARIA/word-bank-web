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
  averageSentenceLength,
  insertParagraph,
  removeParagraph,
  moveParagraph,
  locateMemos,
  editedParagraphKeys,
  findUnsavableReason,
  applyPublishedEdits,
  isValidDraftEdits,
  findUnsavableDraftReason,
  canApplyToLive,
  chaptersDiffer,
  pairedParagraph,
  MAX_DRAFT_CHARS,
  type MasterChapter,
  type PreReviewItem,
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

describe("averageSentenceLength", () => {
  it("공백을 뺀 글자 수로 문장당 평균 길이를 센다", () => {
    // "가나다라마."(5) + "바사아자차."(5)
    expect(averageSentenceLength("가나다라마. 바사아자차.")).toBe(5);
  });

  it("마침표 없이 이어진 글은 한 문장으로 센다", () => {
    expect(averageSentenceLength("가나 다라 마바")).toBe(6);
  });

  it("줄바꿈도 문장 끝으로 보고, 빈 글은 0이다", () => {
    expect(averageSentenceLength("가나\n다라마")).toBe(3);
    expect(averageSentenceLength("   ")).toBe(0);
  });
});

describe("문단 구조 편집 헬퍼", () => {
  const chapters = [chapter(1, ["a", "b", "c"]), chapter(2, ["x"])];

  it("insertParagraph: 지정 위치에 빈 문단을 넣고 다른 챕터는 그대로 둔다", () => {
    const next = insertParagraph(chapters, 1, 1);
    expect(next[0].paragraphs).toEqual(["a", "", "b", "c"]);
    expect(next[1]).toBe(chapters[1]);
    expect(chapters[0].paragraphs).toEqual(["a", "b", "c"]); // 입력은 바뀌지 않는다
  });

  it("insertParagraph: 맨 뒤(at === 길이)에도 넣을 수 있다", () => {
    expect(insertParagraph(chapters, 2, 1)[1].paragraphs).toEqual(["x", ""]);
  });

  it("removeParagraph: 문단 하나를 지운다. 마지막 한 문단은 지울 수 없다", () => {
    expect(removeParagraph(chapters, 1, 1)[0].paragraphs).toEqual(["a", "c"]);
    expect(removeParagraph(chapters, 2, 0)[1].paragraphs).toEqual(["x"]);
  });

  it("moveParagraph: 두 문단의 자리를 바꾸고 범위를 벗어나면 그대로 둔다", () => {
    expect(moveParagraph(chapters, 1, 0, 1)[0].paragraphs).toEqual(["b", "a", "c"]);
    expect(moveParagraph(chapters, 1, 0, -1)[0].paragraphs).toEqual(["a", "b", "c"]);
    expect(moveParagraph(chapters, 1, 2, 3)[0].paragraphs).toEqual(["a", "b", "c"]);
  });
});

describe("locateMemos / editedParagraphKeys (문단 위치가 아니라 내용으로 추적)", () => {
  const loaded = [chapter(1, ["a", "b", "c"])];
  const memo = (paragraphIndex: number): PreReviewItem => ({ chapterNumber: 1, paragraphIndex, kind: "긴 문장", text: "t" });

  it("메모가 가리키는 문단이 그대로면 현재 위치로 다시 매겨 남긴다 (앞에 문단을 넣어도 따라간다)", () => {
    const current = [chapter(1, ["새", "a", "b", "c"])];
    expect(locateMemos([memo(2)], loaded, current)).toEqual([{ chapterNumber: 1, paragraphIndex: 3, kind: "긴 문장", text: "t" }]);
  });

  it("그 문단을 고쳤거나 지웠으면 해결된 것으로 보고 뺀다", () => {
    expect(locateMemos([memo(1)], loaded, [chapter(1, ["a", "B", "c"])])).toEqual([]);
    expect(locateMemos([memo(1)], loaded, [chapter(1, ["a", "c"])])).toEqual([]);
  });

  describe("문단을 나누거나 합쳐도 메모가 남는다", () => {
    const merged = [chapter(1, ["a b", "c"])];

    it("나눈 문단의 메모는 첫 조각에 붙는다", () => {
      expect(locateMemos([memo(0)], merged, [chapter(1, ["a", "b", "c"])])).toEqual([
        { chapterNumber: 1, paragraphIndex: 0, kind: "긴 문장", text: "t" },
      ]);
    });

    it("앞에 문단이 생기고 나눠져도 첫 조각의 현재 위치를 따라간다", () => {
      expect(locateMemos([memo(0)], merged, [chapter(1, ["x", "a", "b", "c"])])[0].paragraphIndex).toBe(1);
    });

    it("합친 문단의 메모는 합쳐진 문단에 붙는다 (메모가 첫 문단에 있었든 둘째에 있었든)", () => {
      expect(locateMemos([memo(0)], merged, [chapter(1, ["a b c"])])[0].paragraphIndex).toBe(0);
      expect(locateMemos([memo(1)], merged, [chapter(1, ["a b c"])])[0].paragraphIndex).toBe(0);
    });

    it("나눈 뒤 조각을 고쳐서 원래 문단이 더 이상 복원되지 않으면 해결된 것으로 보고 뺀다", () => {
      expect(locateMemos([memo(0)], merged, [chapter(1, ["a", "B", "c"])])).toEqual([]);
    });

    it("구조를 바꾸지 않은 다른 문단의 메모는 그대로 제 위치를 지킨다", () => {
      expect(locateMemos([memo(1)], merged, [chapter(1, ["a", "b", "c"])])[0].paragraphIndex).toBe(2);
    });
  });

  it("원본 목록에 없는 문단만 수정된 문단으로 센다 (위치가 밀려도 안 어긋난다)", () => {
    const original = [chapter(1, ["a", "b", "c"])];
    const current = [chapter(1, ["새로 씀", "a", "B", "c"])];
    expect([...editedParagraphKeys(current, original)].sort()).toEqual(["1-0", "1-2"]);
  });

  it("바뀐 게 없으면 비어 있다", () => {
    expect(editedParagraphKeys(loaded, loaded).size).toBe(0);
  });
});

describe("findUnsavableReason", () => {
  const edit = (chapterNumber: number, chapterTitle: string, body: string) => ({ chapterNumber, chapterTitle, body });

  it("저장할 수 있으면 null이다", () => {
    expect(findUnsavableReason([edit(1, "첫째", "본문")])).toBeNull();
    expect(findUnsavableReason([])).toBeNull();
  });

  it("제목이나 본문이 공백뿐이면 그 장과 이유를 알려준다", () => {
    expect(findUnsavableReason([edit(2, "  ", "본문")])).toBe("2장 제목이 비어 있어요");
    expect(findUnsavableReason([edit(3, "셋째", " \n ")])).toBe("3장 본문이 비어 있어요");
  });

  it("문제가 여럿이면 순서상 첫 문제만 알려준다", () => {
    expect(findUnsavableReason([edit(1, "첫째", "본문"), edit(4, "", ""), edit(2, "", "x")])).toBe("4장 제목이 비어 있어요");
  });
});

describe("applyPublishedEdits", () => {
  const chapters = [chapter(1, ["가", "나"]), chapter(2, ["다"])];

  it("해당 번호 챕터의 문단만 바꾸고 제목·나머지 챕터는 그대로 둔다", () => {
    const next = applyPublishedEdits(chapters, [{ num: 2, paragraphs: ["새 문단", "하나 더"] }]);
    expect(next).toEqual([chapter(1, ["가", "나"]), chapter(2, ["새 문단", "하나 더"])]);
  });

  it("문단이 비어 있는 초안은 얹지 않는다(그 장의 문단이 사라지지 않게)", () => {
    expect(applyPublishedEdits(chapters, [{ num: 1, paragraphs: [] }, { num: 2, paragraphs: ["  "] }])).toEqual(chapters);
  });

  it("없는 번호는 무시하고 입력을 바꾸지 않는다", () => {
    const snapshot = JSON.parse(JSON.stringify(chapters));
    expect(applyPublishedEdits(chapters, [{ num: 9, paragraphs: ["x"] }])).toEqual(chapters);
    applyPublishedEdits(chapters, [{ num: 1, paragraphs: ["바뀜"] }]);
    expect(chapters).toEqual(snapshot);
  });
});

describe("isValidDraftEdits", () => {
  it("빈 목록과 정상 목록은 통과한다", () => {
    expect(isValidDraftEdits([])).toBe(true);
    expect(isValidDraftEdits([{ num: 1, paragraphs: ["가"] }, { num: 2, paragraphs: ["나", ""] }])).toBe(true);
  });

  it("문단이 없거나 공백뿐인 장은 거절한다 — 그대로 열면 고칠 문단이 없어 입력창이 막힌다", () => {
    expect(isValidDraftEdits([{ num: 1, paragraphs: [] }])).toBe(false);
    expect(isValidDraftEdits([{ num: 1, paragraphs: ["  ", ""] }])).toBe(false);
  });

  it("모양이 틀리면 거절한다", () => {
    expect(isValidDraftEdits(undefined)).toBe(false);
    expect(isValidDraftEdits({ num: 1, paragraphs: ["가"] })).toBe(false);
    expect(isValidDraftEdits([{ num: 1.5, paragraphs: ["가"] }])).toBe(false);
    expect(isValidDraftEdits([{ num: "1", paragraphs: ["가"] }])).toBe(false);
    expect(isValidDraftEdits([{ num: 1, paragraphs: ["가", 2] }])).toBe(false);
    expect(isValidDraftEdits([{ num: 1, paragraphs: "가" }])).toBe(false);
    expect(isValidDraftEdits([null])).toBe(false);
  });

  it("같은 장이 두 번 나오면 거절한다", () => {
    expect(isValidDraftEdits([{ num: 1, paragraphs: ["가"] }, { num: 1, paragraphs: ["나"] }])).toBe(false);
  });

  it("글자 수 합이 상한을 넘으면 거절하고 정확히 상한이면 통과한다", () => {
    expect(isValidDraftEdits([{ num: 1, paragraphs: ["가".repeat(MAX_DRAFT_CHARS)] }])).toBe(true);
    expect(isValidDraftEdits([{ num: 1, paragraphs: ["가".repeat(MAX_DRAFT_CHARS), "나"] }])).toBe(false);
  });
});

describe("chaptersDiffer", () => {
  it("정규화하면 같은 글은 다르지 않다(문단 안 빈 줄만 다름)", () => {
    expect(chaptersDiffer([chapter(1, ["가\n\n나"])], [chapter(1, ["가", "나"])])).toBe(false);
  });

  it("제목, 문단, 챕터 수가 다르면 다르다", () => {
    expect(chaptersDiffer([{ ...chapter(1, ["가"]), chapterTitle: "바뀜" }], [chapter(1, ["가"])])).toBe(true);
    expect(chaptersDiffer([chapter(1, ["가"])], [chapter(1, ["나"])])).toBe(true);
    expect(chaptersDiffer([chapter(1, ["가"]), chapter(2, ["나"])], [chapter(1, ["가"])])).toBe(true);
  });
});

describe("pairedParagraph", () => {
  const base = [chapter(1, ["가", "나", "다"])];

  it("문단 수가 같을 때만 같은 위치의 문단을 돌려준다", () => {
    expect(pairedParagraph(base, 1, 1, 3)).toBe("나");
    expect(pairedParagraph(base, 1, 1, 4)).toBeUndefined();
  });

  it("챕터가 없거나 위치가 범위를 벗어나면 undefined다", () => {
    expect(pairedParagraph(base, 2, 0, 3)).toBeUndefined();
    expect(pairedParagraph(base, 1, 5, 3)).toBeUndefined();
  });
});

describe("자동 저장은 화면 글을 정규화하지 않고도 dirty를 맞게 계산한다", () => {
  it("빈 문단·문단 안 빈 줄이 섞인 화면 글을 정규화한 기준과 비교하면 바뀐 게 없다", () => {
    const onScreen = [chapter(1, ["가", "", "나\n\n다", "   "])];
    const baseline = onScreen.map((c) => ({ ...c, paragraphs: normalizeParagraphs(c.paragraphs) }));
    expect(buildSaveEdits(onScreen, baseline)).toEqual([]);
  });
});

describe("findUnsavableDraftReason", () => {
  it("모든 장에 글이 있으면 null이다", () => {
    expect(findUnsavableDraftReason([])).toBeNull();
    expect(findUnsavableDraftReason([{ num: 1, paragraphs: ["가"] }])).toBeNull();
  });

  it("장의 문단을 모두 지웠거나 공백뿐이면 그 장을 알려준다(첫 문제만)", () => {
    expect(findUnsavableDraftReason([{ num: 2, paragraphs: [] }])).toBe("2장 본문이 비어 있어요");
    expect(findUnsavableDraftReason([{ num: 1, paragraphs: ["가"] }, { num: 3, paragraphs: [" ", ""] }, { num: 4, paragraphs: [] }])).toBe(
      "3장 본문이 비어 있어요",
    );
  });
});

describe("canApplyToLive", () => {
  const live = [chapter(1, ["가"])];

  it("게시된 글과 다르면 반영할 수 있다", () => {
    expect(canApplyToLive([chapter(1, ["고침"])], live, false)).toBe(true);
  });

  it("게시된 글과 같으면 반영할 것이 없다", () => {
    expect(canApplyToLive(live, live, false)).toBe(false);
  });

  it("게시본이 바뀐 뒤의 옛 초안이 남아 있으면 먼저 불러오거나 버릴 때까지 반영할 수 없다(옛 초안이 조용히 지워지지 않게)", () => {
    expect(canApplyToLive([chapter(1, ["고침"])], live, true)).toBe(false);
  });
});
