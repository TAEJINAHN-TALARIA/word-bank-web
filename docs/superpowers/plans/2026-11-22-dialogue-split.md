# 대사 나누기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마스터 검토 화면에서 현재 장의 따옴표 대사를 문단으로 나눈 결과를 미리 보고 적용하는 `대사 나누기` 도구를 만든다.

**Architecture:** 순수 함수 `splitDialogue`(규칙 기반, 서버·Claude 호출 없음)가 문단 배열을 받아 나눈 배열을 돌려준다. 새 클라이언트 컴포넌트 `DialogueSplit`이 `StructureSuggestions` 옆에서 미리 보기·적용을 맡고, 적용은 기존 `updateChapter` 경로를 타므로 자동 저장·나란히 보기가 그대로 붙는다.

**Tech Stack:** Next.js 16 App Router(클라이언트 컴포넌트), TypeScript, Tailwind v4, Vitest(node 환경, 컴포넌트 렌더 테스트 인프라 없음).

**Spec:** `docs/superpowers/specs/2026-11-22-dialogue-split-design.md`

## Global Constraints

- 글자는 하나도 바꾸지 않는다: 결과 조각을 이어 붙이면 공백을 뺀 글자가 입력과 같아야 한다.
- 대사 따옴표는 굽은 `“ ”`와 곧은 `"` 둘 다. 작은따옴표(`‘ ’`, `'`)는 대사로 보지 않는다.
- 곧은 `"`는 문단 안에서 나타나는 순서대로 열기→닫기를 번갈아 센다. 굽은 `“`는 항상 열기, `”`는 항상 닫기.
- 검토 모드(`isReview`) 전용. 게시본(`published`) 편집에는 노출하지 않는다.
- 같은 입력이면 항상 같은 결과, 한 번 나눈 결과에 다시 적용해도 변하지 않는다(멱등).
- 코드 주석은 한국어, 주변 코드(`lib/textDiff.ts` 등)처럼 "왜"가 드러나는 짧은 주석만. 이 파일은 `"server-only"`를 import하지 않는다(클라이언트에서 쓴다).

## Review Focus

- 문장 중간에 든 인용(`잡고 “…”라는 안내 방송을`)은 나뉘지 않아야 한다 → Task 1 테스트.
- 쉼표로 이어진 인용(`“…”, “…”라는 말`)은 나뉘지 않아야 한다 → Task 1 테스트.
- 곧은 `"`가 홀수이거나 굽은 따옴표 짝이 어긋난 문단은 그대로 두고 건너뛴 번호(1부터)를 돌려준다 → Task 1 테스트.
- 이미 나뉜 장·문단 맨 앞 대사에 적용해도 변화가 없고, 두 번 적용해도 같다 → Task 1 테스트.
- 한 문단에 굽은·곧은 따옴표가 섞여도(2026-09_Lv6가 그렇다) 각자 열기·닫기로 센다 → Task 1 테스트.

---

### Task 1: `splitDialogue` 순수 함수

**Files:**
- Create: `lib/dialogueSplit.ts`
- Test: `lib/dialogueSplit.test.ts`
- 이미 작업 트리에 있는 문서(spec, 이 plan)를 함께 커밋한다.

**Interfaces:**
- Produces:
  ```ts
  export type DialogueSplitResult = { paragraphs: string[]; skipped: number[] };
  export function splitDialogue(paragraphs: string[]): DialogueSplitResult;
  ```
  `paragraphs`: 나눈 뒤의 전체 문단 배열(나눌 곳이 없는 문단은 원본 문자열 그대로). `skipped`: 따옴표 짝이 맞지 않아 건드리지 않은 입력 문단의 번호(1부터, 오름차순).

- [ ] **Step 1: 브랜치와 문서 커밋**

```bash
git switch -c feat/dialogue-split
git add docs/superpowers/specs/2026-11-22-dialogue-split-design.md docs/superpowers/plans/2026-11-22-dialogue-split.md
git commit -m "docs: add dialogue split design and plan"
```

