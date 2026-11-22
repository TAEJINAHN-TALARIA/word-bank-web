# 마스터 편집 화면 개선 ① Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문단 정리 모달(전 장 대사 나누기 + Claude 구성 제안), 소설·장 제목 편집·저장, 대화에서 제목 의논, 챕터 목록·대화창 고정 배치를 만든다.

**Architecture:** 소설 제목은 story-generator의 `adminSaveMasterReview`가 `layer1.output.title`에 저장한다(선택 필드 `title`). 웹은 제목 상태를 `MasterEditor`가 들고 자동 저장에 실어 보내고, 대화는 요청에 `title`과 제목용 `ChatFocus`를 더한다. 문단 정리는 순수 로직(`lib/paragraphCleanup.ts`)과 네이티브 `<dialog>` 모달 컴포넌트로 만들어 기존 장별 패널 둘을 대체한다.

**Tech Stack:** word-bank-web(Next.js 16 App Router, React, TypeScript, Tailwind v4, Vitest node 환경 — 컴포넌트 렌더 테스트 없음), story-generator(Node ESM, `node:test`, Firebase Cloud Functions).

**Spec:** `docs/superpowers/specs/2026-11-22-editor-cleanup-modal-titles-design.md`

## Global Constraints

- 소설 제목 길이는 앞뒤 공백을 뺀 1~120자. 검토 모드(마스터 검토 대기 상태)에서만 저장된다.
- `title`을 보냈는데 저장 응답에 같은 `title`이 없으면 웹은 오류를 돌려준다(함수 미배포 방어). 배포 순서는 **Cloud Function 먼저, 웹(push) 나중**.
- Server Action은 throw하지 않고 `{ error }`를 돌려준다. 모든 액션은 `getAdminSession()`을 다시 확인한다(기존 규칙).
- 문단 정리의 글자 보존: 대사 나누기는 글자를 바꾸지 않고, Claude 제안은 문단 경계(나누기·합치기)만 바꾼다(기존 `applyStructureChanges`).
- 게시본(`published`) 모드에는 제목 편집·문단 정리·제목 대화 칩을 노출하지 않는다.
- 코드 주석은 한국어 "왜"만 짧게, 주변 코드 스타일을 따른다. 파일은 기존대로 LF로 쓰고(저장소가 CRLF 경고를 낼 수 있음) 기존 파일의 줄바꿈은 보존한다.
- 실행 중 shell이 백슬래시를 지울 수 있으니 정규식·`\n`이 든 수정은 Edit/Write 도구로 한다.

## Review Focus

- 함수 미배포 상태에서 `title`을 보내면 저장된 척하지 않고 오류가 난다 → Task 2 테스트.
- 제목이 빈 채로 자동 저장되면 서버에 보내지 않고 "건너뜀"이 된다 → Task 3 코드 읽기(`findUnsavableReason` 확장 테스트).
- 승인(`approved`) 뒤에는 제목 입력이 잠기고 저장도 거절된다(함수의 상태 검증) → Task 1 테스트.
- 한 장의 Claude 제안이 실패해도 나머지 장은 계속되고, 모달을 닫으면 남은 호출이 중단된다 → Task 6 코드 읽기.
- 대사 나누기로 문단 수가 늘어난 작업본 위에서 Claude 제안의 문단 번호와 `splitBefore`가 어긋나지 않는다(제안은 작업본 기준으로 검증된다) → Task 5 테스트.

---

### Task 1: story-generator — `adminSaveMasterReview`가 소설 제목을 저장한다

**Files (저장소: `C:/Users/TAEJIN/Documents/story-generator`, 새 브랜치 `feat/master-title-save`):**
- Modify: `src/pipeline/masterReview.js` (`validateMasterReviewSave`)
- Modify: `src/pipeline/firestoreSessionStore.js` (`saveMasterReviewEdits`)
- Modify: `functions/adminHandlers.js` (`adminSaveMasterReview`)
- Test: `tests/masterReview.test.js`

