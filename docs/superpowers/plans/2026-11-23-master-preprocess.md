# 마스터 전처리 (사실관계 점검 + 문장 다듬기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `문단 정리` 모달에 ④ 사실관계 점검과 ③ 문장 다듬기 단계를 더해, ④③①② 순서로 전 장에 한 번에 실행하고 결과를 한 번에 적용한다.

**Architecture:** 새 순수 로직(프롬프트·검증·적용)은 `lib/claude/preprocessing.ts`에 두고, Claude 호출은 기존 패턴(`editor.ts` → 서버 액션 → 모달)을 따른다. 모달은 ④ 뒤에 편집자가 정정을 고르는 확인 단계를 한 번 거치고, 고른 정정을 적용한 본문으로 ③①②를 이어서 돌린다.

**Tech Stack:** Next.js server actions, TypeScript, zod 구조화 출력(`callStructured`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-master-preprocess-design.md` (구현 전에 읽을 것. 기존 모달 설계는 `docs/superpowers/specs/2026-11-22-editor-cleanup-modal-titles-design.md`)

## Global Constraints

- 검토 모드(`mode: "review"`) 전용. 게시본(`published`)은 두 새 액션 모두 Claude를 부르지 않고 `{ error: "게시된 소설은 마스터 전처리를 할 수 없습니다" }`로 거절한다.
- 서버 액션은 실패를 throw하지 않고 `{ error }`로 돌려준다. 관리자 세션 재확인(`getAdminSession`)과 `LOGIN_REQUIRED` 규칙을 따른다.
- 실행 순서는 항상 ④ → ③ → ① → ②. ④ 호출은 **원고 전체 1회, effort `high`**. ③은 **장마다 순서대로, effort `medium`**(제 판단: ②와 같게).
- ④: 최대 8건. 모순이 아닌 것(연출·복선·오해·거짓말하는 인물의 대사)은 제외. 정정은 한 곳만, 처음 나온 값을 기준으로, 숫자·단어 하나 수준의 최소 변경.
- ③: 장당 최대 20건(문단당은 기존 `validateChanges`의 8건). 항목 폐기 조건 — `before`가 지정 문단에 정확히 한 번 없음 / 겹침 / `before === after` / `after`에 빈 줄 / `before`·`after`에 따옴표(`“ ” " ' ‘ ’ 「 」`) / `before`가 따옴표 한 쌍 안에 통째로 든 구절(짝이 어긋난 문단은 그 문단의 항목 전부 폐기) / `before`의 숫자 문자열(`\d+`)이 `after`에 그대로 없음 / `after.length > before.length * 1.2`.
- ④ 정정은 대사 안쪽 수정을 허용하되, `before`와 `after`의 따옴표 글자(`“ ” "`)가 다르면 그 정정을 `fix: null`로 만든다.
- 멈추기는 단계 단위: 어느 단계에서 멈추든 ①은 전 장에 적용, ③은 이미 받은 장만, ②는 이미 받은 장의 제안만(③이 끝나기 전에 멈추면 ②는 돌지 않음).
- ③④는 줄거리·사실 관계(③에서는 숫자·나이·날짜)·인물·시점·서술 문체(종결어미)를 바꾸지 않는다. 대사(따옴표 안)는 ③이 건드리지 않는다.
- 모달 문구는 기존처럼 해요체 한국어. 한 단계의 실패가 나머지를 멈추지 않는다(오류 줄만 남김). 자동 적용되는 ④ 정정은 없다 — 고르지 않은 것은 무시와 같다.
- 컴포넌트 렌더 테스트 환경이 없다. 화면은 수동 확인 목록으로 검증한다.
- 테스트는 `npx vitest run <파일>`, 전체는 `npm test`, 타입은 `npx tsc --noEmit`, 린트는 `npx eslint <파일>`.

## Review Focus

- ③이 `열네 살` 같은 **한글 수사**를 바꿔도 숫자 가드가 못 잡는다 → 프롬프트에 "수·나이·날짜 표현은 그대로"를 못 박고 프롬프트 문구를 테스트로 고정한다 (Task 1).
- 모델이 **대사 안쪽 구절**(`“가자, 정말 매우 빨리 가자”`의 `정말 매우 빨리`)이나 따옴표가 섞인 구절을 `before`로 인용 → 항목을 버려 대사가 바뀌지 않고 대사 나누기의 따옴표 짝도 깨지지 않게 한다 (Tasks 1, 2).
- 모델이 **틀린 문단 번호**나 없는 문단을 가리킴 → 항목을 버리고 다른 문단을 건드리지 않는다 (Tasks 1, 2).
- **한 장의 ③ 호출이 실패하거나 던짐** → 그 장은 ③을 건너뛰고 나머지 장은 계속된다 (Task 5).
- **단계 중간에 멈추기** → 그때까지 받은 ④정정·③결과·②제안만으로 결과 화면이 만들어지고, 받지 못한 단계는 원문 그대로다 (Tasks 5, 6).

---

### Task 1: ③ 문장 다듬기의 순수 로직

**Files:**
- Create: `lib/claude/preprocessing.ts`, `lib/claude/preprocessing.test.ts`
- Modify: `lib/claude/editing.ts` (상수 `INTRO`, `KEEP_STYLE`, `JSON_ONLY`, `DATA_NOTICE`에 `export`만 붙인다)
- Modify: `lib/claude/schemas.ts` (스키마 추가)
- Modify: `lib/dialogueSplit.ts`, `lib/dialogueSplit.test.ts` (따옴표 구간 함수 export 추가)

**Interfaces:**
- Produces (`lib/dialogueSplit.ts`): `export function quotedRanges(text: string): [start: number, end: number][] | null` — 기존 비공개 `findQuotes`의 짝 계산을 재사용해, 여는 따옴표부터 닫는 따옴표까지(양 끝 포함, `end`는 닫는 따옴표 다음 인덱스) 구간 목록을 돌려준다. 짝이 어긋나면 `null`. 기존 동작은 바꾸지 않는다.
- Produces (`lib/claude/preprocessing.ts`, `"server-only"` import 금지 — 클라이언트가 가져온다):
  ```ts
  export const MAX_CHAPTER_POLISH_CHANGES = 20;
  export const CHAPTER_POLISH_SYSTEM_PROMPT: string;
  export function buildChapterPolishTask(input: { chapterNumber: number; instruction?: string }): string;
  export type RawChapterPolishChange = { paragraphNumber: number; before: string; after: string; reason: string };
  export type ChapterPolishChange = { paragraphIndex: number; before: string; after: string; reason: string };
  export type ChapterPolishResult = { changes: ChapterPolishChange[]; received: number };
  export function validateChapterPolish(raw: RawChapterPolishChange[], paragraphs: string[]): ChapterPolishResult;
  export function applyChapterPolish(paragraphs: string[], changes: ChapterPolishChange[]): string[];
  ```
- Produces (`lib/claude/schemas.ts`): `chapterPolishSchema = z.object({ changes: z.array(z.object({ paragraphNumber: z.number().int(), before: z.string(), after: z.string(), reason: z.string() })) })` — 기존 스키마처럼 모양만 정의한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 먼저 `lib/dialogueSplit.test.ts`에 `quotedRanges`: `'그가 “가자.” 했다.'` → `[[3, 8]]`(첫 `“`부터 `”` 다음까지), 따옴표 없는 글 → `[]`, 곧은 `"` 두 개 → 한 구간, 짝이 어긋난 `"그가 “열린"` → `null`. 이어서 `lib/claude/preprocessing.test.ts` (`describe("③ 문장 다듬기")`). 문단 `P = ["그녀는 아주아주 매우 조용하고 차분하게 문을 천천히 열었다.", "수진은 14살이었다. 그는 “가자.” 하고 말했다."]`로:
  - `CHAPTER_POLISH_SYSTEM_PROMPT`가 `DATA_NOTICE`, `"대사(따옴표 안)는 건드리지"`, `"최대 20건"`, `"수·나이·날짜"`를 포함한다.
  - `buildChapterPolishTask({ chapterNumber: 3, instruction: "더 짧게" })`가 `"3장 전체 문단"`과 `"더 짧게"`를 포함한다.
  - `validateChapterPolish`: 좋은 항목(`paragraphNumber: 1`, `before: "아주아주 매우 조용하고 차분하게 "`, `after: ""`) 하나는 `{ paragraphIndex: 0, … }`로 남고 `received`는 입력 길이와 같다.
  - 문단 `"그는 “가자, 정말 매우 빨리 가자.” 하고 말했다."`에서 `before: "정말 매우 빨리 "`(따옴표 글자는 없지만 대사 안쪽)는 버려지고, 같은 문단의 대사 밖 구절(`"하고 "`)을 고치는 항목은 남는다. 따옴표 짝이 어긋난 문단(`"그가 “열린 따옴표 안의 아주 긴 말"`)은 어떤 항목도 남지 않는다.
  - 같은 입력에 다음 항목을 각각 섞으면 결과에서 사라진다: 없는 `paragraphNumber`(0, 3), 문단에 없는 `before`, 문단에 두 번 나오는 `before`, `before === after`, `after`에 `"\n\n"`, `before`/`after`에 `“ ” " ‘ ’ 「 」` 각각, `before: "14살"`/`after: "16살"`(숫자 불일치), `after`가 `before`의 120% 초과, 같은 문단 안에서 겹치는 두 번째 항목.
  - 21개의 유효 항목을 주면 `changes.length === 20`이고 `received === 21`.
  - 문단이 빈 배열이면 `{ changes: [], received: n }`.
  - `applyChapterPolish(P, changes)`: 해당 문단만 바뀌고 나머지는 그대로이며, 한 문단의 두 항목 중 앞을 고쳐도 뒤 항목이 제자리에 적용된다. 입력 배열은 바뀌지 않는다.

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npx vitest run lib/claude/preprocessing.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현한다.** `editing.ts`의 네 상수를 export. `preprocessing.ts`에 위 인터페이스를 구현한다. 검증은 항목마다 가드(따옴표 글자·대사 안쪽(`quotedRanges`, `null`이면 그 문단 전부 폐기)·숫자·120%·위치)를 먼저 걸러 문단별로 묶은 뒤 기존 `validateChanges(raw, paragraph)`로 위치·겹침·빈 줄을 처리하고, 합쳐서 앞에서부터 20건에서 자른다. `applyChapterPolish`는 문단별로 기존 `applyChanges(draft, accepted)`를 재사용한다. 프롬프트는 `${INTRO}`, `KEEP_STYLE`, `DATA_NOTICE`, `JSON_ONLY`를 기존 프롬프트처럼 조립하고 스펙의 "담백하게" 규칙을 담는다. `schemas.ts`에 `chapterPolishSchema` 추가.

- [ ] **Step 4: 테스트를 실행해 통과를 확인한다**

Run: `npx vitest run lib/claude/preprocessing.test.ts lib/claude/editing.test.ts`
Expected: PASS (기존 `editing.test.ts` 포함)

- [ ] **Step 5: Commit**

```bash
git add lib/claude/preprocessing.ts lib/claude/preprocessing.test.ts lib/claude/editing.ts lib/claude/schemas.ts lib/dialogueSplit.ts lib/dialogueSplit.test.ts
git commit -m "feat: pure logic for the chapter polish step of master preprocessing"
```

---

### Task 2: ④ 사실관계 점검의 순수 로직

**Files:**
- Modify: `lib/claude/preprocessing.ts`, `lib/claude/preprocessing.test.ts`, `lib/claude/schemas.ts`

**Interfaces:**
- Consumes: Task 1의 `preprocessing.ts` 상수 import(`INTRO` 등), `MasterChapter` (`lib/masterReview`).
- Produces (`preprocessing.ts`):
  ```ts
  export const MAX_FACT_FINDINGS = 8;
  export const FACTS_SYSTEM_PROMPT: string;
  export function buildFactsTask(): string;
  export type RawFactFinding = {
    topic: string; description: string;
    occurrences: { chapterNumber: number; paragraphNumber: number; quote: string }[];
    fix: { chapterNumber: number; paragraphNumber: number; before: string; after: string; reason: string }; // before === "" 이면 정정 제안 없음
  };
  export type FactOccurrence = { chapterNumber: number; paragraphIndex: number; quote: string };
  export type FactFix = { chapterNumber: number; paragraphIndex: number; before: string; after: string; reason: string };
  export type FactFinding = { topic: string; description: string; occurrences: FactOccurrence[]; fix: FactFix | null };
  export function validateFactFindings(raw: RawFactFinding[], chapters: MasterChapter[]): FactFinding[];
  ```
- Produces (`schemas.ts`): `factsSchema = z.object({ findings: z.array(z.object({ topic, description, occurrences: z.array(z.object({ chapterNumber: int, paragraphNumber: int, quote })), fix: z.object({ chapterNumber: int, paragraphNumber: int, before, after, reason }) })) })` (선택 필드 없이 모양만).

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`describe("④ 사실관계 점검")`). 두 장짜리 `chapters`(1장 1문단 `"수진은 14살이었다."`, 2장 1문단 `"열여섯 살의 수진이 왔다."` 등)로:
  - `FACTS_SYSTEM_PROMPT`가 `DATA_NOTICE`, `"최대 8건"`, `"처음 나온 값"`을 포함한다.
  - 정상 항목은 `paragraphNumber`가 0부터의 `paragraphIndex`로 바뀌고 `fix`가 `FactFix`로 남는다.
  - `quote`가 해당 문단에 없는 occurrence는 그 occurrence만 빠지고 항목은 남는다. 모든 occurrence가 빠지고 `fix`도 없으면 항목이 사라진다.
  - `fix`가 다음 중 하나면 `fix: null`이고 항목은(남은 occurrence가 있으면) 남는다: 없는 장/문단, `before`가 문단에 없음/두 번 나옴, `before === after`, `after`에 `"\n\n"`, `before === ""`, `before`와 `after`의 따옴표 글자 개수·종류가 다름(예: `after`에서 `”`를 뺌). 반대로 `before: "열네 살이에요"` → `after: "열여섯 살이에요"`처럼 대사 안쪽이어도 따옴표 글자가 같으면 `fix`가 남는다(문단은 `"“저 열네 살이에요.”"`처럼 대사 전체를 인용하지 않고 구절만 인용).
  - 앞선 항목의 `fix`와 같은 문단의 겹치는 구간을 고치는 뒤 항목의 `fix`는 `null`이 된다(앞 항목의 `fix`는 유지).
  - 9건을 주면 8건만 돌려준다.

