// 편집 중인 원고를 파일(.txt)이나 인쇄용 HTML(PDF로 저장)로 내보내는 순수 로직.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 화면의 현재 원고로 바로 만든다.
import { normalizeParagraphs, type MasterChapter } from "./masterReview";

const NO_TITLE = "(제목 없음)";
const MAX_FILE_NAME_CHARS = 80;

// 게시본 txt(app/admin/(dashboard)/published/[docId]/download)와 같은 모양: 제목, "N챕. 제목", 문단 사이 빈 줄.
export function buildManuscriptText(input: { title: string | null; chapters: MasterChapter[] }): string {
  const lines = [input.title?.trim() || NO_TITLE, ""];
  for (const chapter of input.chapters) {
    lines.push(`${chapter.chapterNumber}챕. ${chapter.chapterTitle.trim() || NO_TITLE}`, "");
    for (const paragraph of normalizeParagraphs(chapter.paragraphs)) lines.push(paragraph, "");
  }
  return lines.join("\n");
}

// 제목으로 파일명을 만든다. 파일명에 못 쓰는 문자(\ / : * ? " < > | 와 제어문자)를 빼고, 남은 게 없으면 fallbackId를 쓴다.
export function manuscriptFileName(title: string | null, fallbackId: string, ext: "txt" | "pdf"): string {
  const cleaned = (title ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILE_NAME_CHARS)
    .replace(/[. ]+$/, "");
  return `${cleaned || fallbackId}.${ext}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const PRINT_STYLE = `
  @page { margin: 22mm 20mm; }
  body { font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif; color: #111; font-size: 12pt; line-height: 1.9; }
  header { margin-bottom: 14mm; }
  h1 { font-size: 22pt; margin: 0 0 4mm; }
  .level { margin: 0; color: #555; font-size: 10pt; }
  .chapter { break-before: page; }
  .chapter:first-of-type { break-before: auto; }
  h2 { font-size: 15pt; margin: 0 0 6mm; }
  p { margin: 0 0 4mm; text-indent: 1em; }
`;

// PDF로 저장할 인쇄용 문서. 사용자 글은 모두 이스케이프해서 본문이 코드로 실행되지 않게 한다.
export function buildPrintHtml(input: { title: string | null; level: string; chapters: MasterChapter[] }): string {
  const title = escapeHtml(input.title?.trim() || NO_TITLE);
  const chapters = input.chapters
    .map((chapter) => {
      const paragraphs = normalizeParagraphs(chapter.paragraphs)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("\n");
      const heading = escapeHtml(`${chapter.chapterNumber}장. ${chapter.chapterTitle.trim() || NO_TITLE}`);
      return `<section class="chapter">\n<h2>${heading}</h2>\n${paragraphs}\n</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${PRINT_STYLE}</style>
</head>
<body>
<header>
<h1>${title}</h1>
<p class="level">${escapeHtml(input.level)}</p>
</header>
${chapters}
</body>
</html>
`;
}
