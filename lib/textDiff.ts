// 고쳐쓰기 화면에서 이전 버전과 내 글의 바뀐 곳을 찾는 순수 로직(어절 단위 LCS).
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서 바로 쓴다.

export type DiffSegment = { type: "same" | "del" | "ins"; text: string };

// 문단 하나를 비교하는 용도라 이 크기면 충분하다. 넘으면 화면이 멈추지 않게 비교를 생략한다.
const MAX_DIFF_CELLS = 250_000;

// 공백도 토큰으로 남겨서 이어 붙이면 원래 글이 그대로 복원된다.
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

function pushMerged(out: DiffSegment[], type: DiffSegment["type"], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

/**
 * `same`+`del`을 이으면 before, `same`+`ins`를 이으면 after가 된다.
 * 한 변경 구간에서는 지운 곳(del)이 새로 쓴 곳(ins)보다 앞에 온다.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ type: "same", text: before }] : [];
  if (!before) return [{ type: "ins", text: after }];
  if (!after) return [{ type: "del", text: before }];

  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      { type: "del", text: before },
      { type: "ins", text: after },
    ];
  }

  // lcs[i][j] = a[i:]와 b[j:]의 최장 공통 부분 수열 길이
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  let dels = "";
  let inss = "";
  const flush = () => {
    pushMerged(out, "del", dels);
    pushMerged(out, "ins", inss);
    dels = "";
    inss = "";
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      pushMerged(out, "same", a[i]);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      dels += a[i++];
    } else {
      inss += b[j++];
    }
  }
  flush();
  return out;
}