**Interfaces:**
- Produces:
  - `validateMasterReviewSave({ status, edits, confirmedChapters, title })` → 유효하면 `{ valid: true, title? }`(`title`이 주어졌으면 `trim()`한 값) / 아니면 `{ valid: false, error }`. `title`이 `undefined`면 검증하지 않는다. 주어졌는데 문자열이 아니거나 trim 후 길이가 0 또는 120 초과면 `{ valid: false, error: '소설 제목은 1~120자여야 합니다' }`.
  - `saveMasterReviewEdits(sessionId, chapters, confirmedChapters, title?)` — `title`이 문자열이면 `layerOutputs/layer1`에 `{ 'output.title': title }`를 `update`한다.
  - HTTP `adminSaveMasterReview`: 본문 `{ sessionId, edits, confirmedChapters, title? }`, 성공 응답 `{ success: true, title? }`(검증된 제목을 보냈을 때만 `title` 포함).

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`tests/masterReview.test.js`의 `validateMasterReviewSave` describe 안, 기존 상태 상수 사용)
  - `'title이 없으면 기존처럼 통과하고 title 필드를 돌려주지 않는다'`: `valid === true`, `'title' in result === false`.
  - `'title은 앞뒤 공백을 다듬은 값으로 돌려준다'`: `title: '  새 제목  '` → `{ valid: true, title: '새 제목' }`.
  - `'빈 제목·공백 제목·120자 초과·문자열이 아닌 제목은 거절한다'`: `''`, `'   '`, `'가'.repeat(121)`, `123` 각각 `valid === false`, error `/소설 제목/`. 정확히 120자는 통과.
  - `'검토 대기 상태가 아니면 제목이 있어도 거절한다'`: status를 승인 뒤 상태로 주면 `valid === false`.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/masterReview.test.js`
Expected: FAIL — 새 테스트(제목 검증)가 실패, 기존 테스트는 통과.

- [ ] **Step 3: 구현**
  - `validateMasterReviewSave`에 `title` 인자를 더하고 위 규칙대로 검증, 성공 값에 `title`(있을 때만)을 담는다. 기존 반환 모양(`{ valid: true }`)은 `title`이 없을 때 그대로.
  - `saveMasterReviewEdits`에 네 번째 인자 `title`을 더하고, 문자열이면 `layer1` 문서의 `output.title`을 `update`한다(기존 layer4 update는 그대로, `titleCandidates`는 건드리지 않음).
  - `adminSaveMasterReview`: 요청 본문에서 `title`을 꺼내 `validateMasterReviewSave`에 넘기고, 통과하면 `validation.title`을 `saveMasterReviewEdits`에 넘기며 응답에 `{ success: true, ...(validation.title !== undefined && { title: validation.title }) }`.

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/masterReview.test.js` 그리고 `npm test`(저장소 전체 테스트 명령, 없으면 `node --test tests/`)
Expected: PASS — 새 테스트 포함 전부 통과, 기존 테스트 변화 없음.

- [ ] **Step 5: 커밋** (story-generator 저장소, 새 브랜치에서)

```bash
git switch -c feat/master-title-save
git add src/pipeline/masterReview.js src/pipeline/firestoreSessionStore.js functions/adminHandlers.js tests/masterReview.test.js
git commit -m "feat: save the novel title from the master review save call"
```

(배포는 이 계획 밖에서 사용자 확인 후에 한다. 실행자는 Task 1~6이 끝나고 테스트가 통과한 뒤 배포 여부를 사용자에게 먼저 묻는다.)

---

### Task 2: 웹 — 저장 호출이 `title`을 전달하고 응답을 확인한다

