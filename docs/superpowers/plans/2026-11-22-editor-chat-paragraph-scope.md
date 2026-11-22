# 편집 대화 읽는 범위 스위치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문단을 보고 있을 때 Claude 대화가 설정 + 그 문단과 앞뒤 한 문단만 읽는 "이 문단 중심" 범위(기본값)와 지금처럼 원고 전체를 읽는 "전체 원고" 범위를 편집자가 고를 수 있게 하고, 캐시 적중량을 서버 로그에 남긴다.

**Architecture:** 클라이언트가 범위와 지금 보는 문단으로 `limitTo`를 계산해 요청에 싣고(`chatLimit`), 서버(`parseChatRequest` → `streamChat` → `buildStoryContext(input, limitTo)`)가 본문을 잘라 만든다. 전체 원고 모드와 `buildChatMessages`·이미 메시지에 박힌 줄은 건드리지 않아 캐시 동작이 그대로다. 사용량은 `streamConversation`의 `onUsage` 콜백으로 꺼내 `streamChat`이 로그로 남긴다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-editor-chat-paragraph-scope-design.md`

## Global Constraints

- 사용자에게 보이는 문구는 한국어, 편집자에게는 해요체. 버튼 문구: `읽는 범위`(그룹 라벨), `이 문단 중심`, `전체 원고`.
- 안내 문구(문단 중심): `지금 보는 곳: {n}장 {m}문단 · 이 문단과 앞뒤만 읽고 있어요`. 전체 원고 안내는 지금 문구 그대로.
- 본문 범위 안내 줄(서버가 `[소설 본문]` 바로 아래에 넣음): `(범위: {n}장 {m}문단과 앞뒤 한 문단만 보여 드립니다. 나머지 원고는 이 대화에 포함되지 않았습니다.)`
- 문단 중심 기본값. 문단 중심은 지금 보는 곳이 문단일 때만. 제목 대상·전체 읽기 화면은 항상 전체.
- `buildChatMessages`와 `withFocus`/`stripFocus`/알림 줄의 동작은 바꾸지 않는다(프롬프트 캐시 안정성).
- 로그에는 토큰 수만 남긴다(본문·제목·소설 id 금지).
- 이 프로젝트에는 컴포넌트·훅 렌더링 테스트가 없다. UI는 `tsc`·eslint·build와 수동 확인으로 검증한다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- 지금 보는 문단이 현재 원고에 없을 때(장/문단 번호 불일치) 요청이 실패하지 않고 전체 원고로 보내진다 — Task 2.
- 첫 문단·마지막 문단에서 앞뒤 한 문단이 범위를 벗어나지 않는다(없는 쪽은 생략) — Task 2.
- 제목 대상과 전체 읽기 화면은 범위가 문단 중심이어도 전체 원고로 보낸다 — Task 1.
- `limitTo`가 음수·소수·문자열·빈 객체이면 400으로 거절된다 — Task 3.
- 문단 중심에서 전체가 필요한 질문을 받으면 Claude가 단정하지 않고 "전체 원고"로 다시 물으라고 안내하도록 프롬프트가 지시한다 — Task 2.

---

### Task 1: 범위 → limitTo 변환 순수 로직

**Files:**
- Modify: `lib/chatProtocol.ts` (타입과 함수 추가)
- Test: `lib/chatProtocol.test.ts`

**Interfaces:**
- Consumes: 기존 `ChatFocus`.
- Produces: `export type ChatScope = "paragraph" | "full"`, `export type ChatLimit = { chapterNumber: number; paragraphIndex: number }`, `export function chatLimit(focus: ChatFocus, scope: ChatScope): ChatLimit | undefined`.

- [ ] **Step 1: Write the failing test** — `chatProtocol.test.ts`에 `describe("chatLimit")` 추가(import에 `chatLimit` 추가):
  - 문단 포커스 + `"paragraph"` → `{ chapterNumber: 3, paragraphIndex: 1 }`
  - 문단 포커스 + `"full"` → `undefined`
  - `null`·`{ novelTitle: true }`·`{ chapterNumber: 3, chapterTitle: true }` + `"paragraph"` → 각각 `undefined`
  - 돌려준 값이 포커스 객체와 같은 참조가 아니라 새 객체(`not.toBe(focus)`)이고 `chapterNumber`, `paragraphIndex` 두 키만 가진다(`toEqual`).
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run lib/chatProtocol.test.ts`
  Expected: FAIL — `chatLimit is not a function`(새 테스트만 실패).