- [ ] **Step 2: 실행해 실패를 확인한다**

Run: `npx vitest run lib/claude/preprocessing.test.ts`
Expected: FAIL (새 export 없음)

- [ ] **Step 3: 구현한다.** `validateFactFindings`는 occurrence의 `quote`를 문단에 `includes`로 정확히 확인하고(공백 정규화 없음), `fix`는 같은 문단 `indexOf` 규칙(정확히 한 번)과 이미 채택한 `fix` 구간(문단별 `[start,end)`)과의 겹침을 검사한다. 프롬프트는 스펙의 ④ 규칙(충돌하는 사실만, 확실한 것만 최대 8건, 연출·복선·오해·거짓말 제외, 정정은 한 곳만·처음 나온 값 기준·최소 변경, 줄거리·인물·시점·문체 불변)을 담는다. `buildFactsTask()`는 항목 모양(topic, description, occurrences, fix; 정정이 없으면 `fix.before`를 빈 문자열)을 설명한다. `factsSchema` 추가.

- [ ] **Step 4: 실행해 통과를 확인한다**

Run: `npx vitest run lib/claude/preprocessing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/claude/preprocessing.ts lib/claude/preprocessing.test.ts lib/claude/schemas.ts
git commit -m "feat: pure logic for the fact-check step of master preprocessing"
```