**Files (저장소: `word-bank-web`, 새 브랜치 `feat/editor-cleanup-titles`):**
- Modify: `lib/admin-functions/storyGenerator.ts` (`saveMasterReview`)
- Modify: `lib/actions/masterReviewActions.ts` (`saveMasterReviewAction`)
- Modify: `lib/masterReview.ts` (제목 규칙)
- Test: `lib/masterReview.test.ts`, `lib/actions/masterReviewActions.test.ts`, `lib/admin-functions/` 쪽 기존 테스트가 있으면 거기(없으면 액션 테스트에서 모킹으로 확인)

**Interfaces:**
- Produces:
  - `lib/masterReview.ts`: `export const MAX_TITLE_CHARS = 120;` 와 `export function findUnsavableTitle(title: string): string | null`(trim 후 비면 `"소설 제목이 비어 있어요"`, 120자 초과면 `"소설 제목은 120자까지예요"`, 아니면 `null`).
  - `saveMasterReview(sessionId: string, edits: MasterEdit[], confirmedChapters: number[], title?: string): Promise<void>` — `title`이 있으면 요청 본문에 실어 보내고, 응답의 `title`이 보낸 값(trim)과 같지 않으면 `Error("서버가 제목 저장을 지원하지 않아요 — 함수 배포를 확인해 주세요")`를 던진다.
  - `saveMasterReviewAction(input: { sessionId; edits; confirmedChapters; title?: string }): Promise<{ error?: string }>` — `title`이 있으면 `findUnsavableTitle`로 먼저 검사해 오류면 `{ error }`로 돌려주고 함수를 부르지 않는다.

- [ ] **Step 1: 브랜치와 실패하는 테스트**
  - `git switch -c feat/editor-cleanup-titles` (이 계획·설계 문서 커밋 포함: `git add docs/superpowers/specs/2026-11-22-editor-cleanup-modal-titles-design.md docs/superpowers/plans/2026-11-22-editor-cleanup-modal-titles.md && git commit -m "docs: add editor cleanup modal and titles design and plan"`).
  - `lib/masterReview.test.ts`: `'findUnsavableTitle: 공백뿐이거나 120자를 넘으면 사유를 돌려주고 정상이면 null'`.
  - `lib/actions/masterReviewActions.test.ts`(기존 모킹 스타일): `'제목을 함께 저장하면 함수에 title을 넘긴다'`(`saveMasterReview`가 `(sessionId, edits, confirmed, "새 제목")`으로 호출됨), `'빈 제목이면 함수를 부르지 않고 error를 돌려준다'`, `'제목 없이 저장하면 기존처럼 title 인자 없이 부른다'`.
  - `saveMasterReview` 응답 확인 테스트(해당 모듈의 테스트 위치에서 `fetch`를 모킹): `'title을 보냈는데 응답에 title이 없으면 오류'`, `'응답 title이 보낸 값과 같으면 통과'`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/masterReview.test.ts lib/actions/masterReviewActions.test.ts`
Expected: FAIL — 새 테스트가 실패(정의되지 않은 함수·인자).

- [ ] **Step 3: 구현** 위 Interfaces 그대로.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run` — 전부 통과. `npx tsc --noEmit` — 이 시점에 타입 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add lib/masterReview.ts lib/masterReview.test.ts lib/admin-functions/storyGenerator.ts lib/actions/masterReviewActions.ts lib/actions/masterReviewActions.test.ts
git commit -m "feat: pass the novel title through the master review save call"
```

---

### Task 3: 웹 — 소설 제목 입력과 자동 저장

**Files:**
- Modify: `components/admin/MasterEditor.tsx`
- Modify: `components/admin/FullReadView.tsx`(제목 prop은 이미 있음 — 호출부만 편집 중인 제목으로)
- Test: `lib/masterReview.test.ts`(제목을 더한 저장 가능 여부 헬퍼가 필요하면 거기)

**Interfaces:**
- Consumes: `saveMasterReviewAction({ ..., title })`, `findUnsavableTitle` (Task 2).
- Produces: `MasterEditor` 내부 상태 `novelTitle`/`savedTitle`(둘 다 `string`, 초기값 `detail.title ?? ""`). 다른 태스크가 읽는 것: Task 4의 `ClaudePanel`에 `novelTitle`을 넘긴다.

- [ ] **Step 1: 상태와 입력을 더한다.** 검토 모드에서 머리줄 `<h1>`을 `aria-label="소설 제목"` 입력창으로 바꾼다(`locked`면 비활성, 기존 장 제목 입력과 같은 투명 테두리 스타일, `text-xl font-semibold`, `maxLength={MAX_TITLE_CHARS}`). 게시본 모드는 `<h1>`을 그대로 둔다.
- [ ] **Step 2: dirty·자동 저장에 제목을 반영한다.** 검토 모드 `dirty`에 `novelTitle.trim() !== savedTitle`을 더하고, `autosaveSave`의 검토 모드에서 제목이 바뀌었으면 `findUnsavableTitle(novelTitle)`이 사유를 주면 `{ skipped: 사유 }`로 건너뛰고(서버에 보내지 않음), 아니면 `saveMasterReviewAction`에 `title: novelTitle.trim()`을 함께 보낸다. 저장 성공 시 `setSavedTitle(novelTitle.trim())`. 제목만 바뀌고 `edits`가 비어도 저장이 일어나야 한다(기존 `edits.length === 0 && sameNumbers(...)` 조기 반환 조건에 "제목도 같음"을 더한다). `useEffect`의 `notifyAutosave` 의존성에 `novelTitle`을 더한다.
- [ ] **Step 3: 제목을 쓰는 곳을 편집 중인 값으로 바꾼다.** 원고 내려받기(`manuscriptFileName(…)`, `buildManuscriptText`, `buildPrintHtml`), `FullReadView`의 `title`, 머리줄. 게시본 모드는 `detail.title` 그대로.
- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: 오류 없음, 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add components/admin/MasterEditor.tsx components/admin/FullReadView.tsx
git commit -m "feat: edit and autosave the novel title in master review"
```