- [ ] **Step 2: 실패하는 테스트를 쓴다** (`lib/dialogueSplit.test.ts`, `describe("splitDialogue")`). 모두 `splitDialogue(input)`의 반환값을 단언한다.
  - `"대사 앞에서 나누고 뒤 서술은 대사 문단에 붙인다"`: 입력 `["그가 문을 열었습니다. “안녕하세요.” 그는 고개를 숙였습니다. “들어오세요.” 저는 대답했습니다."]` → `paragraphs` `["그가 문을 열었습니다.", "“안녕하세요.” 그는 고개를 숙였습니다.", "“들어오세요.” 저는 대답했습니다."]`, `skipped` `[]`.
  - `"곧은 따옴표도 같은 규칙으로 나눈다"`: 위와 같은 문장을 `"안녕하세요."`/`"들어오세요."`로 바꾼 입력 → 같은 모양의 결과.
  - `"굽은 따옴표와 곧은 따옴표가 한 문단에 섞여도 각자 열기·닫기로 센다"`: `['가. “나.” 다. "라." 마.']` → `["가.", "“나.” 다.", "\"라.\" 마."]`.
  - `"대사가 이어지면 닫는 따옴표 뒤에서도 나눈다"`: `["“가.” “나.”"]` → `["“가.”", "“나.”"]`.
  - `"문장 중간의 인용은 나누지 않는다"`: `["사회자가 마이크를 잡고 “마지막 참가 번호 7번, 윤…”라는 안내 방송을 송출했습니다. 아무도 없었습니다."]` → 입력과 같은 배열.
  - `"쉼표로 이어진 인용은 나누지 않는다"`: `["수군거림이 “신청만 해놓고 나타나지 않은 건가”, “자립 지원 수혜자라더라”라는 식으로 번졌습니다."]` → 입력과 같은 배열.
  - `"작은따옴표는 대사로 보지 않는다"`: `["손잡이에 ‘온전한 소리는 홀로 울리지 않는다’라고 새겨져 있었습니다. 저는 it's 끝."]` → 입력과 같은 배열.
  - `"문단 맨 앞 대사와 이미 나뉜 문단은 그대로 둔다"`: `["“안녕하세요.” 그는 웃었습니다.", "다음 문단입니다."]` → 입력과 같은 배열.
  - `"짝이 맞지 않는 문단은 건드리지 않고 번호를 돌려준다"`: `["그가 말했다. “열린 따옴표", "정상입니다. “대사.” 끝."]` → `paragraphs` `["그가 말했다. “열린 따옴표", "정상입니다.", "“대사.” 끝."]`, `skipped` `[1]`. 곧은 따옴표 홀수 `['그가 말했다. "안녕']`도 `skipped` `[1]`, 문단 그대로.
  - `"두 번 적용해도 결과가 같고 글자를 바꾸지 않는다"`: 첫 번째 테스트 입력과 3번째(섞인 따옴표) 입력에 대해 `splitDialogue(r.paragraphs).paragraphs`가 `r.paragraphs`와 같고, `r.paragraphs.join("").replace(/\s/g, "")`가 `input.join("").replace(/\s/g, "")`와 같다.
  - `"빈 배열은 빈 결과"`: `[]` → `{ paragraphs: [], skipped: [] }`.

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run lib/dialogueSplit.test.ts`
Expected: FAIL — `./dialogueSplit`을 찾을 수 없다(모듈 없음).

- [ ] **Step 4: `splitDialogue` 구현** (`lib/dialogueSplit.ts`, 위 Interfaces 시그니처). 문단마다 독립 처리하는 알고리즘:
  1. 문단을 앞에서부터 훑으며 따옴표 사건(`{ index, kind: "open" | "close" }`)을 모은다. `“`는 이미 열려 있으면 짝 어긋남, `”`는 열려 있지 않으면 짝 어긋남, `"`는 열려 있으면 close·아니면 open으로 센다. 끝났을 때 열려 있거나 어긋남이 있으면 그 문단은 건너뜀(`skipped`에 1부터 번호를 넣고 원문 그대로 둔다).
  2. 분할점 = `index > 0`인 open 사건 중, 그 앞에서 공백을 뺀 마지막 글자가 `.` `!` `?` `…`이거나 직전 사건이 close이고 그 사이가 공백뿐인 것. 분할점이 없으면 원문 그대로.
  3. 분할점으로 자른 조각을 `trim()`하고 빈 조각은 버린다. 조각은 대사를 만나기 전까지의 앞 서술, 그리고 "여는 따옴표부터 다음 분할점 직전까지"라서 대사 뒤 서술은 앞 대사 조각에 붙는다.
  주석에는 곧은 따옴표를 순서로 센다는 이유와 문장 중간 인용을 나누지 않는 이유를 한두 줄로 적는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run lib/dialogueSplit.test.ts`
Expected: PASS — 위 테스트 전부 통과. 이어서 `npx vitest run`(전체)도 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add lib/dialogueSplit.ts lib/dialogueSplit.test.ts
git commit -m "feat: add dialogue splitting rule (quotes to paragraphs)"
```

