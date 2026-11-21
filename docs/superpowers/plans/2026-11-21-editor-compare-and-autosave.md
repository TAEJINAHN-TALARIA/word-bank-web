# 편집 화면 이전 버전 나란히 보기 + 자동 임시 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문단 편집 화면에 이전 버전과 나란히 보는 비교 칸(바뀐 곳 색 표시)과 3초 자동 임시 저장을 넣고, 게시본 수정을 "초안 → 게시본에 반영" 두 단계로 바꾼다.

**Architecture:** 비교(`lib/textDiff.ts`)·자동 저장 타이밍(`lib/autosaver.ts`)·초안 검증 같은 로직은 프레임워크 없는 순수 모듈로 만들어 Vitest로 고정한다. 마스터 검토의 자동 저장은 기존 `saveMasterReviewAction`을 재사용하고, 게시본 초안은 웹이 Firestore `publishedDrafts/{docId}`에 직접 저장한다(story-generator 변경 없음). 화면(`HighlightedTextarea`, `ParagraphWorkspace`, `MasterEditor`)은 이 모듈들을 이어 붙인다.

**Tech Stack:** Next.js 16 App Router(Server Actions), React 19, Tailwind v4, Firebase Admin/Firestore, Vitest(node 환경, 컴포넌트 렌더링 테스트 없음).

**Spec:** `docs/superpowers/specs/2026-11-21-editor-compare-and-autosave-design.md`

## Global Constraints

- 작업은 새 브랜치 `feat/editor-compare-autosave`에서 한다(master에 직접 커밋하지 않는다). 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 줄을 붙인다. push는 사용자가 요청할 때만 한다.
- 이 Next.js(16)는 일반 지식과 다르다 — Next 동작이 의심스러우면 `node_modules/next/dist/docs/`를 먼저 읽는다(AGENTS.md).
- 서버 액션은 `"use server"` 파일에서 async 함수만 export하고, 실패는 throw가 아니라 `{ error }`로 돌려준다. 모든 서버 액션은 `getAdminSession()`을 먼저 확인하고, 없으면 `{ error: "관리자 로그인이 필요합니다" }`.
- story-generator 쪽 코드·배포는 바꾸지 않는다. `saveMasterReviewAction`, `editPublishedStoryAction` 호출 규약은 그대로.
- 자동 저장 지연은 `AUTOSAVE_DELAY_MS = 3000`, 게시본 초안 크기 상한은 `MAX_DRAFT_CHARS = 250_000`.
- **자동 저장은 `chapters` 상태를 바꾸지 않는다**(정규화는 수동 저장·승인·반영에서만). 자동 저장이 끝나면 `baseline`을 "보낸 시점의 정규화본"으로 올리고, `baseline`과 `chapters` 비교는 정규화에 둔감하다(`isChapterEdited`/`sameParagraphs`).
- 나란히 보기는 `xl`(Tailwind) 이상에서 좌우 두 칸, 미만에서 위아래. 기본값은 켜짐.
- 화면 문구는 한국어, 기존 톤(`~어요`)을 따른다. 코드 주석은 주변처럼 한국어로 "왜"만 적는다.
- 컴포넌트 렌더링 테스트 인프라가 없으므로 순수 로직·서버 액션만 단위 테스트한다. 화면 Task는 `npx tsc --noEmit`·`npx eslint <파일>`로 검증하고 마지막 Task의 브라우저 확인 목록으로 닫는다.
- 검증 명령: 전체 테스트 `npx vitest run`, 타입 `npx tsc --noEmit`, 린트 `npm run lint`(저장소 전체, 현재 깨끗해야 함), 빌드 `npm run build`.

## Review Focus

아래는 스펙이 암시하지만 개별 Task 테스트가 다 덮지 못하는, 사용자에게 가장 먼저 걸릴 입력·상황이다(가능성 큰 순). 각 줄의 테스트는 소유 Task에 들어 있다.

1. **글 쓰는 도중 제목·본문이 잠깐 빈다** → 자동 저장이 오류 배너 대신 "건너뜀"으로 넘어가고 입력은 막히지 않는다 (Task 2 `findUnsavableReason`, Task 3 `skipped`).
2. **저장 요청이 가는 동안 계속 타이핑한다** → 저장 뒤 `baseline`이 보낸 시점 스냅샷이라 이어 쓴 글은 여전히 "저장 안 됨"으로 남고, 두 저장이 겹치지 않는다 (Task 3 직렬화 테스트, Task 6 스냅샷 규칙).
3. **문단 안에 빈 줄·빈 문단을 만든 채 자동 저장이 돈다** → 화면 글은 그대로이고 `dirty` 계산만 맞다 (Task 2 `buildSaveEdits` 고정 테스트).
4. **게시본에서 고친 걸 전부 원래대로 되돌렸다** → 서버 초안이 지워진다 (Task 4).
5. **초안을 반영한 뒤 초안 삭제가 실패했거나, 그 사이 게시본이 바뀌었다** → 다음에 열 때 `stale`로 취급해 자동 적용하지 않는다 (Task 4 `mapPublishedDraft`).
6. **아주 긴 문단의 비교** → 비교를 생략하고 통째로 바뀐 것으로 보여준다(화면이 멈추지 않는다) (Task 1).

