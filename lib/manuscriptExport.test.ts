import { describe, it, expect } from "vitest";
import { buildManuscriptText, buildPrintHtml, manuscriptFileName } from "./manuscriptExport";
import type { MasterChapter } from "./masterReview";

const chapter = (n: number, title: string, paragraphs: string[]): MasterChapter => ({
  chapterNumber: n,
  chapterTitle: title,
  paragraphs,
});

describe("buildManuscriptText", () => {
  it("제목, 챕터 제목, 문단 순으로 빈 줄을 두고 적는다(기존 게시본 txt와 같은 모양)", () => {
    const text = buildManuscriptText({
      title: "제목",
      chapters: [chapter(1, "첫째", ["가", "나"]), chapter(2, "둘째", ["다"])],
    });
    expect(text).toBe("제목\n\n1챕. 첫째\n\n가\n\n나\n\n2챕. 둘째\n\n다\n");
  });

  it("빈 문단과 공백뿐인 문단은 내보내지 않는다", () => {
    const text = buildManuscriptText({ title: "제목", chapters: [chapter(1, "첫째", ["가", "", "  \n ", "나"])] });
    expect(text).toBe("제목\n\n1챕. 첫째\n\n가\n\n나\n");
  });

  it("문단 안의 빈 줄은 저장할 때처럼 문단 나눔으로 푼다", () => {
    const text = buildManuscriptText({ title: "제목", chapters: [chapter(1, "첫째", ["가\n\n나"])] });
    expect(text).toBe("제목\n\n1챕. 첫째\n\n가\n\n나\n");
  });

  it("제목이 없으면 (제목 없음)으로 적는다", () => {
    const text = buildManuscriptText({ title: null, chapters: [chapter(1, "", ["가"])] });
    expect(text).toBe("(제목 없음)\n\n1챕. (제목 없음)\n\n가\n");
  });
});

describe("manuscriptFileName", () => {
  it("제목에 확장자를 붙인다", () => {
    expect(manuscriptFileName("달빛 우산", "abc", "txt")).toBe("달빛 우산.txt");
  });

  it("파일명에 쓸 수 없는 문자는 뺀다", () => {
    expect(manuscriptFileName('a/b:c?"d', "id1", "pdf")).toBe("abcd.pdf");
    expect(manuscriptFileName("a\\b*c<d>e|f", "id1", "txt")).toBe("abcdef.txt");
  });

  it("제목이 없거나 문자가 모두 빠지면 id를 쓴다", () => {
    expect(manuscriptFileName(null, "id1", "txt")).toBe("id1.txt");
    expect(manuscriptFileName("   ", "id1", "txt")).toBe("id1.txt");
    expect(manuscriptFileName('?*:"', "id1", "pdf")).toBe("id1.pdf");
  });

  it("80자를 넘는 제목은 80자로 자른다", () => {
    const name = manuscriptFileName("가".repeat(120), "id1", "txt");
    expect(name).toBe(`${"가".repeat(80)}.txt`);
  });
});

describe("buildPrintHtml", () => {
  const html = buildPrintHtml({
    title: "<b>제</b>",
    level: "Lv3",
    chapters: [chapter(1, "첫째", ["<script>alert(1)</script> & 끝", "둘째 문단"]), chapter(2, "둘째 장", ["다"])],
  });

  it("본문과 제목의 HTML 특수문자를 이스케이프해 코드로 실행되지 않게 한다", () => {
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; 끝");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<title>&lt;b&gt;제&lt;/b&gt;</title>");
  });

  it("챕터 제목이 순서대로 나오고 문단마다 <p>로 나뉜다", () => {
    expect(html.indexOf("첫째")).toBeGreaterThan(-1);
    expect(html.indexOf("첫째")).toBeLessThan(html.indexOf("둘째 장"));
    expect(html).toContain("<p>둘째 문단</p>");
    expect(html).toContain("<p>다</p>");
  });

  it("레벨을 머리글에 적고, 완전한 HTML 문서다", () => {
    expect(html).toContain("Lv3");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("빈 문단은 <p>로 내보내지 않는다", () => {
    const out = buildPrintHtml({ title: "제목", level: "Lv1", chapters: [chapter(1, "첫째", ["가", "  ", ""])] });
    expect(out.match(/<p>/g)).toHaveLength(1);
  });
});
