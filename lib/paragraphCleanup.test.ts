import { describe, it, expect } from "vitest";
import {
  buildCleanupBase,
  fetchChapterSuggestion,
  fetchFactCheck,
  fetchCheck,
  fetchChapterPolish,
  applyFactFixes,
  applyCheckFixes,
  applyPolishes,
  summarizeChapter,
} from "./paragraphCleanup";
import type { MasterChapter } from "./masterReview";
import type { StructureChange } from "./claude/editing";
import type { FactFinding, FactFix } from "./claude/preprocessing";

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

describe("fetchCheck", () => {
  const finding: FactFinding = { topic: "대사", description: "공문식", occurrences: [], fix: null };
  const failed = "대사 구어체 점검을 받지 못했습니다";

  it("성공하면 { findings }, 빈 배열도 정상이다", async () => {
    expect(await fetchCheck(async () => ({ findings: [finding] }), failed)).toEqual({ findings: [finding] });
    expect(await fetchCheck(async () => ({ findings: [] }), failed)).toEqual({ findings: [] });
  });

  it("{ error }는 그대로, findings가 없으면 넘긴 기본 문구", async () => {
    expect(await fetchCheck(async () => ({ error: "응답이 너무 길어요" }), failed)).toEqual({ error: "응답이 너무 길어요" });
    expect(await fetchCheck(async () => ({}), failed)).toEqual({ error: failed });
  });

  it("호출이 던지면 예외 메시지(Error), 아니면 기본 문구로 바꿔 던지지 않는다", async () => {
    expect(
      await fetchCheck(async () => {
        throw new Error("네트워크 끊김");
      }, failed),
    ).toEqual({ error: "네트워크 끊김" });
    expect(await fetchCheck(() => Promise.reject("문자열 예외"), failed)).toEqual({ error: failed });
  });
});

describe("fetchFactCheck", () => {
  const finding: FactFinding = { topic: "나이", description: "충돌", occurrences: [], fix: null };

  it("정상 응답은 항목을 그대로 돌려준다(빈 배열도 정상이다)", async () => {
    expect(await fetchFactCheck(async () => ({ findings: [finding] }))).toEqual({ findings: [finding] });
    expect(await fetchFactCheck(async () => ({ findings: [] }))).toEqual({ findings: [] });
  });

  it("서버가 error를 돌려주면 그 문구를 쓴다", async () => {
    expect(await fetchFactCheck(async () => ({ error: "응답이 너무 길어요" }))).toEqual({ error: "응답이 너무 길어요" });
  });

  it("error도 findings도 없으면 기본 문구를 쓴다", async () => {
    expect(await fetchFactCheck(async () => ({}))).toEqual({ error: "사실관계 점검을 받지 못했습니다" });
  });

  it("호출이 던지면 메시지를, 문자열로 reject하면 기본 문구를 쓴다", async () => {
    expect(
      await fetchFactCheck(async () => {
        throw new Error("네트워크가 끊겼어요");
      }),
    ).toEqual({ error: "네트워크가 끊겼어요" });
    expect(await fetchFactCheck(() => Promise.reject("문자열 예외"))).toEqual({ error: "사실관계 점검을 받지 못했습니다" });
  });
});

describe("fetchChapterPolish", () => {
  const change = { paragraphIndex: 0, before: "아주 ", after: "", reason: "군더더기" };

  it("정상 응답은 항목과 받은 개수를 돌려준다", async () => {
    expect(await fetchChapterPolish(async () => ({ changes: [change], received: 2 }))).toEqual({ changes: [change], received: 2 });
    expect(await fetchChapterPolish(async () => ({ changes: [], received: 0 }))).toEqual({ changes: [], received: 0 });
  });

  it("서버가 error를 돌려주면 그 문구를 쓴다", async () => {
    expect(await fetchChapterPolish(async () => ({ error: "지시가 너무 깁니다" }))).toEqual({ error: "지시가 너무 깁니다" });
  });

  it("error도 changes도 없으면 기본 문구를 쓴다", async () => {
    expect(await fetchChapterPolish(async () => ({}))).toEqual({ error: "문장 다듬기를 받지 못했습니다" });
  });

  it("호출이 던지면 메시지를, 문자열로 reject하면 기본 문구를 쓴다", async () => {
    expect(
      await fetchChapterPolish(async () => {
        throw new Error("네트워크가 끊겼어요");
      }),
    ).toEqual({ error: "네트워크가 끊겼어요" });
    expect(await fetchChapterPolish(() => Promise.reject("문자열 예외"))).toEqual({ error: "문장 다듬기를 받지 못했습니다" });
  });
});