---

### Task 1: 비교 로직 `diffWords`

**Files:**
- Create: `lib/textDiff.ts`
- Test: `lib/textDiff.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces: `type DiffSegment = { type: "same" | "del" | "ins"; text: string }`, `diffWords(before: string, after: string): DiffSegment[]`.

- [ ] **Step 0: 브랜치와 문서 커밋**

`git checkout -b feat/editor-compare-autosave`(이미 있으면 그대로 사용) 후 `docs/superpowers/specs/2026-11-21-editor-compare-and-autosave-design.md`와 이 계획서를 `docs: add editor compare + autosave design and plan`으로 커밋한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`lib/textDiff.test.ts`, vitest, 한국어 테스트 이름)
  - 같은 글 → `[{ type: "same", text }]`. 둘 다 빈 문자열 → `[]`. `before`만 빈 문자열 → `[{ins, after}]`. `after`만 빈 문자열 → `[{del, before}]`.
  - 우산 가게 예시: before `"하늘이 흐렸다. 비가 올 것 같았다. 하린은 우산을 하나 꺼내 가게 앞에 놓았다."`, after `"하늘이 낮고 어두웠다. 바람에서 비 냄새가 났다. 하린은 우산을 하나 꺼내 가게 앞에 놓았다. 그때 간판 위로 첫 빗방울이 떨어졌다."` → `same` 세그먼트 중에 `"하린은 우산을 하나 꺼내 가게 앞에 놓았다."`가 들어 있고, `del`들을 이으면 `"흐렸다."`·`"올 것 같았다."` 어절이 포함되고, `ins`들을 이으면 `"그때 간판 위로 첫 빗방울이 떨어졌다."`가 포함된다.
  - **왕복 성질**: 위 예시 외에 여러 공백·줄바꿈(`"가  나\n\n다"`), 한쪽만 다른 경우 등 5쌍 이상에서 `same+del` 이은 글 === before, `same+ins` 이은 글 === after.
  - 같은 종류가 이어지면 세그먼트 하나로 합쳐진다(연속한 `same` 두 개가 나오지 않는다). 한 변경 구간에서 `del`이 `ins`보다 앞에 온다.
  - 어절 수 곱이 250,000을 넘는 입력(예: 600어절 × 600어절, 서로 다른 단어) → 정확히 `[{del, before}, {ins, after}]`.
  - 한쪽만 끝에 어절이 추가된 경우 `ins` 하나만 늘어난다.

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/textDiff.test.ts` → 모듈 없음으로 FAIL.

- [ ] **Step 3: `diffWords(before, after): DiffSegment[]` 구현** — `/(\s+)/`로 나눈 토큰(공백도 토큰, 빈 토큰 제외)을 DP로 LCS를 구해 되짚는다. 한 변경 구간은 `del` 먼저 `ins` 나중. 같은 종류 연속 세그먼트는 합친다. 토큰 수 곱이 `250_000`(`MAX_DIFF_CELLS` 상수)을 넘으면 DP를 건너뛰고 위 통째 교체를 돌려준다. `before === after`는 DP 없이 바로 반환.

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/textDiff.test.ts` → 전부 PASS.

- [ ] **Step 5: 커밋** — `git add lib/textDiff.ts lib/textDiff.test.ts` → `feat: add word-level text diff for side-by-side compare`.

---

### Task 2: 편집 순수 로직·타입 (`lib/masterReview.ts`)

**Files:**
- Modify: `lib/masterReview.ts`
- Test: `lib/masterReview.test.ts` (기존 파일에 추가; 없으면 생성)

**Interfaces:**
- Consumes: 같은 파일의 `MasterChapter`, `buildSaveEdits`, `isChapterEdited`, `normalizeParagraphs`.
- Produces (모두 `lib/masterReview.ts`에서 export, `"server-only"` import 금지):
  - `type DraftEdit = { num: number; paragraphs: string[] }`
  - `type PublishedDraft = { edits: DraftEdit[]; baseContentVersion: number; updatedAt: number; stale: boolean }` (`updatedAt`은 ms)
  - `EditorDetail`에 선택 필드 `contentVersion?: number`, `draft?: PublishedDraft | null` 추가
  - `const PUBLISHED_DRAFTS_COLLECTION = "publishedDrafts"`, `const MAX_DRAFT_CHARS = 250_000`
  - `findUnsavableReason(edits: { chapterNumber: number; chapterTitle: string; body: string }[]): string | null`
  - `applyPublishedEdits(chapters: MasterChapter[], edits: DraftEdit[]): MasterChapter[]`
  - `isValidDraftEdits(value: unknown): value is DraftEdit[]`
  - `chaptersDiffer(a: MasterChapter[], b: MasterChapter[]): boolean`
  - `pairedParagraph(base: MasterChapter[], chapterNumber: number, paragraphIndex: number, paragraphCount: number): string | undefined`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `findUnsavableReason`: 문제 없으면 `null`; 제목이 공백뿐이면 `"2장 제목이 비어 있어요"`; 본문이 공백뿐이면 `"3장 본문이 비어 있어요"`; 둘 이상이면 배열 순서상 첫 문제만; 빈 배열 → `null`.
  - `applyPublishedEdits`: 해당 `num` 챕터의 `paragraphs`만 교체, 제목·다른 챕터는 그대로; 없는 `num`은 무시; 입력 배열을 바꾸지 않는다(원본 객체 불변 확인).
  - `isValidDraftEdits`: `[]`는 true; 정상 `[{num:1, paragraphs:["가"]}]` true; 배열 아님·`num`이 정수 아님·`paragraphs`에 문자열 아닌 값·같은 `num` 중복 → false; 글자 수 합이 `MAX_DRAFT_CHARS`를 넘으면 false(경계: 정확히 `MAX_DRAFT_CHARS`는 true).
  - `chaptersDiffer`: 같은 내용(정규화 무시: 문단 안 빈 줄만 다름)이면 false; 제목이 다르면 true; 문단이 다르면 true; 챕터 수가 다르면 true.
  - `pairedParagraph`: 문단 수가 `paragraphCount`와 같을 때만 해당 문단을 돌려주고, 챕터가 없거나 수가 다르면 `undefined`. (지금 `MasterEditor`의 `originalText` 계산과 같은 규칙.)
  - **고정 테스트**(Review Focus 3): `chapters`에 빈 문단 `""`과 문단 안 빈 줄이 섞여 있어도, 정규화한 `baseline`과 비교한 `buildSaveEdits(chapters, baseline)`가 `[]`이다.

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/masterReview.test.ts` → 새 함수 없음으로 FAIL (고정 테스트는 이미 통과해도 된다 — 그건 기존 동작을 못박는 것이므로 나머지가 FAIL이면 충분).