---

### Task 3: Claude 호출 `polishChapter` / `checkFacts`

**Files:**
- Modify: `lib/claude/editor.ts`, `lib/claude/editor.test.ts`

**Interfaces:**
- Consumes: Task 1·2의 프롬프트·스키마·검증, `callStructured`, `buildStoryContext`, `EditorContextInput`.
- Produces:
  ```ts
  export async function polishChapter(input: EditorContextInput & { chapterNumber: number; instruction?: string }): Promise<ChapterPolishResult>;
  export async function checkFacts(input: EditorContextInput): Promise<FactFinding[]>;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 기존 `suggestStructure` 테스트와 같은 방식(`vi.mock("./structured")`, 기존 `base`·`chapters` 사용):
  - `polishChapter`: `CHAPTER_POLISH_SYSTEM_PROMPT`, effort `"medium"`, `context`에 `"[2] 하늘이 흐렸다."`(1장 2문단), `task`에 `"1장 전체 문단"`으로 호출하고, 모델 응답 중 유효한 항목만 `{ changes, received }`로 돌려준다(`received`는 모델이 준 개수). 없는 장(`chapterNumber: 9`)이면 `callStructured`를 부르지 않고 던진다.
  - `checkFacts`: `FACTS_SYSTEM_PROMPT`, effort `"high"`, `context`에 `"## 2장. 둘째"`(전체 원고)로 호출하고 검증된 항목만 돌려준다.

- [ ] **Step 2: 실행해 실패를 확인한다**

Run: `npx vitest run lib/claude/editor.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다** — `suggestStructure`와 같은 형태(장 찾기 → `callStructured` → 검증). `polishChapter`는 `validateChapterPolish(raw.changes, chapter.paragraphs)`, `checkFacts`는 `validateFactFindings(raw.findings, input.chapters)`.

