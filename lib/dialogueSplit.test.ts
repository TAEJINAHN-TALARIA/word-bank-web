import { describe, it, expect } from "vitest";
import { splitDialogue, quotedRanges, type DialogueSplitMode } from "./dialogueSplit";

const attach = (p: string[]) => splitDialogue(p, "attach");

const strip = (paragraphs: string[]) => paragraphs.join("").replace(/\s/g, "");

describe("splitDialogue", () => {
  it("대사 앞에서 나누고 뒤 서술은 대사 문단에 붙인다", () => {
    expect(
      attach(["그가 문을 열었습니다. “안녕하세요.” 그는 고개를 숙였습니다. “들어오세요.” 저는 대답했습니다."]),
    ).toEqual({
      paragraphs: ["그가 문을 열었습니다.", "“안녕하세요.” 그는 고개를 숙였습니다.", "“들어오세요.” 저는 대답했습니다."],
      skipped: [],
    });
  });

  it("곧은 따옴표도 같은 규칙으로 나눈다", () => {
    expect(
      attach(['그가 문을 열었습니다. "안녕하세요." 그는 고개를 숙였습니다. "들어오세요." 저는 대답했습니다.']),
    ).toEqual({
      paragraphs: ["그가 문을 열었습니다.", '"안녕하세요." 그는 고개를 숙였습니다.', '"들어오세요." 저는 대답했습니다.'],
      skipped: [],
    });
  });

  it("굽은 따옴표와 곧은 따옴표가 한 문단에 섞여도 각자 열기·닫기로 센다", () => {
    expect(attach(['가. “나.” 다. "라." 마.'])).toEqual({
      paragraphs: ["가.", "“나.” 다.", '"라." 마.'],
      skipped: [],
    });
  });

  it("대사가 이어지면 닫는 따옴표 뒤에서도 나눈다", () => {
    expect(attach(["“가.” “나.”"])).toEqual({ paragraphs: ["“가.”", "“나.”"], skipped: [] });
  });

  it("문장 중간의 인용은 나누지 않는다", () => {
    const input = ["사회자가 마이크를 잡고 “마지막 참가 번호 7번, 윤…”라는 안내 방송을 송출했습니다. 아무도 없었습니다."];
    expect(attach(input)).toEqual({ paragraphs: input, skipped: [] });
  });

  it("쉼표로 이어진 인용은 나누지 않는다", () => {
    const input = ["수군거림이 “신청만 해놓고 나타나지 않은 건가”, “자립 지원 수혜자라더라”라는 식으로 번졌습니다."];
    expect(attach(input)).toEqual({ paragraphs: input, skipped: [] });
  });

  it("작은따옴표는 대사로 보지 않는다", () => {
    const input = ["손잡이에 ‘온전한 소리는 홀로 울리지 않는다’라고 새겨져 있었습니다. 저는 it's 끝."];
    expect(attach(input)).toEqual({ paragraphs: input, skipped: [] });
  });

  it("문단 맨 앞 대사와 이미 나뉜 문단은 그대로 둔다", () => {
    const input = ["“안녕하세요.” 그는 웃었습니다.", "다음 문단입니다."];
    expect(attach(input)).toEqual({ paragraphs: input, skipped: [] });
  });

  it("짝이 맞지 않는 문단은 건드리지 않고 번호를 돌려준다", () => {
    expect(attach(["그가 말했다. “열린 따옴표", "정상입니다. “대사.” 끝."])).toEqual({
      paragraphs: ["그가 말했다. “열린 따옴표", "정상입니다.", "“대사.” 끝."],
      skipped: [1],
    });
    expect(attach(['그가 말했다. "안녕'])).toEqual({ paragraphs: ['그가 말했다. "안녕'], skipped: [1] });
  });

  it("굽은 따옴표 대사 안에 곧은 따옴표가 들어 있으면 짝이 어긋난 것으로 보고 건너뛴다", () => {
    const input = ['그가 말했다. “그는 말했어. "가." 끝.”'];
    expect(attach(input)).toEqual({ paragraphs: input, skipped: [1] });
  });

  it("두 번 적용해도 결과가 같고 글자를 바꾸지 않는다", () => {
    const inputs = [
      ["그가 문을 열었습니다. “안녕하세요.” 그는 고개를 숙였습니다. “들어오세요.” 저는 대답했습니다."],
      ['가. “나.” 다. "라." 마.'],
      ["“가.” “나.” 그가 웃었다."],
    ];
    for (const mode of ["attach", "separate"] as DialogueSplitMode[]) {
      for (const input of inputs) {
        const first = splitDialogue(input, mode);
        expect(splitDialogue(first.paragraphs, mode).paragraphs).toEqual(first.paragraphs);
        expect(strip(first.paragraphs)).toBe(strip(input));
      }
    }
  });

  it("빈 배열은 빈 결과", () => {
    expect(attach([])).toEqual({ paragraphs: [], skipped: [] });
  });
});