---

### Task 2: `DialogueSplit` 컴포넌트와 편집 화면 연결

**Files:**
- Create: `components/admin/DialogueSplit.tsx`
- Modify: `components/admin/MasterEditor.tsx:624-636` (`StructureSuggestions` 렌더 부분과 `onApply` 핸들러)
- Modify: `CLAUDE.md` (기능 설명 단락에 한두 문장 추가)

**Interfaces:**
- Consumes: `splitDialogue(paragraphs: string[]): { paragraphs: string[]; skipped: number[] }` (Task 1, `@/lib/dialogueSplit`).
- Produces: `DialogueSplit({ paragraphs, disabled, onApply }: { paragraphs: string[]; disabled: boolean; onApply: (paragraphs: string[]) => void })` — 클라이언트 컴포넌트(`"use client"`), 현재 장의 문단 배열을 받는다.

- [ ] **Step 1: 컴포넌트를 만든다** (`components/admin/DialogueSplit.tsx`). 규칙:
  - 상태는 `open: boolean` 하나. 미리 보기는 `open`일 때 `splitDialogue(paragraphs)`를 렌더마다 계산한다(낡은 제안 처리가 필요 없다).
  - 겉모양은 `StructureSuggestions`와 같은 `section` 스타일(`rounded-2xl border border-border bg-card p-4 sm:p-5`, `aria-label="대사 나누기"`), 제목 `대사 나누기`, 설명 `지금 N문단 · 따옴표 대사 앞에서 문단을 나눠요. 글자는 바꾸지 않아요`, 버튼 `대사 나누기 미리 보기`(`h-11 px-4 text-sm`, `variant="outline"`, `disabled={disabled || paragraphs.length === 0}`).
  - 열렸을 때: 결과 문단 수가 입력과 같으면 `나눌 대사를 찾지 못했어요. 지금 구성을 그대로 써도 좋아요.`와 `닫기` 버튼. 다르면 `N문단 → M문단이 돼요`, 번호를 붙인 `ol`(각 `li`는 `truncate`, `StructureSuggestions`의 미리 보기와 같은 클래스), `이 구성으로 적용`(`onApply(result.paragraphs)` 호출 후 `setOpen(false)`; `disabled={disabled}`)과 `적용하지 않고 닫기`. 건너뛴 문단이 있으면 `따옴표 짝이 맞지 않아 건너뛴 문단: 2, 5`를 보인다.

- [ ] **Step 2: `MasterEditor`에 연결한다.** `isReview` 블록에서 `StructureSuggestions` 바로 아래에 `<DialogueSplit key={`dialogue-${currentChapter.chapterNumber}`} paragraphs={currentChapter.paragraphs} disabled={locked} onApply={...} />`를 둔다. `onApply`는 `StructureSuggestions`와 같은 동작(`updateChapter(…, (c) => ({ ...c, paragraphs }))` 후 `setSelected({ chapterNumber, paragraphIndex: 0 })`)이므로, 두 곳이 같은 함수를 쓰도록 `applyParagraphs`로 뽑아 `StructureSuggestions`에도 그 함수를 넘긴다(동작은 그대로).

- [ ] **Step 3: `CLAUDE.md`에 기능 단락을 보탠다** — 자동 저장·나란히 보기 설명 단락 근처에, 검토 모드의 `대사 나누기`가 규칙 기반(Claude 호출 없음)이며 굽은·곧은 큰따옴표를 모두 보고 작은따옴표는 무시한다는 한두 문장.

- [ ] **Step 4: 자동 검증**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 타입 오류 없음, lint 오류 없음, 테스트 전부 통과(기존 356개 + 새 테스트), 빌드 성공.

- [ ] **Step 5: 커밋**

```bash
git add components/admin/DialogueSplit.tsx components/admin/MasterEditor.tsx CLAUDE.md
git commit -m "feat: add dialogue split panel to master review editor"
```

- [ ] **Step 6: 브라우저 수동 확인 목록을 사용자에게 넘긴다** (컴포넌트 렌더 테스트 인프라가 없어 자동 검증 불가): `2026-09_Lv6` 2·3·4장에서 `대사 나누기 미리 보기` → `1문단 → N문단` 미리 보기, `이 구성으로 적용` 후 문단 목록·`수정됨` 배지·3초 자동 저장 칩, 이미 나뉜 5장에서 "나눌 대사를 찾지 못했어요", 게시본 편집 화면에는 패널이 없음.
