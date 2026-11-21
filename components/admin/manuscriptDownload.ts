// 브라우저 전용: 만들어 둔 원고를 파일로 받게 하거나 인쇄 창("PDF로 저장")을 연다.
// 내용은 lib/manuscriptExport.ts(순수, 테스트됨)가 만든다.

export function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 숨은 iframe에 인쇄용 문서를 넣고 인쇄 창을 연다 — 레이아웃을 건드리지 않고 팝업 차단도 피한다.
// Chrome은 PDF 기본 파일명을 최상위 문서의 제목에서 가져오므로, 인쇄하는 동안만 제목을 원고 이름으로 바꿔 둔다.
export function printHtml(html: string, documentTitle: string): void {
  const previousTitle = document.title;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;";

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = previousTitle;
    frame.remove();
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return cleanup();
    win.onafterprint = cleanup;
    document.title = documentTitle;
    win.focus();
    win.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
  // 인쇄 창을 닫았다는 신호(afterprint)가 오지 않는 경우에도 정리한다.
  setTimeout(cleanup, 60_000);
}