describe("splitDialogue — 대사만 따로", () => {
  const separate = (p: string[]) => splitDialogue(p, "separate");

  it("대사와 서술을 따로 나눈다", () => {
    expect(
      separate(["그가 문을 열었습니다. “안녕하세요.” 그는 고개를 숙였습니다. “들어오세요.” 저는 대답했습니다."]),
    ).toEqual({
      paragraphs: ["그가 문을 열었습니다.", "“안녕하세요.”", "그는 고개를 숙였습니다.", "“들어오세요.”", "저는 대답했습니다."],
      skipped: [],
    });
  });

  it("곧은 따옴표도 같다", () => {
    expect(
      separate(['그가 문을 열었습니다. "안녕하세요." 그는 고개를 숙였습니다. "들어오세요." 저는 대답했습니다.']),
    ).toEqual({
      paragraphs: ["그가 문을 열었습니다.", '"안녕하세요."', "그는 고개를 숙였습니다.", '"들어오세요."', "저는 대답했습니다."],
      skipped: [],
    });
  });

  it("문단 맨 앞 대사도 뒤 서술과 나눈다", () => {
    expect(separate(["“안녕하세요.” 그는 웃었습니다."])).toEqual({
      paragraphs: ["“안녕하세요.”", "그는 웃었습니다."],
      skipped: [],
    });
  });

  it("대사가 이어져도 빈 조각 없이 나눈다", () => {
    expect(separate(["“가.” “나.” 그가 웃었다."])).toEqual({
      paragraphs: ["“가.”", "“나.”", "그가 웃었다."],
      skipped: [],
    });
  });

  it("따옴표에 글자가 붙으면 떼지 않는다", () => {
    expect(separate(["그가 말했다. “가자.”라고 했습니다."])).toEqual({
      paragraphs: ["그가 말했다.", "“가자.”라고 했습니다."],
      skipped: [],
    });
  });

  it("쉼표로 끝나는 대사와 문장 끝 부호 없는 대사는 떼지 않는다", () => {
    expect(separate(["그가 말했다. “가자,” 그가 말했다."])).toEqual({
      paragraphs: ["그가 말했다.", "“가자,” 그가 말했다."],
      skipped: [],
    });
    expect(separate(["그가 말했다. “가자” 하고 웃었습니다."])).toEqual({
      paragraphs: ["그가 말했다.", "“가자” 하고 웃었습니다."],
      skipped: [],
    });
  });

  it("끝 부호 뒤에 공백을 두고 이어지는 말투 표시(하고·라고…)는 떼지 않는다", () => {
    expect(separate(["그가 웃었다. “가자!” 하고 소리쳤다."])).toEqual({
      paragraphs: ["그가 웃었다.", "“가자!” 하고 소리쳤다."],
      skipped: [],
    });
    expect(separate(["그가 웃었다. “가.” 라고 말했다."])).toEqual({
      paragraphs: ["그가 웃었다.", "“가.” 라고 말했다."],
      skipped: [],
    });
    expect(separate(["그가 웃었다. “정말?” 하는 소리에 놀랐다."])).toEqual({
      paragraphs: ["그가 웃었다.", "“정말?” 하는 소리에 놀랐다."],
      skipped: [],
    });
  });

  it("문장 중간의 인용은 나누지 않는다", () => {
    const input = ["사회자가 마이크를 잡고 “마지막 참가 번호 7번, 윤…”라는 안내 방송을 송출했습니다. 아무도 없었습니다."];
    expect(separate(input)).toEqual({ paragraphs: input, skipped: [] });
  });

  it("대사만 있는 문단은 그대로 둔다", () => {
    expect(separate(["“안녕하세요.”"])).toEqual({ paragraphs: ["“안녕하세요.”"], skipped: [] });
  });

  it("짝이 맞지 않는 문단은 건너뛴다", () => {
    const input = ["그가 말했다. “열린 따옴표"];
    expect(separate(input)).toEqual({ paragraphs: input, skipped: [1] });
  });
});

describe("quotedRanges", () => {
  it("여는 따옴표부터 닫는 따옴표 다음까지의 구간을 돌려준다", () => {
    expect(quotedRanges("그가 “가자.” 했다.")).toEqual([[3, 8]]);
  });

  it("따옴표가 없으면 빈 목록이다", () => {
    expect(quotedRanges("그가 문을 열었다.")).toEqual([]);
  });

  it("곧은 따옴표 두 개는 한 구간이다", () => {
    expect(quotedRanges('그가 "가자." 했다.')).toEqual([[3, 8]]);
  });

  it("짝이 어긋나면 null이다", () => {
    expect(quotedRanges('"그가 “열린')).toBeNull();
    expect(quotedRanges("그가 “열린 따옴표")).toBeNull();
  });
});