- [ ] **Step 4: 실행해 통과를 확인한다**

Run: `npx vitest run lib/claude/editor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/claude/editor.ts lib/claude/editor.test.ts
git commit -m "feat: Claude calls for chapter polish and fact check"
```

---

### Task 4: 서버 액션

**Files:**
- Modify: `lib/actions/masterReviewActions.ts`, `lib/actions/masterReviewActions.test.ts`

**Interfaces:**
- Consumes: Task 3의 `polishChapter`, `checkFacts`; `loadEditorContext`, `ClaudeTarget`, `tooLong`, `messageOf`.
- Produces:
  ```ts
  export async function checkFactsAction(input: ClaudeTarget): Promise<{ error?: string; findings?: FactFinding[] }>;
  export async function polishChapterAction(
    input: ClaudeTarget & { chapterNumber: number; instruction?: string },
  ): Promise<{ error?: string; changes?: ChapterPolishChange[]; received?: number }>;
  ```
  오류 문구: 게시본 → `"게시된 소설은 마스터 전처리를 할 수 없습니다"`, 지시 501자 이상 → `"지시가 너무 깁니다"`, 호출 실패 폴백 → `"사실관계 점검 실패"` / `"문장 다듬기 실패"`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (기존 `suggestStructureAction` 테스트 모양):
  - 세션이 없으면 두 액션 모두 `{ error: "관리자 로그인이 필요합니다" }`이고 `editor.checkFacts`/`polishChapter`를 부르지 않는다(기존 "관리자 세션 재확인" 테스트에 추가).
  - `polishChapterAction`: 설정집을 읽어(`reviews.getMasterReview` 모킹) `objectContaining({ chapters, characters, level: "Lv3", chapterNumber: 1 })`로 호출하고 `{ changes, received }`를 돌려준다. 게시본은 거절하고 호출하지 않는다. 지시 501자는 거절한다. `editor.polishChapter`가 던지면 `{ error: <메시지> }`.
  - `checkFactsAction`: 설정집과 함께 `editor.checkFacts`를 부르고 `{ findings }`를 돌려준다. 게시본은 거절한다. 던지면 `{ error }`.

