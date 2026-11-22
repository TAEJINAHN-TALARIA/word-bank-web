// 마스터 편집 화면의 "대사 나누기": 따옴표 대사 앞에서 문단을 나누는 순수 로직(규칙 기반, Claude 호출 없음).
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.

export type DialogueSplitResult = {
  /** 나눈 뒤의 전체 문단. 나눌 곳이 없는 문단은 원본 문자열 그대로다. */
  paragraphs: string[];
  /** 따옴표 짝이 맞지 않아 건드리지 않은 입력 문단의 번호(1부터). */
  skipped: number[];
};

type Quote = { index: number; kind: "open" | "close" };

// 마스터 본문은 굽은 “ ”와 곧은 "가 섞여 있다. 곧은 "는 모양으로 열고 닫음을 알 수 없어
// 문단 안에서 나타나는 순서대로 열기→닫기를 번갈아 센다. 짝이 어긋나면 null.
function findQuotes(text: string): Quote[] | null {
  const quotes: Quote[] = [];
  let open = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch !== "“" && ch !== "”" && ch !== '"') continue;
    const kind: Quote["kind"] = ch ==="“" ? "open" : ch === "”" ? "close" : open ? "close" : "open";
    if ((kind === "open") === open) return null;
    open = kind === "open";
    quotes.push({ index, kind });
  }
  return open ? null : quotes;
}

// 여는 따옴표가 문장 시작 자리일 때만 나눈다. `잡고 “…”라는 안내`나 `“…”, “…”`처럼
// 문장 안에 든 인용을 쪼개면 문장이 깨지므로, 앞이 문장 끝 부호이거나 닫는 따옴표일 때로 한정한다.
function splitPoints(text: string, quotes: Quote[]): number[] {
  const points: number[] = [];
  quotes.forEach((q, i) => {
    if (q.kind !== "open") return;
    const before = text.slice(0, q.index).trimEnd();
    if (!before) return;
    const prev = quotes[i - 1];
    const afterClosing = prev?.kind === "close" && text.slice(prev.index + 1, q.index).trim() === "";
    if (afterClosing || /[.!?…]$/.test(before)) points.push(q.index);
  });
  return points;
}

/**
 * 대사 앞에서 문단을 나누고, 대사 뒤에 이어지는 서술은 그 대사 문단에 둔다.
 * 글자는 바꾸지 않고(조각 앞뒤 공백만 다듬는다) 이미 나뉜 결과에 다시 적용해도 변하지 않는다.
 */
export function splitDialogue(paragraphs: string[]): DialogueSplitResult {
  const out: string[] = [];
  const skipped: number[] = [];
  paragraphs.forEach((text, i) => {
    const quotes = findQuotes(text);
    if (!quotes) {
      skipped.push(i + 1);
      out.push(text);
      return;
    }
    const points = splitPoints(text, quotes);
    if (points.length === 0) {
      out.push(text);
      return;
    }
    const cuts = [0, ...points, text.length];
    for (let c = 0; c < cuts.length - 1; c++) {
      const piece = text.slice(cuts[c], cuts[c + 1]).trim();
      if (piece) out.push(piece);
    }
  });
  return { paragraphs: out, skipped };
}
