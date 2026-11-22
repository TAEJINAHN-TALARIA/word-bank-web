import { describe, it, expect } from "vitest";
import { buildCleanupBase, fetchChapterSuggestion, summarizeChapter } from "./paragraphCleanup";
import type { MasterChapter } from "./masterReview";
import type { StructureChange } from "./claude/editing";

const chapter = (chapterNumber: number, paragraphs: string[]): MasterChapter => ({
  chapterNumber,
  chapterTitle: `${chapterNumber}장 제목`,
  paragraphs,
});

describe("buildCleanupBase", () => {
  it("대사 나누기를 끄면(null) 글을 그대로 돌려준다", () => {
    const input = [chapter(1, ["그가 웃었다. “가.” 그가 말했다."])];
    const base = buildCleanupBase(input, null);
    expect(base.chapters).toEqual(input);
    expect(base.chapters).not.toBe(input);
    expect(base.skipped).toEqual({});
  });

  it("대사 나누기를 켜면 장마다 문단이 나뉘고 장 제목·번호는 그대로다", () => {
    const base = buildCleanupBase([chapter(1, ["그가 웃었다. “가.” 그가 말했다."]), chapter(2, ["평범한 문단입니다."])], "separate");
    expect(base.chapters[0]).toEqual({
      chapterNumber: 1,
      chapterTitle: "1장 제목",
      paragraphs: ["그가 웃었다.", "“가.”", "그가 말했다."],
    });
    expect(base.chapters[1]).toEqual(chapter(2, ["평범한 문단입니다."]));
    expect(base.skipped).toEqual({});
  });

  it("방식에 따라 결과가 다르다(서술 붙이기는 대사 뒤 서술을 붙인다)", () => {
    const base = buildCleanupBase([chapter(1, ["그가 웃었다. “가.” 그가 말했다."])], "attach");
    expect(base.chapters[0].paragraphs).toEqual(["그가 웃었다.", "“가.” 그가 말했다."]);
  });

  it("짝이 맞지 않는 문단이 있는 장은 skipped에 번호가 남는다", () => {
    const base = buildCleanupBase([chapter(1, ["정상입니다."]), chapter(2, ["그가 말했다. “열린 따옴표"])], "separate");
    expect(base.skipped).toEqual({ 2: [1] });
    expect(base.chapters[1].paragraphs).toEqual(["그가 말했다. “열린 따옴표"]);
  });
});

describe("fetchChapterSuggestion", () => {
  const change: StructureChange = { kind: "merge", paragraphIndex: 0, splitBefore: "", reason: "한 호흡입니다" };

  it("제안을 받으면 changes를 돌려준다", async () => {
    expect(await fetchChapterSuggestion(async () => ({ changes: [change] }))).toEqual({ changes: [change] });
    expect(await fetchChapterSuggestion(async () => ({ changes: [] }))).toEqual({ changes: [] });
  });

  it("서버가 error를 돌려주면 그 장의 오류로 남긴다", async () => {
    expect(await fetchChapterSuggestion(async () => ({ error: "지시가 너무 깁니다" }))).toEqual({ error: "지시가 너무 깁니다" });
  });

  it("error도 changes도 없으면 기본 오류 문구를 쓴다", async () => {
    expect(await fetchChapterSuggestion(async () => ({}))).toEqual({ error: "문단 구성 제안을 받지 못했습니다" });
  });

  it("호출이 예외를 던져도(네트워크 끊김·배포 중 등) 던지지 않고 그 장의 오류로 남긴다", async () => {
    expect(
      await fetchChapterSuggestion(async () => {
        throw new Error("Failed to fetch");
      }),
    ).toEqual({ error: "Failed to fetch" });
    expect(await fetchChapterSuggestion(() => Promise.reject("문자열 예외"))).toEqual({ error: "문단 구성 제안을 받지 못했습니다" });
  });
});

describe("summarizeChapter", () => {
  const split = (paragraphIndex: number, splitBefore: string): StructureChange => ({
    kind: "split",
    paragraphIndex,
    splitBefore,
    reason: "장면이 바뀝니다",
  });

  it("작업본 위의 Claude 제안(splitBefore)을 적용하고 문단 수 변화를 요약한다", () => {
    const original = chapter(1, ["첫 문장입니다. 둘째 문장입니다."]);
    const base = chapter(1, ["첫 문장입니다. 둘째 문장입니다."]);
    expect(summarizeChapter(original, base, [split(0, "둘째 문장입니다.")])).toEqual({
      chapterNumber: 1,
      before: 1,
      afterSplit: 1,
      final: ["첫 문장입니다.", "둘째 문장입니다."],
    });
  });

  it("대사 나누기로 늘어난 작업본의 문단 번호를 기준으로 제안을 적용한다", () => {
    const original = chapter(1, ["그가 웃었다. “가.” 그가 말했다. 한참 뒤 해가 졌다."]);
    const base = buildCleanupBase([original], "separate").chapters[0];
    // 작업본: ["그가 웃었다.", "“가.”", "그가 말했다. 한참 뒤 해가 졌다."] — 3번째(인덱스 2) 문단을 나눈다.
    const outcome = summarizeChapter(original, base, [split(2, "한참 뒤 해가 졌다.")]);
    expect(outcome.before).toBe(1);
    expect(outcome.afterSplit).toBe(3);
    expect(outcome.final).toEqual(["그가 웃었다.", "“가.”", "그가 말했다.", "한참 뒤 해가 졌다."]);
  });

  it("제안이 없으면 final은 작업본 문단 그대로다", () => {
    const original = chapter(2, ["가", "나"]);
    expect(summarizeChapter(original, original, [])).toEqual({ chapterNumber: 2, before: 2, afterSplit: 2, final: ["가", "나"] });
  });
});
