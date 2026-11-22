# 대사 나누기 방식 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `대사 나누기`에 `대사만 따로`(기본)와 `서술 붙이기` 두 방식을 고르게 한다.

**Architecture:** `splitDialogue`에 `mode` 인자를 더해 `separate`일 때만 대사가 끝난 뒤의 분할점을 추가한다. `DialogueSplit`은 두 방식의 결과를 모두 계산해 버튼에 문단 수를 보여 주고 고른 방식을 미리 보기에 쓴다.

**Tech Stack:** TypeScript, React(클라이언트 컴포넌트), Vitest(node 환경, 컴포넌트 렌더 테스트 없음).

**Spec:** `docs/superpowers/specs/2026-11-22-dialogue-split-design.md`의 "추가: 방식 선택" 절(기존 규칙 위에 얹는다).

## Global Constraints

- 두 방식 모두 글자를 바꾸지 않고(조각 앞뒤 공백만 다듬음), 한 번 나눈 결과에 다시 적용해도 변하지 않는다(멱등).
- `mode`에는 함수 기본값을 두지 않는다 — 화면이 `"separate"`를 기본 선택으로 정하고 호출한다.
- `attach`의 결과는 이번 변경 전과 완전히 같아야 한다(기존 테스트가 그대로 통과).
- 코드 주석은 한국어, 주변 코드처럼 "왜"만 짧게.

## Review Focus

- `“…”라고 말했다`처럼 따옴표 바로 뒤에 글자가 붙으면 `separate`에서도 떼지 않는다 → Task 1 테스트.
- 쉼표로 끝나는 대사(`“가자,” 그가 말했다.`)와 문장 끝 부호 없는 대사(`“가자” 하고 웃었다`)는 떼지 않는다 → Task 1 테스트.
- 문장 중간 인용(`잡고 “…”라는 안내`)은 `separate`에서도 나누지 않는다 → Task 1 테스트.
- 곧은 따옴표와 연속 대사(`“가.” “나.” …`)에서 빈 조각이나 중복 분할이 생기지 않는다 → Task 1 테스트.
- 방식을 바꿔도 장을 바꿀 때 외에는 미리 보기가 열린 채 유지되고, 문단 수 표시가 실제 결과와 같다 → Task 2(코드 읽기로 확인).

---

### Task 1: `splitDialogue`에 `mode` 추가

**Files:**
- Modify: `lib/dialogueSplit.ts`
- Test: `lib/dialogueSplit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DialogueSplitMode = "attach" | "separate";
  export function splitDialogue(paragraphs: string[], mode: DialogueSplitMode): DialogueSplitResult;
  ```
  `DialogueSplitResult`는 그대로(`{ paragraphs: string[]; skipped: number[] }`).

- [ ] **Step 1: 기존 테스트를 새 시그니처로 맞춘다.** 테스트 파일 위쪽에 `const attach = (p: string[]) => splitDialogue(p, "attach");`를 두고, 기존 12개 테스트의 `splitDialogue(...)` 호출을 `attach(...)`로 바꾼다(동작 변화 없음). 멱등·글자 보존 테스트는 `["attach", "separate"]` 두 방식에 대해 돌도록 바꾼다(입력은 기존 두 개에 `“가.” “나.” 그가 웃었다.`를 더한다).