---

### Task 4: 웹 — 대화에서 제목을 의논한다

**Files:**
- Modify: `lib/chatProtocol.ts`(`ChatFocus`, `focusLine`)
- Modify: `lib/claude/chat.ts`(`ChatRequest`, `parseChatRequest`, `streamChat`)
- Modify: `lib/claude/editing.ts`(`buildChatSystemPrompt`)
- Modify: `app/admin/(dashboard)/editor-chat/route.ts`
- Modify: `components/admin/useEditorChat.ts`, `components/admin/EditorChat.tsx`, `components/admin/ClaudePanel.tsx`, `components/admin/MasterEditor.tsx`
- Test: `lib/chatProtocol.test.ts`, `lib/claude/chat.test.ts`, `lib/claude/editing.test.ts`

**Interfaces:**
- Produces:
  - `type ChatFocus = { chapterNumber: number; paragraphIndex: number } | { novelTitle: true } | { chapterNumber: number; chapterTitle: true } | null;`
  - `focusLine(focus)`: 제목 대상이면 `"[지금 보는 곳: 소설 제목]"`, `"[지금 보는 곳: N장 제목]"`. 기존 문단·`null` 결과는 그대로.
  - `ChatRequest`에 `title?: string`(1~`MAX_TITLE_CHARS`자 문자열일 때만, 아니면 요청 거절 `INVALID`).
  - `streamChat` 입력의 `title`이 있으면 `buildStoryContext`의 `제목:` 줄에 쓰인다.
  - `useEditorChat.send(text, { chapters, focus, title })` — 요청 본문에 `title`을 싣는다.