- [ ] **Step 3: 구현** — 위 시그니처대로 `lib/masterReview.ts`에 추가. `findUnsavableReason`의 문구는 정확히 `"{n}장 제목이 비어 있어요"` / `"{n}장 본문이 비어 있어요"`. `pairedParagraph`는 `MasterEditor.tsx:105-108`의 로직을 옮긴 것(이 Task에서는 MasterEditor를 건드리지 않는다).

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/masterReview.test.ts` PASS, `npx tsc --noEmit` 통과.

- [ ] **Step 5: 커밋** — `feat: add draft/compare helpers to masterReview`.

---

### Task 3: 자동 저장 모듈 `createAutosaver` + 상태 문구

**Files:**
- Create: `lib/autosaver.ts`
- Test: `lib/autosaver.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces:
  - `const AUTOSAVE_DELAY_MS = 3000`
  - `type AutosaveStatus = { kind: "idle" } | { kind: "pending" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "skipped"; reason: string } | { kind: "failed"; message: string }`
  - `type AutosaveResult = { ok: true } | { skipped: string } | { error: string }`
  - `createAutosaver(options: { delayMs: number; save: () => Promise<AutosaveResult>; onStatus: (status: AutosaveStatus) => void }): { notify(): void; flush(): Promise<void>; cancel(): void }`
  - `describeAutosaveStatus(status: AutosaveStatus): { text: string; tone: "muted" | "busy" | "ok" | "warn" | "error"; retry: boolean }`
  - `formatClock(at: number): string` — 로컬 시간의 `HH:MM`(두 자리, 24시간). 상태 칩과 Task 7의 초안 줄이 함께 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** (`vi.useFakeTimers()`, `save`는 `vi.fn`)
  - `formatClock`: 로컬 구성요소로 만든 `new Date(2026, 10, 21, 9, 5).getTime()` → `"09:05"`, `new Date(2026, 10, 21, 14, 32).getTime()` → `"14:32"`.
  - `notify()` 후 `delayMs` 전에는 `save`가 불리지 않고 상태가 `pending`; `delayMs`가 지나면 `save` 1회 호출, 성공 시 `saved`(`at`은 `Date.now()`)로 끝난다. 상태는 `pending → saving → saved` 순으로 `onStatus`에 전달.
  - 연속 `notify()`(각각 `delayMs`보다 짧은 간격)는 `save`를 한 번만 부른다(디바운스, 타이머 재설정).
  - **직렬화**(Review Focus 2): `save`가 끝나기 전(해결되지 않은 프로미스)에 `notify()`가 와도 두 번째 `save`가 동시에 시작하지 않는다. 첫 저장이 끝나면 상태가 `pending`이 되고 `delayMs` 뒤에 한 번 더 저장한다. 변경이 없었으면 추가 저장 없음.
  - `save`가 `{ skipped: "3장 본문이 비어 있어요" }`면 `skipped`(이유 포함); `{ error: "x" }`면 `failed`("x"); `save`가 throw해도 `failed`(Error면 그 메시지, 아니면 `"저장 실패"`). 둘 다 자동 재시도 루프 없음 — 다음 `notify()`에서 다시 시도.
  - `flush()`: 상태가 `pending`이면 타이머를 기다리지 않고 즉시 저장하고 끝나면 resolve; 저장 중이면 그 저장이 끝날 때까지(그 사이 변경이 있었으면 한 번 더 즉시) 기다린다; `failed`/`skipped`면 즉시 다시 시도한다; `idle`/`saved`면 아무것도 하지 않고 resolve.
  - `cancel()` 뒤에는 타이머가 돌아도 `save`가 불리지 않고 `onStatus`도 더 불리지 않는다.
  - `describeAutosaveStatus`: `idle` → `{ text: "", tone: "muted", retry: false }`; `pending` → `"저장하지 않은 수정 있음"`(warn); `saving` → `"저장 중…"`(busy); `saved` → `"✓ 임시 저장됨 · 14:32"`(ok, 시각은 로컬 시간의 `HH:MM` 두 자리 — 테스트는 로컬 구성요소로 만든 `Date`로 기대값을 만든다); `skipped` → `"자동 저장 건너뜀 · {reason}"`(warn); `failed` → `"자동 저장 실패 · 다시 시도"`(error, `retry: true`).

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/autosaver.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `createAutosaver` 클로저(타이머 id, 진행 중 프로미스, `changedWhileSaving` 플래그, `cancelled` 플래그, 마지막 상태). `describeAutosaveStatus`는 순수 함수. 파일 상단에 "컴포넌트와 무관한 순수 모듈 — 가짜 타이머로 테스트한다" 한 줄.

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/autosaver.test.ts` PASS.

- [ ] **Step 5: 커밋** — `feat: add autosaver (debounce, serialized saves, status text)`.

---

### Task 4: 게시본 초안 서버 쪽

**Files:**
- Create: `lib/actions/publishedDraftActions.ts`, `lib/actions/publishedDraftActions.test.ts`
- Modify: `lib/actions/masterReviewActions.ts` (`editPublishedStoryAction`), `lib/actions/masterReviewActions.test.ts`
- Modify: `lib/data/masterReviews.ts` (`mapPublishedDraft`, `getPublishedStoryForEdit`), `lib/data/masterReviews.test.ts`

**Interfaces:**
- Consumes (Task 2): `DraftEdit`, `PublishedDraft`, `PUBLISHED_DRAFTS_COLLECTION`, `MAX_DRAFT_CHARS`, `isValidDraftEdits`.
- Produces:
  - `savePublishedDraftAction(input: { docId: string; edits: DraftEdit[]; baseContentVersion: number }): Promise<{ error?: string }>`
  - `discardPublishedDraftAction(docId: string): Promise<{ error?: string }>`
  - `mapPublishedDraft(raw: unknown, currentContentVersion: number): PublishedDraft | null` (`lib/data/masterReviews.ts`에서 export)
  - `getPublishedStoryForEdit`의 `detail`에 `contentVersion`(숫자, 없으면 0)과 `draft`가 채워진다.
- Firestore 모양: `publishedDrafts/{docId}` = `{ edits: DraftEdit[]; baseContentVersion: number; updatedAt: Date }`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `publishedDraftActions.test.ts` — `server-only`·`@/lib/auth/session`·`@/lib/firebase/admin`·`next/cache`를 `masterReviewActions.test.ts`처럼 모킹하고, `getAdminFirestore`가 `collection(name).doc(id)`에서 `{ get, set, delete }`를 돌려주는 가짜 DB(문서 키 `"컬렉션/id"`)를 쓴다.
    - 세션 없음 → 두 액션 모두 `{ error: "관리자 로그인이 필요합니다" }`, DB 접근 없음.
    - 잘못된 입력(`edits` 모양 오류, `baseContentVersion`이 음수·비정수, `docId`가 빈 문자열이거나 `/` 포함) → `{ error }`이고 `set` 호출 없음.
    - 게시된 소설이 없거나(`stories`/`storyContent` 문서 없음) `lang !== "ko"` → `{ error: "게시된 한국어 소설을 찾을 수 없습니다" }`, `set` 없음.
    - 정상 → `publishedDrafts/{docId}`에 `{ edits, baseContentVersion, updatedAt: expect.any(Date) }`를 `set`, `{}` 반환.
    - **Review Focus 4**: `edits: []` → `set` 대신 `delete` 호출, `{}` 반환.
    - `discardPublishedDraftAction("d1")` → `delete` 호출, `{}`; DB가 throw하면 `{ error }`(메시지 그대로).
  - `masterReviewActions.test.ts`에 추가: `editPublishedStoryAction`이 성공하면 `publishedDrafts/{docId}` 삭제를 부르고 결과는 기존과 같다; 삭제가 throw해도 결과(경고·버전)는 그대로 성공이다; 반영이 실패(`editPublishedStory` reject)하면 초안을 지우지 않는다.
  - `masterReviews.test.ts`에 추가:
    - `mapPublishedDraft`: `undefined`/`null`/모양 오류(`edits` 이상, `baseContentVersion` 숫자 아님) → `null`; 정상이고 `baseContentVersion === currentContentVersion` → `stale: false`; **Review Focus 5**: 버전이 다르면 `stale: true`; `updatedAt`이 Firestore `Timestamp`처럼 `toMillis()`가 있으면 그 값, `Date`면 `getTime()`, 그 밖은 `0`.
    - `getPublishedStoryForEdit`: `getAdminFirestore`를 가짜로(stories·storyContent·publishedDrafts 세 문서; `sessionId` 없는 story) → `detail.contentVersion`이 story의 `contentVersion`(없으면 0), `detail.draft`가 초안 또는 `null`. 초안이 없을 때 `null`.

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/actions/publishedDraftActions.test.ts lib/actions/masterReviewActions.test.ts lib/data/masterReviews.test.ts` → 새 케이스 FAIL(기존 21개는 통과).