- [ ] **Step 2: `separate` 실패 테스트를 쓴다** (`describe("splitDialogue — 대사만 따로")`, 모두 `splitDialogue(input, "separate")`).
  - `"대사와 서술을 따로 나눈다"`: `["그가 문을 열었습니다. “안녕하세요.” 그는 고개를 숙였습니다. “들어오세요.” 저는 대답했습니다."]` → `paragraphs` `["그가 문을 열었습니다.", "“안녕하세요.”", "그는 고개를 숙였습니다.", "“들어오세요.”", "저는 대답했습니다."]`, `skipped` `[]`.
  - `"곧은 따옴표도 같다"`: 위 입력의 `“ ”`를 `"`로 바꾼 것 → 같은 모양(조각에 `"`가 그대로).
  - `"문단 맨 앞 대사도 뒤 서술과 나눈다"`: `["“안녕하세요.” 그는 웃었습니다."]` → `["“안녕하세요.”", "그는 웃었습니다."]`.
  - `"대사가 이어져도 빈 조각 없이 나눈다"`: `["“가.” “나.” 그가 웃었다."]` → `["“가.”", "“나.”", "그가 웃었다."]`.
  - `"따옴표에 글자가 붙으면 떼지 않는다"`: `["그가 말했다. “가자.”라고 했습니다."]` → `["그가 말했다.", "“가자.”라고 했습니다."]`.
  - `"쉼표로 끝나는 대사와 문장 끝 부호 없는 대사는 떼지 않는다"`: `["그가 말했다. “가자,” 그가 말했다."]` → `["그가 말했다.", "“가자,” 그가 말했다."]`; `["그가 말했다. “가자” 하고 웃었습니다."]` → `["그가 말했다.", "“가자” 하고 웃었습니다."]`.
  - `"문장 중간의 인용은 나누지 않는다"`: 기존 `잡고 “…”라는 안내` 입력 → 입력과 같은 배열.
  - `"대사만 있는 문단은 그대로 둔다"`: `["“안녕하세요.”"]` → 입력과 같은 배열.
  - `"짝이 맞지 않는 문단은 건너뛴다"`: `["그가 말했다. “열린 따옴표"]` → 그대로, `skipped` `[1]`.

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run lib/dialogueSplit.test.ts`
Expected: FAIL — `separate` 테스트들이 기대와 다르게 나오거나(대사 뒤 서술이 안 떨어짐), 타입이 안 맞는다. 기존 `attach` 테스트는 통과한다.

- [ ] **Step 4: 구현.** `splitDialogue(paragraphs, mode)`로 시그니처를 바꾸고 `DialogueSplitMode`를 export한다. `splitPoints(text, quotes, mode)`에서 각 여는 따옴표가 "대사 시작"(문단 맨 앞이거나 기존 규칙으로 분할점이 되는 것)인지 기록해 두고, `mode === "separate"`이면 닫는 따옴표마다 다음 세 조건을 모두 만족할 때 `q.index + 1`을 분할점에 더한다: 짝인 여는 따옴표가 대사 시작이다 / 닫는 따옴표 바로 앞 글자가 `.` `!` `?` `…`다 / 바로 뒤가 공백이고 그 뒤에 공백 아닌 글이 남아 있다. 분할점은 오름차순으로 정렬하고 빈 조각은 기존처럼 버린다. 주석에는 따옴표에 글자가 붙은 경우를 떼지 않는 이유를 한 줄로 적는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run lib/dialogueSplit.test.ts` — 전부 통과. 이어서 `npx tsc --noEmit`은 `DialogueSplit.tsx`의 호출(인자 하나)이 아직 옛 시그니처라 오류가 나므로 Task 2에서 해결한다.

- [ ] **Step 6: 커밋** (타입 오류가 남아 있으므로 Task 2와 함께 두 커밋으로 올리되, 이 커밋은 테스트·구현만 담는다)

```bash
git add lib/dialogueSplit.ts lib/dialogueSplit.test.ts docs/superpowers/specs/2026-11-22-dialogue-split-design.md docs/superpowers/plans/2026-11-22-dialogue-split-modes.md
git commit -m "feat: add separate mode to dialogue split"
```

---

### Task 2: 패널에서 방식 고르기

**Files:**
- Modify: `components/admin/DialogueSplit.tsx`
- Modify: `CLAUDE.md` (대사 나누기 단락)

**Interfaces:**
- Consumes: `splitDialogue(paragraphs, mode)` / `DialogueSplitMode` (Task 1, `@/lib/dialogueSplit`).

- [ ] **Step 1: 컴포넌트를 고친다.** `const [mode, setMode] = useState<DialogueSplitMode>("separate")`를 더한다. 열려 있을 때 두 방식의 결과(`separate`, `attach`)를 모두 계산한다(`const results = open ? { separate: splitDialogue(paragraphs, "separate"), attach: splitDialogue(paragraphs, "attach") } : null`). 미리 보기에는 `results[mode]`를 쓴다. 미리 보기 영역 맨 위에 방식 버튼 두 개를 둔다: `대사만 따로 ({N}문단)`, `서술 붙이기 ({M}문단)` — `aria-pressed`로 선택 표시하고 선택된 쪽은 `variant="default"`, 아닌 쪽은 `outline`(기존 수락/거절 버튼과 같은 방식, `h-11 px-4 text-sm`). 나머지(건너뛴 문단 안내, "나눌 대사를 찾지 못했어요", 적용 버튼)는 그대로이며 적용은 `results[mode].paragraphs`를 쓴다. 설명 문구는 `지금 N문단 · 따옴표 대사를 문단으로 나눠요. 글자는 바꾸지 않아요`로 방식에 중립적으로 고친다.

- [ ] **Step 2: `CLAUDE.md`의 대사 나누기 단락을 고친다** — "대사 뒤 서술은 그 대사 문단에 붙고" 부분을 두 방식(`대사만 따로` 기본 / `서술 붙이기`)과 `separate`가 따옴표에 글자가 붙은 경우·쉼표로 끝나는 대사·끝 부호 없는 대사는 떼지 않는다는 내용으로 바꾼다.

- [ ] **Step 3: 자동 검증**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 타입 오류 없음, lint 오류 없음, 테스트 전부 통과(기존 368 + 새 테스트), 빌드 성공.

- [ ] **Step 4: 커밋**

```bash
git add components/admin/DialogueSplit.tsx CLAUDE.md
git commit -m "feat: choose dialogue split mode in the panel (separate by default)"
```

- [ ] **Step 5: 실제 본문 확인(읽기 전용)** — `2026-09_Lv6` 마스터 본문에 두 방식을 모두 돌려 장별 문단 수, 멱등, 글자 보존, 건너뛴 문단을 확인하고 결과를 사용자에게 알린다.