- [ ] **Step 2: 실행해 실패를 확인한다**

Run: `npx vitest run lib/actions/masterReviewActions.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다** — `suggestStructureAction`과 같은 형태. `checkFactsAction`은 `chapters`가 `isValidChaptersInput`을 통과해야 한다(`loadEditorContext`가 처리).

- [ ] **Step 4: 실행해 통과를 확인한다**

Run: `npx vitest run lib/actions/masterReviewActions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/masterReviewActions.ts lib/actions/masterReviewActions.test.ts
git commit -m "feat: server actions for fact check and chapter polish"
```

---

### Task 5: 모달 쪽 순수 로직 (`paragraphCleanup.ts`)

**Files:**
- Modify: `lib/paragraphCleanup.ts`, `lib/paragraphCleanup.test.ts`

**Interfaces:**
- Consumes: Task 1·2의 타입, `applyChapterPolish`, 기존 `applyChanges`(`lib/claude/editing.ts`), `MasterChapter`.
- Produces:
  ```ts
  export type FactCheck = { findings?: FactFinding[]; error?: string };
  export function fetchFactCheck(request: () => Promise<{ error?: string; findings?: FactFinding[] }>): Promise<FactCheck>;
  // error·findings 모두 없을 때 기본 문구 "사실관계 점검을 받지 못했습니다"
  export type ChapterPolish = { changes?: ChapterPolishChange[]; received?: number; error?: string };
  export function fetchChapterPolish(
    request: () => Promise<{ error?: string; changes?: ChapterPolishChange[]; received?: number }>,
  ): Promise<ChapterPolish>;
  // 기본 문구 "문장 다듬기를 받지 못했습니다". 두 함수 모두 기존 fetchChapterSuggestion처럼 던져도 { error }로 돌려준다.
  export function applyFactFixes(chapters: MasterChapter[], fixes: FactFix[]): MasterChapter[];
  export function applyPolishes(chapters: MasterChapter[], polishes: Record<number, ChapterPolish>): MasterChapter[];
  ```
  `applyFactFixes`는 `fix.chapterNumber`/`paragraphIndex`의 문단에만 적용하고(기존 `applyChanges` 재사용), 입력을 바꾸지 않는다. `applyPolishes`는 `changes`가 있는 장만 `applyChapterPolish`로 바꾸고 오류·미수신 장은 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (기존 `fetchChapterSuggestion` 테스트와 같은 네 경우를 두 fetch 함수에 각각: 정상 / 서버 `error` / 둘 다 없음 → 기본 문구 / 던지거나 문자열로 reject → 기본 문구·메시지). 그리고:
  - `applyFactFixes`: 고른 `fix`만 해당 문단에 적용되고 다른 문단·장은 그대로이며, 입력 `chapters`는 바뀌지 않는다. `fixes: []`이면 같은 내용의 복사본.
  - `applyPolishes`: 수신한 장만 바뀌고, `error`만 있는 장과 항목이 없는 장은 그대로다.
  - 통합: `applyFactFixes` → `applyPolishes` → `buildCleanupBase` 순으로 이어 붙이면 ④ 정정이 반영된 글에서 ③이 돌고, 그 결과에 대사 나누기가 적용된다(최종 `paragraphs` 단언).

- [ ] **Step 2: 실행해 실패를 확인한다**

Run: `npx vitest run lib/paragraphCleanup.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다.** 기존 `fetchChapterSuggestion`은 건드리지 않는다. 새 두 fetch 함수는 같은 try/catch 모양을 따른다(공통 헬퍼로 묶을지는 구현자 판단).