- [ ] **Step 1: 실패하는 테스트**
  - `lib/chatProtocol.test.ts`: `focusLine({ novelTitle: true })` === `"[지금 보는 곳: 소설 제목]"`, `focusLine({ chapterNumber: 3, chapterTitle: true })` === `"[지금 보는 곳: 3장 제목]"`; `stripFocus(withFocus("질문", { novelTitle: true }))` === `"질문"`.
  - `lib/claude/chat.test.ts`: `parseChatRequest`가 유효한 `title`을 값으로 돌려주고, 빈 문자열·121자·문자열 아닌 값은 `ok: false`; `title`이 없으면 기존처럼 통과(`value.title === undefined`).
  - `lib/claude/editing.test.ts`: `buildChatSystemPrompt("review")`가 제목 후보 제안 지침(`제목`과 `후보`가 든 줄)을 포함한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/chatProtocol.test.ts lib/claude/chat.test.ts lib/claude/editing.test.ts`
Expected: FAIL — 새 테스트 실패.

- [ ] **Step 3: 구현.** 위 Interfaces대로. 시스템 프롬프트에는 한 줄을 더한다: "제목(소설 제목·장 제목) 이야기가 나오면 후보를 3~5개, 각각의 어감과 이유와 함께 제안하세요. 제목을 직접 바꿨다고 말하지 마세요. 편집자가 정합니다." 라우트는 `parsed.value.title`을 `streamChat`에 넘긴다. 화면: `EditorChat` 머리(편집 보기에서만)에 대상 칩 `문단 | 이 장 제목 | 소설 제목`(`role="group"`, `aria-pressed`, 기본 `문단`), 선택값은 `ClaudePanel`이 들고(탭을 오가도 유지) `focus`를 만들어 보낸다 — 문단 칩이면 `MasterEditor`가 넘기는 기존 `focus`, 장 제목 칩이면 `{ chapterNumber: focus.chapterNumber, chapterTitle: true }`, 소설 제목 칩이면 `{ novelTitle: true }`. 칩 안내문구도 "지금 보는 곳" 줄이 칩에 맞게 바뀐다. `ClaudePanel`은 `novelTitle` prop을 받아 `chat.send(..., { chapters, focus, title: novelTitle })`로 넘긴다(검토 모드만 제목 전송, 게시본 모드는 `title` 없음·칩 없음).

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: 오류 없음, 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add lib/chatProtocol.ts lib/chatProtocol.test.ts lib/claude/chat.ts lib/claude/chat.test.ts lib/claude/editing.ts lib/claude/editing.test.ts "app/admin/(dashboard)/editor-chat/route.ts" components/admin/useEditorChat.ts components/admin/EditorChat.tsx components/admin/ClaudePanel.tsx components/admin/MasterEditor.tsx
git commit -m "feat: discuss the novel and chapter titles in the editor chat"
```

---

### Task 5: 웹 — 문단 정리 순수 로직

**Files:**
- Create: `lib/paragraphCleanup.ts`
- Test: `lib/paragraphCleanup.test.ts`

**Interfaces:**
- Consumes: `splitDialogue(paragraphs, mode): { paragraphs, skipped }`, `DialogueSplitMode` (`lib/dialogueSplit.ts`); `applyStructureChanges(paragraphs, accepted)`, `StructureChange` (`lib/claude/editing.ts`); `MasterChapter` (`lib/masterReview.ts`).
- Produces:
  ```ts
  export type CleanupBase = { chapters: MasterChapter[]; skipped: Record<number, number[]> };
  export function buildCleanupBase(chapters: MasterChapter[], dialogue: DialogueSplitMode | null): CleanupBase;
  export type ChapterOutcome = { chapterNumber: number; before: number; afterSplit: number; final: string[] };
  export function summarizeChapter(original: MasterChapter, base: MasterChapter, accepted: StructureChange[]): ChapterOutcome;
  ```
  `buildCleanupBase`: `dialogue`가 `null`이면 `chapters`를 그대로(복사) 돌려주고 `skipped`는 빈 객체. 아니면 각 장의 문단에 `splitDialogue`를 적용한 새 장 배열(장 제목·번호 그대로)과, 건너뛴 문단이 있는 장의 `{ [chapterNumber]: 번호들 }`. `summarizeChapter`: `before` = 원래 문단 수, `afterSplit` = 작업본 문단 수, `final` = `applyStructureChanges(base.paragraphs, accepted)`.

