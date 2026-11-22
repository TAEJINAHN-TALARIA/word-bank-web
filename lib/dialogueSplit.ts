// 마스터 편집 화면의 "대사 나누기": 따옴표 대사 앞에서 문단을 나누는 순수 로직(규칙 기반, Claude 호출 없음).
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.

export type DialogueSplitResult = {
  /** 나눈 뒤의 전체 문단. 나눌 곳이 없는 문단은 원본 문자열 그대로다. */
  paragraphs: string[];
  /** 따옴표 짝이 맞지 않아 건드리지 않은 입력 문단의 번호(1부터). */
  skipped: number[];
};

export type DialogueSplitMode = "attach" | "separate";

type Quote = { index: number; kind: "open" | "close" };

// 마스터 본문은 굽은 “ ”와 곧은 "가 섞여 있다. 곧은 "는 모양으로 열고 닫음을 알 수 없어
// 문단 안에서 나타나는 순서대로 열기→닫기를 번갈아 센다. 짝이 어긋나면 null.
function findQuotes(text: string): Quote[] | null {
  const quotes: Quote[] = [];
  let open = false;
  let curlyOpen = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch !== "“" && ch !== "”" && ch !== '"') continue;
    // 굽은 따옴표 대사 안의 곧은 "는 닫는 것인지 안쪽 인용인지 알 수 없어 짝이 어긋난 것으로 본다.
    if (ch === '"' && curlyOpen) return null;
    const kind: Quote["kind"] = ch === "“" ? "open" : ch === "”" ? "close" : open ? "close" : "open";
    if ((kind === "open") === open) return null;
    open = kind === "open";
    curlyOpen = open && ch === "“";
    quotes.push({ index, kind });
  }
  return open ? null : quotes;
}

/**
 * 따옴표 대사의 구간 목록 — 여는 따옴표부터 닫는 따옴표까지(양 끝 포함, end는 닫는 따옴표 다음 인덱스).
 * 짝이 어긋난 글이면 안쪽·바깥을 알 수 없으므로 null.
 */
export function quotedRanges(text: string): [start: number, end: number][] | null {
  const quotes = findQuotes(text);
  if (!quotes) return null;
  const ranges: [number, number][] = [];
  for (let i = 0; i < quotes.length; i += 2) ranges.push([quotes[i].index, quotes[i + 1].index + 1]);
  return ranges;
}

// 여는 따옴표가 문장 시작 자리일 때만 나눈다. `잡고 “…”라는 안내`나 `“…”, “…”`처럼
// 문장 안에 든 인용을 쪼개면 문장이 깨지므로, 앞이 문장 끝 부호이거나 닫는 따옴표일 때로 한정한다.
// "separate"는 여기에 더해 대사가 끝난 뒤에서도 나눈다. 닫는 따옴표에 글자가 붙은(`”라고`) 경우, 쉼표로 끝난
// (`,” 그가 말했다`) 경우, 문장 끝 부호 없이 끝난 경우는 말투 표시가 대사에서 떨어져 나가므로 떼지 않는다.
function splitPoints(text: string, quotes: Quote[], mode: DialogueSplitMode): number[] {
  // 닫는 따옴표 뒤에 공백을 두고 이어지는 말투 표시(`“가자!” 하고 소리쳤다`)는 문장이 이어지므로 떼지 않는다.
  const ATTACHED_TAIL = /^\s+(?:이?라(?:고|며|는)|하(?:고|며|면서|는|자))/;
  const points: number[] = [];
  const dialogueStart: boolean[] = [];
  quotes.forEach((q, i) => {
    if (q.kind === "close") {
      const after = text.slice(q.index + 1);
      if (mode === "separate" && dialogueStart[i - 1] && /[.!?…]/.test(text[q.index - 1]) && /^\s/.test(after) && after.trim() && !ATTACHED_TAIL.test(after)) {
        points.push(q.index + 1);
      }
      return;
    }
    const before = text.slice(0, q.index).trimEnd();
    if (!before) {
      dialogueStart[i] = true;
      return;
    }
    const prev = quotes[i - 1];
    const afterClosing = prev?.kind === "close" && text.slice(prev.index + 1, q.index).trim() === "";
    if (afterClosing || /[.!?…]$/.test(before)) {
      dialogueStart[i] = true;
      points.push(q.index);
    }
  });
  return points;
}

/**
 * 대사 앞에서 문단을 나눈다. "attach"는 대사 뒤에 이어지는 서술을 그 대사 문단에 두고, "separate"는 대사만 따로 떼어 낸다.
 * 글자는 바꾸지 않고(조각 앞뒤 공백만 다듬는다) 이미 나뉜 결과에 다시 적용해도 변하지 않는다.
 */
export function splitDialogue(paragraphs: string[], mode: DialogueSplitMode): DialogueSplitResult {
  const out: string[] = [];
  const skipped: number[] = [];
  paragraphs.forEach((text, i) => {
    const quotes = findQuotes(text);
    if (!quotes) {
      skipped.push(i + 1);
      out.push(text);
      return;
    }
    const points = splitPoints(text, quotes, mode);
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