- [ ] **Step 4: 실행해 통과를 확인한다**

Run: `npx vitest run lib/paragraphCleanup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/paragraphCleanup.ts lib/paragraphCleanup.test.ts
git commit -m "feat: cleanup helpers for fact fixes and chapter polish"
```

---

### Task 6: 모달 UI

**Files:**
- Modify: `components/admin/ParagraphCleanupModal.tsx`

**Interfaces:**
- Consumes: `checkFactsAction`, `polishChapterAction`, `suggestStructureAction`; Task 5의 `fetchFactCheck`, `fetchChapterPolish`, `applyFactFixes`, `applyPolishes`; 기존 `buildCleanupBase`, `fetchChapterSuggestion`, `summarizeChapter`. `onApply` 시그니처는 그대로(`(next: Map<number, string[]>) => void`).
- Produces: 없음(화면). 단계: `Phase = "setup" | "running" | "facts" | "result"`.

이 파일은 테스트가 없다. 단계마다 `npx tsc --noEmit`과 `npx eslint components/admin/ParagraphCleanupModal.tsx`로 확인하고, 마지막에 수동 확인 목록을 돌린다.

- [ ] **Step 1: 설정 화면.** 기존 두 fieldset 위에 `사실관계 점검`과 `문장 다듬기` 체크(둘 다 기본 켜짐)를 더하고, 각각 한 줄 설명(스펙 "목표/설계" 문구)과 호출 수(`사실관계 점검은 원고 전체를 한 번`, `문장 다듬기는 장마다 한 번씩(N번)`)를 보인다. 안내 문단을 새 순서(④③①②)로 고친다. `실행`은 네 단계 중 하나라도 켜져 있어야 활성화된다.