- [ ] **Step 1: 실패하는 테스트** (`describe("paragraphCleanup")`)
  - `'대사 나누기를 끄면(null) 글을 그대로 돌려준다'`: 입력과 `chapters`가 같고(참조는 새 배열) `skipped`가 `{}`.
  - `'대사 나누기를 켜면 장마다 문단이 나뉘고 장 제목·번호는 그대로다'`: 2개 장(한 장은 `["그가 웃었다. “가.” 그가 말했다."]`)에 `"separate"` 적용 → 그 장 문단이 `["그가 웃었다.", "“가.”", "그가 말했다."]`, 다른 장은 변화 없음, `chapterTitle` 보존.
  - `'짝이 맞지 않는 문단이 있는 장은 skipped에 번호가 남는다'`: `["그가 말했다. “열린 따옴표"]`인 2장 → `skipped` `{ 2: [1] }`.
  - `'작업본 위의 Claude 제안(splitBefore)을 적용한다'`: 작업본 문단 `["첫 문장입니다. 둘째 문장입니다."]`과 `{ kind: "split", paragraphIndex: 0, splitBefore: "둘째 문장입니다.", reason: "x" }`를 `summarizeChapter`에 주면 `final`이 `["첫 문장입니다.", "둘째 문장입니다."]`, `before`/`afterSplit`이 각각 원래·작업본 문단 수.
  - `'제안이 없으면 final은 작업본 문단 그대로'`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/paragraphCleanup.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** 위 Interfaces대로. "server-only"를 import하지 않는다(클라이언트에서 쓴다). `applyStructureChanges`가 `lib/claude/editing.ts`에서 클라이언트 import 가능한지 확인한다(`StructureSuggestions.tsx`가 이미 import 중이므로 가능).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/paragraphCleanup.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS, 전체 통과.

- [ ] **Step 5: 커밋**

```bash
git add lib/paragraphCleanup.ts lib/paragraphCleanup.test.ts
git commit -m "feat: add paragraph cleanup logic (dialogue split base and chapter summary)"
```

---

### Task 6: 웹 — 문단 정리 모달, 장별 패널 대체, 고정 배치, 문서