describe("applyCheckFixes", () => {
  const fix = (chapterNumber: number, paragraphIndex: number, before: string, after: string): FactFix => ({
    chapterNumber,
    paragraphIndex,
    before,
    after,
    reason: "r",
  });

  it("서로 다른 문단의 정정은 모두 적용되고 입력은 바뀌지 않는다", () => {
    const input = [chapter(1, ["가나다", "라마바"]), chapter(2, ["사아자"])];
    const snapshot = JSON.parse(JSON.stringify(input));
    const { chapters, skipped } = applyCheckFixes(input, [fix(1, 1, "마", "먀"), fix(2, 0, "아", "야")]);
    expect(chapters).toEqual([chapter(1, ["가나다", "라먀바"]), chapter(2, ["사야자"])]);
    expect(skipped).toBe(0);
    expect(input).toEqual(snapshot);
  });

  it("같은 문단의 겹치지 않는 정정 둘이 모두 적용된다", () => {
    const { chapters, skipped } = applyCheckFixes([chapter(1, ["하나 둘 셋"])], [fix(1, 0, "하나", "일"), fix(1, 0, "셋", "삼")]);
    expect(chapters[0].paragraphs).toEqual(["일 둘 삼"]);
    expect(skipped).toBe(0);
  });

  it("앞 정정이 before를 바꿔 뒤 정정의 before가 사라지면 뒤 정정만 건너뛰고 센다", () => {
    const { chapters, skipped } = applyCheckFixes([chapter(1, ["본인은 환영하는 바입니다."])], [
      fix(1, 0, "본인은 환영하는 바입니다.", "어서 와요."),
      fix(1, 0, "환영하는 바입니다.", "반가워요."),
    ]);
    expect(chapters[0].paragraphs).toEqual(["어서 와요."]);
    expect(skipped).toBe(1);
  });

  it("순서를 바꾸면 어느 쪽이 적용되는지도 달라진다(주어진 순서대로)", () => {
    const a = fix(1, 0, "본인은 환영하는 바입니다.", "어서 와요.");
    const b = fix(1, 0, "환영하는 바입니다.", "반가워요.");
    const input = [chapter(1, ["본인은 환영하는 바입니다."])];
    expect(applyCheckFixes(input, [a, b]).chapters[0].paragraphs).toEqual(["어서 와요."]);
    expect(applyCheckFixes(input, [b, a]).chapters[0].paragraphs).toEqual(["본인은 반가워요."]);
    expect(applyCheckFixes(input, [b, a]).skipped).toBe(1);
  });

  it("before가 문단에 두 번 나오거나 없으면 건너뛴다", () => {
    const input = [chapter(1, ["응 응", "다른 글"])];
    const { chapters, skipped } = applyCheckFixes(input, [fix(1, 0, "응", "네"), fix(1, 1, "없는 구절", "x"), fix(9, 0, "응", "네")]);
    expect(chapters).toEqual(input);
    expect(skipped).toBe(3);
  });

  it("정정이 없으면 같은 내용의 복사본을 돌려준다", () => {
    const input = [chapter(1, ["가나다"])];
    const { chapters, skipped } = applyCheckFixes(input, []);
    expect(chapters).toEqual(input);
    expect(chapters).not.toBe(input);
    expect(chapters[0].paragraphs).not.toBe(input[0].paragraphs);
    expect(skipped).toBe(0);
  });
});

describe("applyFactFixes / applyPolishes", () => {
  const fix = (chapterNumber: number, paragraphIndex: number, before: string, after: string): FactFix => ({
    chapterNumber,
    paragraphIndex,
    before,
    after,
    reason: "r",
  });

  it("applyFactFixes: 고른 정정만 해당 문단에 적용하고 입력은 바꾸지 않는다", () => {
    const input = [chapter(1, ["수진은 14살이었다.", "다른 문단"]), chapter(2, ["열여섯 살의 수진이 왔다."])];
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = applyFactFixes(input, [fix(2, 0, "열여섯 살", "열네 살")]);
    expect(out).toEqual([chapter(1, ["수진은 14살이었다.", "다른 문단"]), chapter(2, ["열네 살의 수진이 왔다."])]);
    expect(input).toEqual(snapshot);
  });

  it("applyFactFixes: 정정이 없으면 같은 내용의 복사본을 돌려준다", () => {
    const input = [chapter(1, ["가나다"])];
    const out = applyFactFixes(input, []);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out[0].paragraphs).not.toBe(input[0].paragraphs);
  });

  it("applyPolishes: 수신한 장만 바뀌고 오류만 있는 장과 항목이 없는 장은 그대로다", () => {
    const input = [
      chapter(1, ["그녀는 아주 조용히 걸었다."]),
      chapter(2, ["그녀는 아주 조용히 걸었다."]),
      chapter(3, ["그녀는 아주 조용히 걸었다."]),
      chapter(4, ["그녀는 아주 조용히 걸었다."]),
    ];
    const out = applyPolishes(input, {
      1: { changes: [{ paragraphIndex: 0, before: "아주 ", after: "", reason: "r" }], received: 1 },
      2: { error: "실패" },
      3: { changes: [], received: 0 },
    });
    expect(out[0].paragraphs).toEqual(["그녀는 조용히 걸었다."]);
    expect(out[1]).toEqual(input[1]);
    expect(out[2]).toEqual(input[2]);
    expect(out[3]).toEqual(input[3]);
    expect(input[0].paragraphs).toEqual(["그녀는 아주 조용히 걸었다."]);
  });

  it("통합: ④ 정정이 반영된 글에서 ③이 돌고, 그 결과에 대사 나누기가 적용된다", () => {
    const input = [
      chapter(1, ["그녀는 아주 조용히 걸었다. “가자.” 수진은 14살이었다."]),
      chapter(2, ["열여섯 살의 수진이 왔다."]),
    ];
    const afterFacts = applyFactFixes(input, [fix(2, 0, "열여섯 살", "열네 살")]);
    const polished = applyPolishes(afterFacts, {
      1: { changes: [{ paragraphIndex: 0, before: "아주 ", after: "", reason: "r" }], received: 1 },
    });
    const base = buildCleanupBase(polished, "separate");
    expect(base.chapters[0].paragraphs).toEqual(["그녀는 조용히 걸었다.", "“가자.”", "수진은 14살이었다."]);
    expect(base.chapters[1].paragraphs).toEqual(["열네 살의 수진이 왔다."]);
  });
});