- [ ] **Step 3: 구현**
  - `publishedDraftActions.ts`(`"use server"`): `savePublishedDraftAction`, `discardPublishedDraftAction`. `docId` 검사 → `isValidDraftEdits` 검사 → `stories/{docId}`·`storyContent/{docId}` 존재·`lang === "ko"` 확인 → `edits`가 비면 `delete`, 아니면 `set({ edits, baseContentVersion, updatedAt: new Date() })`. 모두 `try/catch`로 `{ error }`(기존 `messageOf` 패턴을 따르되 파일 안에 작은 비공개 헬퍼로). `revalidatePath`는 부르지 않는다(목록이 초안을 보여주지 않는다).
  - `editPublishedStoryAction`: `editPublishedStory` 성공 직후 `try { await getAdminFirestore().collection(PUBLISHED_DRAFTS_COLLECTION).doc(input.docId).delete() } catch {}` 후 기존 반환.
  - `masterReviews.ts`: `mapPublishedDraft` 구현(`isValidDraftEdits`로 `edits` 확인). `getPublishedStoryForEdit`의 `Promise.all`에 `publishedDrafts/{docId}` 읽기를 더하고 `detail`에 `contentVersion: typeof story.contentVersion === "number" ? story.contentVersion : 0`, `draft: mapPublishedDraft(draftSnap.exists ? draftSnap.data() : undefined, contentVersion)`를 넣는다.