- [ ] **Step 3: Implement** `chatLimit`과 두 타입을 `lib/chatProtocol.ts`의 `focusLine` 근처에 추가. 포커스가 `null`이거나 `"paragraphIndex" in focus`가 아니면 `undefined`. 한 줄 주석: 문단 중심 범위는 문단을 보고 있을 때만 적용(제목·전체 읽기는 이야기 전체가 필요).
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run lib/chatProtocol.test.ts`
  Expected: PASS(전체).
- [ ] **Step 5: Commit** (설계 문서와 이 계획도 함께)
  ```bash
  git add docs/superpowers lib/chatProtocol.ts lib/chatProtocol.test.ts
  git commit -m "feat: derive the chat read limit from focus and scope"
  ```

### Task 2: 문단 중심 본문과 시스템 프롬프트 한 줄

**Files:**
- Modify: `lib/claude/editing.ts` (`buildStoryContext`, `buildChatSystemPrompt`)
- Test: `lib/claude/editing.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ChatLimit`(타입만, `@/lib/chatProtocol`에서 import).
- Produces: `buildStoryContext(input, limitTo?: ChatLimit): string` — `limitTo` 없으면 기존과 바이트 단위로 같은 결과. 다른 호출부(`editor.ts`의 5곳)는 인자를 넘기지 않으므로 그대로 동작.

- [ ] **Step 1: Write the failing tests** — `editing.test.ts`의 `buildStoryContext` 영역에 `describe("buildStoryContext 문단 중심")`(기존 `chapters` 대신 한 장에 문단 4개짜리 `limitedChapters`를 쓰고 인물·문체·레벨 설정을 넣은 입력 사용):
  - 가운데 문단(`paragraphIndex: 1`) → 설정(제목·레벨·문체·인물 말투)을 포함하고, 그 문단과 앞뒤 문단의 `[1]`·`[2]`·`[3]`만 있고 `[4]` 문단 글은 없다. 번호는 원래 번호(`[2] …`).
  - 범위 안내 줄 `(범위: 1장 2문단과 앞뒤 한 문단만 보여 드립니다. 나머지 원고는 이 대화에 포함되지 않았습니다.)`가 `[소설 본문]` 줄 바로 다음 줄에 있다.
  - 그 장 제목 줄 `## 1장. …`은 있고, 다른 장(2장)의 제목과 글은 없다.
  - 첫 문단(`paragraphIndex: 0`) → `[1]`,`[2]`만. 마지막 문단 → 마지막 두 개만(범위 밖 인덱스 없음).
  - `limitTo`의 장 번호가 없거나 `paragraphIndex`가 문단 수 이상이면 `limitTo` 없이 만든 결과와 같다(`toBe`).
  - `limitTo`를 안 주면 기존 결과와 같다(기존 `context` 변수와 `toBe`).
  그리고 `describe("시스템 프롬프트")`(대화) 영역에 `it.each(["review","published"])`: `buildChatSystemPrompt(mode)`가 `"(범위:"`, `"전체 원고"`, `"추측"`을 포함.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run lib/claude/editing.test.ts`
  Expected: FAIL — 문단 중심 테스트들(범위 안내 줄 없음 등)과 프롬프트 테스트만 실패.
- [ ] **Step 3: Implement** — `buildStoryContext`에 두 번째 매개변수를 추가한다. `limitTo`가 있고 그 장이 있고 `paragraphIndex`가 `0 ≤ i < 문단 수`이면 본문 부분을 `[소설 본문]` → 범위 안내 줄 → `## n장. 제목` → `max(0,i-1)..min(len-1,i+1)` 문단(`[번호] 글`)으로 만든다. 그 외에는 기존 코드 경로 그대로(설정 부분은 두 경우 공유). `buildChatSystemPrompt`의 "원고는 대화하는 동안…" 줄 뒤에 한 줄 추가: `[소설 본문]` 아래에 `(범위: …)` 안내가 있으면 본문의 일부만 보여 드린 것이니, 범위 밖(앞뒤 흐름, 다른 장의 설정·복선·말투)은 추측으로 단정하지 말고, 전체를 봐야 답할 수 있는 질문이면 그렇게 말하고 대화창의 "전체 원고"를 눌러 다시 물어보라고 안내하며, 이전 대화에서 이미 본 내용은 참고해도 된다.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run lib/claude/editing.test.ts`
  Expected: PASS(전체).