- [ ] **Step 2: 실행 흐름.** `execute()`를 단계 순서로 다시 짠다 — ④(켜졌다면 원고 전체 1회, `fetchFactCheck`) → 찾은 항목이 있으면 `phase="facts"`로 멈추고(기존 `runToken` 규칙 유지), 없으면 계속 → ③(켜졌다면 장마다 `fetchChapterPolish`, 받는 대로 `polishes`에 쌓는다) → 끝나면 `buildCleanupBase(applyPolishes(afterFacts, polishes), 대사 나누기 설정)`으로 `base`를 만들고 → ②(기존 루프, 입력은 그 `base.chapters`). 실행 상태 `run`에 `original`(열었을 때 본문, `summarizeChapter`의 기준은 계속 이것), `afterFacts`, `factsError`, `polishes`, `base`, `suggestions`를 둔다. `진행` 표시는 단계 이름과 `n/N장`(④는 이름만). `continueAfterFacts()`는 고른 정정으로 `afterFacts = applyFactFixes(original, 고른 fix들)`를 만들어 ③부터 이어 간다. `멈추고 지금까지 보기`는 어느 단계에서든 지금까지 받은 것으로 `base`를 만들어(받지 못한 단계는 원문 그대로, ①은 전 장에 적용) `result`로 간다. ③이 끝나기 전에 멈추면 ②는 돌지 않아 모든 장이 제안 없음이다. ②에서 멈추면 이미 받은 장의 제안만 남는다.

- [ ] **Step 3: 확인 단계 화면(`phase === "facts"`).** 제목 `사실관계 점검 결과`. 항목마다 카드: `topic`, `description`, 충돌 위치 목록(`N장 M문단 “quote”`), 정정 제안이 있으면 `전 → 후`와 이유와 `이 정정 적용`/`무시` 버튼(`aria-pressed`, 기존 수락/거절 버튼 스타일), 없으면 `정정 제안 없음`. 기본은 둘 다 고르지 않은 상태이고 무시와 같다. 하단 `계속` 버튼이 `continueAfterFacts()`를 부른다. ④ 호출이 실패했으면 이 단계 없이 진행하고 결과 화면 맨 위에 오류 한 줄을 보인다(`role="alert"`).