- [ ] **Step 4: 통과 확인** — 위 세 테스트 파일 PASS, `npx tsc --noEmit` 통과.

- [ ] **Step 5: 커밋** — `feat: add published-story drafts (server actions and read path)`.

---

### Task 5: 화면 부품 — 색 층 입력창, 비교 칸, 자동 저장 훅, 상태 칩

**Files:**
- Create: `components/admin/HighlightedTextarea.tsx`, `components/admin/useAutosave.ts`, `components/admin/SaveStatusChip.tsx`
- Modify: `components/admin/ParagraphWorkspace.tsx`

**Interfaces:**
- Consumes: Task 1 `DiffSegment`/`diffWords`; Task 3 `createAutosaver`, `AUTOSAVE_DELAY_MS`, `AutosaveStatus`, `AutosaveResult`, `describeAutosaveStatus`.
- Produces:
  - `HighlightedTextarea(props: { value: string; onChange: (next: string) => void; highlight: DiffSegment[] | null; disabled?: boolean; "aria-label": string })` — `highlight`는 `diffWords(이전, value)`의 결과(`null`이면 색 없음).
  - `useAutosave(save: () => Promise<AutosaveResult>): { status: AutosaveStatus; notify: () => void; flush: () => Promise<void> }` — 마지막 렌더의 `save`를 ref로 들고 있어 항상 최신 상태를 읽는다. 마운트 시 `createAutosaver`를 한 번 만들고 언마운트 시 `cancel()`.
  - `SaveStatusChip(props: { status: AutosaveStatus; onRetry: () => void })`
  - `ParagraphWorkspace` props 변경: `originalText`·`showOriginal`을 제거하고 `compareText: string | undefined`, `compareLabel: string`, `showCompare: boolean`을 추가(나머지 props 그대로).

- [ ] **Step 1: `HighlightedTextarea` 구현** — 래퍼(`relative`, 배경색은 래퍼가 가짐) 안에 ① 뒤쪽 층 `div`(`aria-hidden`, `absolute inset-0`, 글은 투명, `highlight`의 `ins` 구간만 초록 배경 `<mark>`, `same`은 투명 `<span>`, `del`은 그리지 않음, 끝에 `"\u200b"`를 붙여 마지막 빈 줄 높이를 입력창과 맞춤), ② 앞쪽 `textarea`(`relative z-10`, 배경 투명, `border-2 border-primary`, 높이 자동 조절). 층과 입력창이 **같은 글꼴·크기·줄 간격·여백·`whitespace-pre-wrap`·`break-words`**를 쓰도록 클래스 문자열을 상수 하나(`TEXT_BOX_CLASS`)로 공유하고, 층에는 입력창과 같은 두께의 투명 테두리를 준다. 높이 자동 조절: `useLayoutEffect`로 `value`가 바뀔 때 `style.height = "auto"` 후 `scrollHeight`로 설정, 창 크기 변경 시에도 다시 계산(`resize` 이벤트). 최소 6줄 높이. `resize-none`, `overflow-hidden`.