- [ ] **Step 5: Commit**
  ```bash
  git add lib/claude/editing.ts lib/claude/editing.test.ts
  git commit -m "feat: chat context limited to the focused paragraph and its neighbors"
  ```

### Task 3: 요청 검증·서버 연결·사용량 로그

**Files:**
- Modify: `lib/claude/chat.ts`, `lib/claude/structured.ts`, `app/admin/(dashboard)/editor-chat/route.ts`
- Test: `lib/claude/chat.test.ts`, `lib/claude/structured.test.ts`, `app/admin/(dashboard)/editor-chat/route.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ChatLimit`, Task 2의 `buildStoryContext(input, limitTo)`.
- Produces:
  - `ChatRequest.limitTo?: ChatLimit`(`parseChatRequest`가 검증해 돌려줌).
  - `streamChat(input: … & { limitTo?: ChatLimit })` — `limitTo`로 본문을 만들고 `streamConversation`에 `onUsage`를 넘김.
  - `export type ChatUsage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }`(`structured.ts`), `streamConversation` 입력에 `onUsage?: (usage: ChatUsage) => void`, `ConversationClient`의 `finalMessage()`가 `{ stop_reason: string | null; usage?: ChatUsage }`를 돌려줌.

- [ ] **Step 1: Write the failing tests**
  - `chat.test.ts` `parseChatRequest`: 올바른 `limitTo: { chapterNumber: 1, paragraphIndex: 0 }`는 값에 그대로 담겨 돌아온다(`toEqual({ ok: true, value: { ...valid, limitTo } })`). `it.each`로 거절: `{ chapterNumber: 0, paragraphIndex: 0 }`, `{ chapterNumber: 1, paragraphIndex: -1 }`, `{ chapterNumber: 1.5, paragraphIndex: 0 }`, `{ chapterNumber: 1, paragraphIndex: "0" }`, `{}`, `null`, `"1장"`.
  - `chat.test.ts` `streamChat`: `limitTo: { chapterNumber: 1, paragraphIndex: 0 }`를 주면 `call.context`에 `(범위:`가 있고, 안 주면 없다. 호출 인자의 `onUsage`를 `{ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 }`로 부르면 `console.info`(스파이)가 `"[editor-chat] usage"`와 `{ scope: "paragraph", ...같은 값 }`로 불린다(`limitTo` 없으면 `scope: "full"`).
  - `structured.test.ts`: `fakeClient`의 `Script`에 선택 `usage`를 추가해 `finalMessage()`가 `{ stop_reason, usage }`를 돌려주게 한다. `onUsage`를 넘기면 그 값으로 한 번 불리고, `usage`가 없으면 안 불리며, 어느 쪽이든 이벤트는 기존과 같다.
  - `route.test.ts`: `limitTo`가 든 요청이면 `streamChat` 첫 인자가 `limitTo`를 포함한다. `limitTo`가 올바르지 않으면 400이고 Claude를 부르지 않는다.
- [ ] **Step 2: Run tests to verify they fail**
  Run: `npx vitest run lib/claude/chat.test.ts lib/claude/structured.test.ts "app/admin/(dashboard)/editor-chat/route.test.ts"`
  Expected: FAIL — 새로 추가한 테스트만 실패(기존 테스트는 통과).
- [ ] **Step 3: Implement**
  - `chat.ts`: `parseChatRequest`가 `limitTo`가 `undefined`가 아니면 객체이고 `chapterNumber`가 1 이상 정수, `paragraphIndex`가 0 이상 정수인지 확인(아니면 `INVALID`)하고, 통과하면 `{ chapterNumber, paragraphIndex }`만 새 객체로 담는다. `streamChat`은 `buildStoryContext(input, input.limitTo)`를 쓰고 `onUsage`로 `console.info("[editor-chat] usage", { scope: input.limitTo ? "paragraph" : "full", ...usage })`.
  - `structured.ts`: `ChatUsage` 타입, `ConversationClient`·`streamConversation` 입력 확장. `finalMessage()` 결과의 `usage`가 있으면 `input.onUsage?.(usage)`를 `stop_reason` 처리 전에 부른다.
  - `route.ts`: `parsed.value`에서 `limitTo`를 꺼내 `streamChat`에 `...(limitTo && { limitTo })`로 넘긴다.
- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run lib/claude/chat.test.ts lib/claude/structured.test.ts "app/admin/(dashboard)/editor-chat/route.test.ts"`
  Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add lib/claude/chat.ts lib/claude/chat.test.ts lib/claude/structured.ts lib/claude/structured.test.ts "app/admin/(dashboard)/editor-chat"
  git commit -m "feat: chat request carries the read limit and logs token usage"
  ```

### Task 4: 화면 — 읽는 범위 스위치와 안내 문구

**Files:**
- Modify: `components/admin/useEditorChat.ts`, `components/admin/EditorChat.tsx`, `components/admin/ClaudePanel.tsx`, `CLAUDE.md`
- Test: 없음(렌더링 테스트 인프라 없음). 검증은 `tsc`, eslint, 전체 테스트, build.

**Interfaces:**
- Consumes: Task 1의 `ChatScope`, `ChatLimit`, `chatLimit`. 서버는 Task 3의 `limitTo`를 받는다.
- Produces: `useEditorChat().send(text, { chapters, focus, title?, limitTo? })`가 `limitTo`가 있으면 요청 본문에 실음. `EditorChat`에 props `scope: ChatScope`, `onScopeChange: (scope: ChatScope) => void`, `showScope: boolean` 추가.

- [ ] **Step 1: Implement `useEditorChat`** — `send`의 `context`에 선택 `limitTo?: ChatLimit`을 받아, 있으면 `JSON.stringify` 본문에 `limitTo`를 넣는다(`title`을 넣는 방식과 같게). 그 외 동작은 바꾸지 않는다.
- [ ] **Step 2: Implement `EditorChat`** — `showScope`일 때 대상 버튼 그룹 아래에 `role="group" aria-label="읽는 범위"`로 `이 문단 중심`/`전체 원고` 버튼 두 개(대상 버튼과 같은 `size="sm"`, `variant`·`aria-pressed` 방식)를 둔다. `focusSummary`는 `scope`를 받아, 문단 포커스이고 `scope === "paragraph"`이면 `지금 보는 곳: {n}장 {m}문단 · 이 문단과 앞뒤만 읽고 있어요`, 그 외는 지금 문구 그대로. 컴포넌트 위 주석의 "원고 전체를 알고 있고"를 범위가 고를 수 있다는 내용으로 고친다.
- [ ] **Step 3: Implement `ClaudePanel`** — `const [chatScope, setChatScope] = useState<ChatScope>("paragraph")`(탭을 오가도 유지되도록 `chatTarget`과 같은 자리). `const limitTo = chatLimit(chatFocus, chatScope)`. `showScope`는 `chatFocus`가 문단 포커스(`chatFocus !== null && "paragraphIndex" in chatFocus`)일 때. `onSend`에서 `send`에 `...(limitTo && { limitTo })`를 넘기고, `EditorChat`에 `scope`·`onScopeChange`·`showScope`를 전달한다.
- [ ] **Step 4: Document** — `CLAUDE.md`의 "Claude와의 대화" 문단 끝에 이어서: 읽는 범위(문단 중심 기본/전체 원고), `limitTo`·`chatLimit`·`buildStoryContext(input, limitTo)`, 제목 대상과 전체 읽기 화면은 항상 전체, 사용량 로그 `[editor-chat] usage`로 캐시 적중량 확인, 설계 문서 경로(`docs/superpowers/specs/2026-11-22-editor-chat-paragraph-scope-design.md`).
- [ ] **Step 5: Verify**
  Run: `npx tsc --noEmit && npx eslint components/admin/useEditorChat.ts components/admin/EditorChat.tsx components/admin/ClaudePanel.tsx lib && npm run test`
  Expected: 타입 오류 없음, eslint 오류 없음, 전체 테스트 통과(기존 445개에 새 테스트가 더해진 수).
- [ ] **Step 6: Commit**
  ```bash
  git add components/admin/useEditorChat.ts components/admin/EditorChat.tsx components/admin/ClaudePanel.tsx CLAUDE.md
  git commit -m "feat: scope switch for the editor chat (paragraph focus by default)"
  ```
