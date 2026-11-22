import { describe, it, expect } from "vitest";
import { ITEM_LABELS, approvalNote, chaptersKey, findPhraseLocation, scoreTone } from "./qualityCheck";
import type { MasterChapter } from "./masterReview";
import type { MasterEvaluation } from "./admin-functions/storyGenerator";

const chapters: MasterChapter[] = [
  { chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["첫 문단입니다.", "그는 어려운   구절을 읽었다."] },
  { chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["둘째 장의 문단입니다."] },
];

describe("scoreTone", () => {
  it("4~5점은 좋음, 3점은 경계, 2점 이하는 낮음", () => {
    expect(scoreTone(5)).toBe("good");
    expect(scoreTone(4)).toBe("good");
    expect(scoreTone(3)).toBe("borderline");
    expect(scoreTone(2)).toBe("low");
    expect(scoreTone(1)).toBe("low");
    expect(scoreTone(0)).toBe("low");
  });
});

describe("ITEM_LABELS", () => {
  it("심사 항목마다 한국어 이름이 있고 인물 말투는 참고용이라고 밝힌다", () => {
    for (const key of ["contentSafety", "culturalFit", "narrativeCompleteness", "characterConsistency", "chapterTransition", "levelFit", "comboFit", "technicalCleanliness", "narrativeStyleConsistency", "materialWeightFit", "characterVoiceConsistency"]) {
      expect(ITEM_LABELS[key]).toBeTruthy();
    }
    expect(ITEM_LABELS.characterVoiceConsistency).toContain("참고");
  });
});

describe("findPhraseLocation", () => {
  it("구절이 든 문단의 장 번호와 문단 인덱스(0부터)를 돌려준다", () => {
    expect(findPhraseLocation(chapters, "둘째 장의 문단")).toEqual({ chapterNumber: 2, paragraphIndex: 0 });
  });

  it("공백이 달라도(여러 칸) 공백을 정규화해서 찾는다", () => {
    expect(findPhraseLocation(chapters, "어려운 구절")).toEqual({ chapterNumber: 1, paragraphIndex: 1 });
    expect(findPhraseLocation(chapters, "  어려운   구절을  ")).toEqual({ chapterNumber: 1, paragraphIndex: 1 });
  });

  it("없는 구절과 빈 구절은 null이다", () => {
    expect(findPhraseLocation(chapters, "본문에 없는 구절")).toBeNull();
    expect(findPhraseLocation(chapters, "")).toBeNull();
    expect(findPhraseLocation(chapters, "   ")).toBeNull();
  });
});

describe("chaptersKey", () => {
  it("같은 내용이면 같고, 문단이나 장 제목이 바뀌면 다르다", () => {
    const same = chapters.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }));
    expect(chaptersKey(same)).toBe(chaptersKey(chapters));
    const paragraphChanged = [{ ...chapters[0], paragraphs: ["첫 문단입니다!", chapters[0].paragraphs[1]] }, chapters[1]];
    expect(chaptersKey(paragraphChanged)).not.toBe(chaptersKey(chapters));
    const titleChanged = [{ ...chapters[0], chapterTitle: "바뀐 제목" }, chapters[1]];
    expect(chaptersKey(titleChanged)).not.toBe(chaptersKey(chapters));
  });

  it("저장이 정규화하는 차이(빈 문단 추가, 문단 안의 빈 줄)만 있으면 같다 — 저장 뒤 화면 글이 정규화돼도 낡음으로 보지 않는다", () => {
    const withEmpty = [{ ...chapters[0], paragraphs: [chapters[0].paragraphs[0], "", chapters[0].paragraphs[1]] }, chapters[1]];
    expect(chaptersKey(withEmpty)).toBe(chaptersKey(chapters));
    const withBlankLine = [{ ...chapters[0], paragraphs: [chapters[0].paragraphs[0] + String.fromCharCode(10, 10) + "덧붙인 문단", chapters[0].paragraphs[1]] }, chapters[1]];
    expect(chaptersKey(withBlankLine)).toBe(chaptersKey([{ ...chapters[0], paragraphs: [chapters[0].paragraphs[0], "덧붙인 문단", chapters[0].paragraphs[1]] }, chapters[1]]));
  });
});

describe("approvalNote", () => {
  const item = (key: string, score: number) => ({ key, score, reason: "사유", gated: true });
  const passed: MasterEvaluation = {
    ruleBase: { pass: true, failures: [], warnings: [] },
    llm: { pass: true, failItems: [], items: [item("levelFit", 4)] },
  };

  it("점검한 적이 없으면 그렇다고 알려준다", () => {
    expect(approvalNote(null, false)).toBe("품질 점검을 아직 하지 않았어요");
  });

  it("통과하면 통과라고 한다", () => {
    expect(approvalNote(passed, false)).toBe("최근 품질 점검: 통과");
  });

  it("낮은 항목이 있으면 개수를 알려준다", () => {
    const low: MasterEvaluation = {
      ruleBase: passed.ruleBase,
      llm: { pass: false, failItems: ["levelFit", "comboFit"], items: [item("levelFit", 2), item("comboFit", 1)] },
    };
    expect(approvalNote(low, false)).toBe("최근 품질 점검: 낮은 항목 2개");
  });

  it("규칙 검사 실패와 심사 실패를 구별해서 알려준다", () => {
    const ruleFail: MasterEvaluation = { ruleBase: { pass: false, failures: ["챕터 수 3/10", "제목 접두어"], warnings: [] }, llm: null };
    expect(approvalNote(ruleFail, false)).toBe("최근 품질 점검: 규칙 검사 실패 2건");
    const judgeFail: MasterEvaluation = { ruleBase: passed.ruleBase, llm: { error: "RATE_LIMIT" } };
    expect(approvalNote(judgeFail, false)).toBe("최근 품질 점검: 심사 실패");
  });

  it("글이 바뀌었으면 다시 점검을 권한다", () => {
    expect(approvalNote(passed, true)).toBe("최근 품질 점검: 통과 · 글이 바뀌었어요, 다시 점검을 권장해요");
  });
});