- [ ] **Step 2: `useAutosave`·`SaveStatusChip` 구현** — 훅은 상태(`useState<AutosaveStatus>`)를 `onStatus`로 갱신. 칩은 `describeAutosaveStatus`로 문구·색을 정하고 `aria-live="polite"` 영역 안에 글을 둔다(`text`가 `""`이면 아무것도 그리지 않음), `retry`가 참이면 `다시 시도` 버튼을 함께 그린다. 색은 기존 배지 톤(`success`/`warning`/`destructive` 계열 클래스)을 따른다.

- [ ] **Step 3: `ParagraphWorkspace` 수정** — "내가 쓰기" 구역의 `textarea`와 `showOriginal` 취소선 한 줄을 없애고 다음으로 바꾼다. `showCompare`가 참이면 `grid gap-3 xl:grid-cols-2`: 왼쪽 칸(제목 `이전 버전 · {compareLabel}`, 읽기 전용, `diffWords(compareText, text)`에서 `same`+`del`만 그리며 `del`은 빨강 배경+취소선), 오른쪽 칸(제목 `내가 고쳐쓰는 중`, `HighlightedTextarea`에 `highlight={diffWords(compareText, text)}`). `showCompare`가 거짓이면 오른쪽 칸만(`highlight={null}`). `compareText === undefined`면 왼쪽 칸에 "문단을 추가·삭제·이동해서 이전 버전과 짝을 맞출 수 없어요"를 보여주고 `highlight={null}`. `compareText === text`면 왼쪽 칸에 이전 버전 글을 그대로 보이고 아래에 "아직 바꾼 곳이 없어요". `diffWords`는 `useMemo([compareText, text])`로 계산한다. 글자 수 표시·다듬기 요청 UI·버전 기록은 그대로 둔다. `edited` 변수와 `originalText`/`showOriginal` 참조를 모두 제거한다.

- [ ] **Step 4: 검증** — `npx tsc --noEmit`은 `MasterEditor.tsx`가 아직 옛 props를 넘겨서 실패할 수 있다 — 이 Task에서는 `ParagraphWorkspace` 호출부(`MasterEditor.tsx`)를 `compareText={originalText}`·`compareLabel="원본"`·`showCompare={showOriginal}`로 최소 수정해 컴파일만 맞춘다(Task 6에서 정식 연결). `npx tsc --noEmit` 통과, `npx eslint components/admin/HighlightedTextarea.tsx components/admin/useAutosave.ts components/admin/SaveStatusChip.tsx components/admin/ParagraphWorkspace.tsx components/admin/MasterEditor.tsx` 오류 없음.

- [ ] **Step 5: 커밋** — `feat: add highlighted textarea, side-by-side compare pane, autosave hook`.

---

### Task 6: `MasterEditor` — 비교 연결 + 마스터 검토 자동 저장

**Files:**
- Modify: `components/admin/MasterEditor.tsx`

**Interfaces:**
- Consumes: Task 2 `pairedParagraph`, `chaptersDiffer`, `findUnsavableReason`, `buildSaveEdits`; Task 3 `AutosaveResult`; Task 5 `useAutosave`, `SaveStatusChip`, `ParagraphWorkspace`의 새 props.
- Produces: 이후 Task 7이 쓰는 `useAutosave` 인스턴스(`autosave`), `locked` 규칙, `compareBase` 상태.

- [ ] **Step 1: 비교 연결**
  - `showOriginal` 상태를 `showCompare`로 바꾸고 기본값 `true`, 버튼 문구를 `나란히 보기`(`aria-pressed`)로.
  - `compareBase: "original" | "opened"`(기본 `"original"`) 상태. `openedChapters`는 마운트 시점의 `detail.chapters`(변하지 않는 값, `useState(() => detail.chapters)`). `hasOpenedDiff = isReview && chaptersDiffer(detail.chapters, detail.original)`.
  - `compareText = pairedParagraph(compareBase === "opened" ? openedChapters : detail.original, currentChapter.chapterNumber, paragraphIndex, currentChapter.paragraphs.length)`, `compareLabel = compareBase === "opened" ? "열었을 때" : "원본"`. 기존 `originalChapter`/`originalText` 계산은 삭제.
  - `hasOpenedDiff`이고 `view === "edit"`이고 `showCompare`일 때만 툴바에 `이전 버전` `<select>`(`원본`/`열었을 때`)를 보인다.