- [ ] **Step 4: 결과 화면.** 장 한 줄을 `지금 a문단 → 문장 다듬기 k곳 → 대사 나누기 b문단 → 적용 시 c문단`으로 확장한다(실행하지 않은 단계는 생략, 문장 다듬기 줄에 `받은 n건 중 k건 적용`). 펼침 영역에 그 장에 고른 ④ 정정과 ③의 `전 → 후`(이유 포함)를 읽기용으로 보인다(버튼 없음). ③이 오류였던 장은 기존 ② 오류 줄처럼 `문장 다듬기를 받지 못했어요: …`. `이 장 적용` 체크와 `이 구성으로 N개 장 적용`은 기존대로(`changed`는 원본 대비 최종 문단 비교이므로 문장 변화도 잡힌다).

- [ ] **Step 5: 타입·린트·전체 테스트**

Run: `npx tsc --noEmit && npx eslint components/admin/ParagraphCleanupModal.tsx lib/paragraphCleanup.ts lib/claude lib/actions/masterReviewActions.ts && npm test`
Expected: 오류 없음, 모든 테스트 PASS

- [ ] **Step 6: 수동 확인** (`npm run dev`, 관리자 로그인, 편집 대기 중인 세션의 편집 화면 → `문단 정리`). 확인할 것:
  1. 네 단계를 켜고 실행 → 진행 표시가 단계별로 바뀌고, 모순이 있으면 확인 단계에서 멈춘다. 아무것도 고르지 않고 `계속`하면 ④ 정정이 적용되지 않는다.
  2. `이 정정 적용`을 고르고 `계속` → 결과 화면의 해당 장 펼침에 그 정정이 보이고, 적용하면 편집 화면의 문단에 반영된다.
  3. ③의 `전 → 후`에 대사(따옴표 안)와 숫자 변경이 없다. 장별 `이 장 적용`을 끄면 그 장은 원문 그대로다.
  4. `사실관계 점검`/`문장 다듬기`를 끄면 ①②만 이전과 똑같이 동작한다.
  5. ③ 도중 `멈추고 지금까지 보기` → 받은 장만 다듬어지고 나머지는 원문이며 ②는 건너뛴다. 실행 중 닫기 → 이후 호출이 더 나가지 않는다(네트워크 탭).
  6. 개발 환경에서 가능하면 `ANTHROPIC_API_KEY`를 일부러 틀리게 해 한 장 실패 격리를 확인한다.
  결과를 기록한다. 렌더 테스트가 없으므로 이 확인을 건너뛰지 않는다.

- [ ] **Step 7: Commit**

```bash
git add components/admin/ParagraphCleanupModal.tsx
git commit -m "feat: fact check and polish steps in the paragraph cleanup modal"
```

---

## Self-Review

- **Spec 커버리지:** 흐름(④→확인→③①②)·단계 체크 → Task 6. ④ 액션·프롬프트·검증·확인 화면 → Tasks 2·3·4·6. ③ 액션·프롬프트·가드·전부 적용 → Tasks 1·3·4·5·6. ①②는 입력만 교체 → Task 5·6. 결과 화면·호출 수 문구 → Task 6. 게시본 거절 → Task 4. 한계(되돌리기 없음)는 비목표라 작업 없음.
- **타입 일관성:** `ChapterPolishChange`/`ChapterPolishResult`/`FactFinding`/`FactFix`는 Task 1·2에서 정의해 3~6이 같은 이름으로 쓴다. 액션 반환의 `received`는 Task 3의 `ChapterPolishResult.received`와 같다.
- **비례:** 계획은 스펙의 세 배 이내이고 본문 코드는 인터페이스 선언뿐이다.