**Files:**
- Create: `components/admin/ParagraphCleanupModal.tsx`
- Modify: `components/admin/MasterEditor.tsx`(모달 연결·고정 배치·기존 두 패널 제거)
- Delete: `components/admin/StructureSuggestions.tsx`, `components/admin/DialogueSplit.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `buildCleanupBase`, `summarizeChapter` (Task 5); `suggestStructureAction({ mode, id, chapters, chapterNumber, instruction })`(기존, 반환 `{ error?, changes? }`); `StructureChange`; `MasterChapter`.
- Produces: `ParagraphCleanupModal({ open, onClose, mode, id, chapters, disabled, onApply }: { open: boolean; onClose: () => void; mode: "review" | "published"; id: string; chapters: MasterChapter[]; disabled: boolean; onApply: (next: Map<number, string[]>) => void })`.

- [ ] **Step 1: 모달 컴포넌트를 만든다.** 네이티브 `<dialog>`(`ref`, `open` prop에 따라 `showModal()`/`close()`, `onClose`/`onCancel` 이벤트로 `onClose` 호출, 열릴 때 상태 초기화). 설정 단계 옵션: `대사 나누기` 체크(기본 켜짐) + 방식 버튼 `대사만 따로`(기본)/`서술 붙이기`; `Claude 문단 구성 제안` 체크(기본 켜짐) + 신경 쓸 점 입력(선택, `maxLength={500}`); `실행` 버튼. 실행하면 `buildCleanupBase(chapters, 대사 켜짐 ? 방식 : null)`로 작업본을 만들고, Claude가 켜져 있으면 작업본의 각 장을 **1장부터 순서대로** `suggestStructureAction({ mode, id, chapters: 작업본, chapterNumber, instruction })`로 부른다(진행 `3/10장` 표시, `멈추기` 버튼은 다음 호출부터 중단, 한 장이 실패해도 계속하고 그 장은 오류 줄로 표시). 모달이 닫히거나 컴포넌트가 사라지면 남은 호출을 중단한다(`ref`의 취소 플래그). 결과 단계: 장마다 한 줄(`N장 · 지금 a문단 → 대사 나누기 b문단 → 적용 시 c문단`, `summarizeChapter`), `이 장 적용` 체크(문단 수가 바뀐 장만 기본 켜짐), 펼치면 Claude 제안(나누기/합치기 설명·이유·`splitBefore`, 수락/거절)과 건너뛴 문단 안내(`따옴표 짝이 맞지 않아 건너뛴 문단: …`), `모두 수락`. 맨 아래 `이 구성으로 전체 적용`(체크된 장의 `final` 문단을 `Map<chapterNumber, string[]>`로 `onApply` 후 닫기)과 `적용하지 않고 닫기`. 기존 패널의 스타일 클래스(`rounded-2xl border border-border bg-card`, 수락/거절 버튼 변형, 미리 보기 `ol`)를 그대로 따른다.
- [ ] **Step 2: `MasterEditor`에 연결한다.** 검토 모드 툴바에 `문단 정리` 버튼(`disabled={locked}`)과 `open` 상태, `onApply={(next) => { setSavedAt(false); setChapters((prev) => prev.map((c) => (next.has(c.chapterNumber) ? { ...c, paragraphs: next.get(c.chapterNumber)! } : c))); 첫 변경 장의 첫 문단 선택 }}`. 기존 `<StructureSuggestions>`·`<DialogueSplit>` 렌더와 두 import, `applyParagraphs` 함수를 제거하고 두 컴포넌트 파일을 삭제한다.
- [ ] **Step 3: 고정 배치.** 챕터 목록 `nav`와 `ClaudePanel`을 감싸는 요소에 `lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto`(`ClaudePanel`은 래퍼 `div`로 감싼다). 좁은 화면 스타일은 그대로.
- [ ] **Step 4: `CLAUDE.md` 갱신.** 대사 나누기 단락을 모달(전 장, 대사 나누기 → Claude 구성 제안 순서, 장 순차 호출, 네이티브 `dialog`)로 고치고, 제목 편집(`layer1.output.title`, 배포 순서: 함수 먼저), 대화의 제목 칩, 고정 배치를 한두 문장씩 더한다.
- [ ] **Step 5: 자동 검증**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 오류 없음, 테스트 전부 통과, 빌드 성공(삭제한 파일을 참조하는 곳 없음).

- [ ] **Step 6: 커밋**

```bash
git add components/admin/ParagraphCleanupModal.tsx components/admin/MasterEditor.tsx CLAUDE.md
git rm components/admin/StructureSuggestions.tsx components/admin/DialogueSplit.tsx
git commit -m "feat: whole-range paragraph cleanup modal and sticky editor side panels"
```

- [ ] **Step 7: 수동 확인 목록을 사용자에게 넘긴다**(컴포넌트 렌더 테스트 환경이 없음). Cloud Function 배포 후 `2026-09_Lv6`에서: 소설 제목 수정 → 칩 상태 → 새로고침 후 유지, 제목 비움 시 "건너뜀", 장 제목 수정; 대화 칩 `소설 제목`/`이 장 제목`으로 후보 제안 받기; `문단 정리` 모달: 옵션 → 실행 진행 표시 → 장별 결과·수락/거절 → 전체 적용 → 문단 목록·`수정됨`·자동 저장; 실행 중 닫기/멈추기; 긴 화면에서 스크롤해도 챕터 목록·대화창 고정.