- [ ] **Step 2: 자동 저장(마스터 검토)** — `autosaveSave(): Promise<AutosaveResult>`를 만들어 `useAutosave(autosaveSave)`에 넘긴다. 마스터 검토에서의 동작(게시본은 Task 7):
  1. `normalized = chapters.map(c => ({ ...c, paragraphs: normalizeParagraphs(c.paragraphs) }))`, `edits = buildSaveEdits(normalized, baseline)`, `confirmedNow = confirmed`.
  2. 바뀐 게 없으면(`edits`가 비고 `sameNumbers(confirmedNow, savedConfirmed)`) `{ ok: true }`.
  3. `findUnsavableReason(edits)`가 있으면 `{ skipped: 이유 }`.
  4. `saveMasterReviewAction({ sessionId: detail.id, edits, confirmedChapters: confirmedNow })` — `error`면 `{ error }`.
  5. 성공하면 **`setBaseline(normalized)`, `setSavedConfirmed(confirmedNow)`만** 한다(`setChapters` 금지 — 커서 보호; `normalized`는 보낸 시점 스냅샷이라 저장 중 이어 쓴 글은 계속 dirty). `{ ok: true }`.
  - `useEffect`로 `[chapters, confirmed]`가 바뀌어 `dirty`이고 `!locked`이면 `autosave.notify()`.
  - `handleSave`와 `handleApprove`는 맨 앞에서 `await autosave.flush()`를 먼저 부른다. `locked` 동안엔 `notify`하지 않는다.
  - 선택한 문단이 바뀔 때(`selected.chapterNumber`/`selected.paragraphIndex`) 그리고 `visibilitychange`가 `hidden`이 될 때 `void autosave.flush()`.
  - 머리줄 툴바에 `<SaveStatusChip status={autosave.status} onRetry={() => void autosave.flush()} />`를 `DownloadButton` 앞에 둔다.
  - 수동 `임시 저장` 버튼·`save()`·`beforeunload` 경고(`dirty` 기준)는 그대로.

- [ ] **Step 3: 검증** — `npx tsc --noEmit`, `npx eslint components/admin/MasterEditor.tsx` 통과, `npx vitest run` 전체 통과.

- [ ] **Step 4: 커밋** — `feat: autosave drafts and side-by-side compare in master review editor`.

---

### Task 7: `MasterEditor` — 게시본 초안 → 반영

**Files:**
- Modify: `components/admin/MasterEditor.tsx`

**Interfaces:**
- Consumes: Task 2 `applyPublishedEdits`, `buildPublishedEdits`, `PublishedDraft`; Task 4 `savePublishedDraftAction`, `discardPublishedDraftAction`, `detail.contentVersion`, `detail.draft`; Task 6의 `autosave`.
- Produces: 게시본 모드의 `unsaved`/`canApply` 구분과 초안 UI.

- [ ] **Step 1: 상태 초기화 (게시본)**
  - `liveBaseline`(상태, 초기 `detail.chapters`), `liveVersion`(상태, 초기 `detail.contentVersion ?? 0`).
  - 열릴 때 `detail.draft`가 있고 `!detail.draft.stale`이면 `chapters`와 `baseline` 초기값을 `applyPublishedEdits(detail.chapters, detail.draft.edits)`로, `draftInfo`(상태: `{ updatedAt: number } | null`)를 `{ updatedAt: detail.draft.updatedAt }`로. 그 밖에는 `chapters = baseline = detail.chapters`, `draftInfo = null`.
  - `detail.draft?.stale`이면 `staleDraft` 상태에 그 초안을 담는다.
  - `dirty`를 게시본에서는 `unsaved = buildPublishedEdits(chapters, baseline).length > 0`로(마스터 검토 규칙은 그대로). `canApply = buildPublishedEdits(chapters, liveBaseline).length > 0`.

- [ ] **Step 2: 자동 저장·수동 저장(게시본)** — `autosaveSave`가 게시본일 때: `normalized`를 만들고 `buildPublishedEdits(normalized, baseline)`이 비어 있으면 `{ ok: true }`; 아니면 `edits = buildPublishedEdits(normalized, liveBaseline)`로 `savePublishedDraftAction({ docId: detail.id, edits, baseContentVersion: liveVersion })` — `error`면 `{ error }`; 성공하면 `setBaseline(normalized)`, `setDraftInfo(edits.length ? { updatedAt: Date.now() } : null)`(`setChapters` 금지). 머리줄 `임시 저장` 버튼(게시본 포함 두 모드 공통, 라벨 규칙 동일)은 게시본에서 `await autosave.flush()` 후 같은 저장을 한 번 더 부르고, 실패하면 지금처럼 오류 배너에 보인다.

- [ ] **Step 3: 반영** — 아래쪽 큰 버튼 문구를 `게시본에 저장` → `게시본에 반영`으로, `disabled={!canApply || locked}`로. 눌렀을 때: `await autosave.flush()` → `normalized`로 `edits = buildPublishedEdits(normalized, liveBaseline)` → `editPublishedStoryAction`(기존과 같은 오류·경고 처리) → 성공하면 `setChapters(normalized)`, `setBaseline(normalized)`, `setLiveBaseline(normalized)`, `setLiveVersion(result.contentVersion ?? liveVersion + 1)`, `setDraftInfo(null)`, `setSavedAt(true)`. 하단 안내문을 "`게시본에 반영`을 누르기 전까지는 초안으로만 남고 게시된 글은 바뀌지 않아요. 반영하면 바로 공개되고 수정 전 내용은 기록으로 남아요."로, 상단 안내(표현 다듬기만 가능 문구)는 그대로 둔다.

- [ ] **Step 4: 초안 칩·경고 UI**
  - `draftInfo`가 있으면 작업 영역 위에 줄 하나: "초안 {HH:MM}으로 저장돼 있어요 · 아직 게시본에는 반영되지 않았어요"와 `초안 버리기` 버튼. 누르면 `window.confirm("초안을 버리고 게시된 내용으로 되돌릴까요?")` 후 `discardPublishedDraftAction(detail.id)` → 성공하면 `setChapters(liveBaseline)`, `setBaseline(liveBaseline)`, `setDraftInfo(null)`(`error`면 배너).
  - `staleDraft`가 있으면 경고 상자: "초안을 만든 뒤 게시본이 바뀌었어요. 불러오면 초안에 든 장의 문단이 초안 내용으로 바뀝니다." + `불러오기`(`setChapters(applyPublishedEdits(chapters, staleDraft.edits))`, `setStaleDraft(null)` — `baseline`은 그대로라서 곧 `unsaved`가 되어 새 버전 기준으로 자동 저장됨) / `초안 버리기`(`discardPublishedDraftAction` → `setStaleDraft(null)`).
  - 시각은 Task 3의 `formatClock(updatedAt)`로 `HH:MM`을 만든다.

- [ ] **Step 5: 검증** — `npx tsc --noEmit`, `npx eslint components/admin/MasterEditor.tsx lib/autosaver.ts`, `npx vitest run` 전체 통과.

- [ ] **Step 6: 커밋** — `feat: autosave published drafts with explicit apply-to-live step`.

---

### Task 8: 문서와 전체 검증

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: `CLAUDE.md`에 한 단락 추가** — 자동 임시 저장(3초, 마스터 검토는 기존 `saveMasterReview` 재사용, 제목·본문이 비면 건너뜀), 게시본 초안(`publishedDrafts/{docId}`, `게시본에 반영` 전에는 공개되지 않음, `contentVersion`이 다르면 stale로 자동 적용하지 않음), 나란히 보기(`lib/textDiff.ts`, `xl` 이상 좌우)를 기존 "채팅/다운로드" 설명 옆에 같은 톤으로 적는다. `publishedDrafts`는 Admin SDK로만 접근한다는 점(클라이언트 SDK·Firestore 규칙으로 열지 말 것)도 적는다.

- [ ] **Step 2: Firestore 규칙 확인** — 저장소에서 보안 규칙 파일(`firestore.rules`)을 찾는다(word-bank-web, 그리고 `C:\Users\TAEJIN\Documents\word-bank`, `story-generator`). `publishedDrafts` 컬렉션이 클라이언트에 열릴 수 있는 와일드카드 허용이 있으면 규칙을 직접 바꾸지 말고 사용자에게 보고한다(규칙은 앱·웹이 공유하는 곳이라 배포 영향이 크다). 규칙이 없거나 기본 거부면 "해당 없음"으로 기록.

- [ ] **Step 3: 전체 검증** — `npx vitest run`(전체 PASS, 개수를 보고), `npx tsc --noEmit`, `npm run lint`(저장소 전체 깨끗), `npm run build`(성공).

- [ ] **Step 4: 브라우저 확인 목록을 최종 보고에 포함** (관리자 Google 로그인이 필요해 자동 확인 불가 — 사용자가 직접 확인): 
  1. 마스터 검토 문단 편집: 좌우 나란히(`xl`), 위아래(`lg` 이하), 이전 버전 칸의 빨강/오른쪽 초록 정렬이 글자와 어긋나지 않는지(줄바꿈이 긴 문단, 마지막 줄이 빈 줄인 경우, 한글 조합 입력 중).
  2. 3초 뒤 칩이 `저장 중… → ✓ 임시 저장됨`으로 바뀌고, 새로고침해도 글이 남는지. 타이핑 중 커서가 튀지 않는지. 제목을 비웠을 때 "건너뜀"이 뜨는지.
  3. 게시본: 고치고 기다리면 "초안 …" 줄이 뜨고 게시된 글(앱·`/admin/published`)은 안 바뀌는지, 새로고침하면 초안이 불러와지는지, `초안 버리기`, `게시본에 반영` 후 공개 글이 바뀌고 초안 줄이 사라지는지, 게시본이 바뀐 뒤 열면 경고가 뜨는지.
  4. `이전 버전` 선택창(`원본`/`열었을 때`)이 마스터 검토에서 저장본이 있을 때만 보이는지.
  - 이상이 있으면 `vercel logs`로 서버 액션 오류를 본다.

- [ ] **Step 5: 커밋** — `docs: document autosave, published drafts and side-by-side compare`.
