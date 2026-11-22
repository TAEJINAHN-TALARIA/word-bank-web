# 편집 대화: 대화 지우기 + 원고 수정 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 화면 Claude 대화창에 `대화 지우기` 버튼을 넣고, 지난 전송 이후 원고가 바뀐 채 보내는 메시지에는 그 사실을 Claude에게 알려 "내가 틀렸다"고 오해하지 않게 한다.

**Architecture:** 순수 로직(알림 줄, 원고 열쇠 비교, 알림 줄 떼기)은 서버·클라이언트 공유 `lib/chatProtocol.ts`에 둔다. `useEditorChat`이 마지막 전송 시점의 열쇠를 들고 있다가 달라졌으면 user 메시지에 알림 줄을 박아 보낸다(옛 메시지는 안 건드려 프롬프트 캐시 유지). `clear()`는 진행 중 응답을 끊고 대화를 비운다. 시스템 프롬프트에 알림 줄의 뜻을 한 줄 추가한다.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Vitest (`npm run test`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-22-editor-chat-clear-and-edit-notice-design.md`

## Global Constraints

- 알림 줄 문구는 정확히 `[참고: 직전 질문 뒤에 원고가 수정됐어요]` (상수 `EDITED_NOTICE` 한 곳에서만 정의, 프롬프트도 이 상수를 쓴다).
- 메시지 모양: `[지금 보는 곳: …]\n[참고: 직전 질문 뒤에 원고가 수정됐어요]\n본문` (알림이 없으면 기존 `[지금 보는 곳: …]\n본문` 그대로).
- 옛 메시지 내용은 절대 다시 쓰지 않는다(재전송 시 같은 모양 → 프롬프트 캐시 유지).
- 원고 열쇠 = `chaptersKey(chapters)`(`lib/qualityCheck.ts`, 정규화한 문단 기준) + 편집 중인 소설 제목(양끝 공백 뗌).
- 지우기: 대화가 있을 때만 `window.confirm`, 입력 중인 글(`chatDraft`)과 대상 선택(`chatTarget`)은 유지, 저장하는 곳 없음.
- 이 프로젝트엔 컴포넌트·훅 렌더링 테스트 인프라가 없다 — 순수 로직만 Vitest로 테스트하고 훅·버튼은 수동 확인한다.
- 커밋은 로컬에만 한다. push 금지(push는 Vercel 배포를 일으키므로 사용자가 직접 결정).
- 위 파일 밖(문단 편집, 품질 점검, 서버 Route Handler 등)은 건드리지 않는다.

## Review Focus

- 첫 전송(이전 전송 없음)에는 알림이 붙지 않아야 한다 → Task 1 테스트.
- 저장 정규화만 다른 변화(끝에 빈 문단 추가)나 소설 제목 양끝 공백만 다른 경우는 "수정"이 아니다 → Task 1 테스트.
- 전체 읽기 화면(포커스 `null`)·제목 포커스에서도 알림이 붙고 말풍선에는 안 보인다 → Task 1 테스트.
- 응답이 오는 도중 지우고 바로 새 메시지를 보내도 그 메시지가 무시되지 않고, 끊긴 응답의 늦은 이벤트가 새 대화를 고치지 않는다 → Task 3 수동 확인.
- 지운 직후 첫 전송에는 알림이 붙지 않는다(비교할 옛 답변이 없음) → Task 3 수동 확인.

---

### Task 1: 알림 줄·원고 열쇠 순수 로직

**Files:**
- Modify: `lib/chatProtocol.ts` (`withFocus`/`stripFocus` 근처)
- Test: `lib/chatProtocol.test.ts`

**Interfaces:**
- Produces:
  - `export const EDITED_NOTICE = "[참고: 직전 질문 뒤에 원고가 수정됐어요]"`
  - `export function withFocus(text: string, focus: ChatFocus, options?: { manuscriptEdited?: boolean }): string`
  - `export function stripFocus(content: string): string` (알림 줄도 뗀다)
  - `export function manuscriptKey(chapters: MasterChapter[], title?: string): string`
  - `export function manuscriptEdited(previousKey: string | null, currentKey: string): boolean`

- [ ] **Step 1: Write the failing tests** in `lib/chatProtocol.test.ts` (기존 `focusLine / withFocus / stripFocus` 블록 뒤에 새 `describe`로):

  - `withFocus는 manuscriptEdited일 때 포커스 줄 다음에 알림 줄을 붙인다` — `withFocus("질문", {chapterNumber:3, paragraphIndex:1}, {manuscriptEdited:true})` → `"[지금 보는 곳: 3장 2문단]\n[참고: 직전 질문 뒤에 원고가 수정됐어요]\n질문"`; 옵션이 없거나 `false`면 기존 모양 그대로.
  - `stripFocus는 알림 줄까지 떼어 편집자가 쓴 글만 남긴다` — 문단 포커스, `null`(전체 읽기), `{novelTitle:true}`, `{chapterNumber:3, chapterTitle:true}` 각각을 `manuscriptEdited:true`로 만든 뒤 `stripFocus(...)`가 `"질문"`.
  - `manuscriptEdited` — `(null, key)`는 `false`, 같은 열쇠는 `false`, 다른 열쇠는 `true`.
  - `manuscriptKey` — 같은 입력은 같은 열쇠; 문단 글자가 바뀌면 다름; 장 제목이 바뀌면 다름; 소설 제목이 바뀌면 다름; 끝에 빈 문단(`""`)을 추가해도 같음; 소설 제목 양끝 공백(`" 제목 "` vs `"제목"`)만 달라도 같음; 제목 `undefined`와 `""`는 같음.

- [ ] **Step 2: Run to verify fail**

  Run: `npx vitest run lib/chatProtocol.test.ts`
  Expected: FAIL (`manuscriptKey`/`manuscriptEdited`/`EDITED_NOTICE` 없음).

- [ ] **Step 3: Implement** in `lib/chatProtocol.ts` the five exports above. `manuscriptKey`는 `chaptersKey`(`@/lib/qualityCheck`)와 `(title ?? "").trim()`을 이어 붙인 문자열(구분자는 줄바꿈). `stripFocus`는 기존 포커스 줄 정규식 뒤에 `EDITED_NOTICE` 줄이 있으면 함께 뗀다(정규식에 상수를 이스케이프해 넣는다). `lib/chatProtocol.ts`는 "server-only"를 import하지 않는다는 주석을 유지 — `lib/qualityCheck.ts`는 타입만 import하므로 클라이언트에서도 안전하다.

- [ ] **Step 4: Run to verify pass**

  Run: `npx vitest run lib/chatProtocol.test.ts`
  Expected: PASS (기존 테스트 포함 전부).

- [ ] **Step 5: Commit**

```bash
git add lib/chatProtocol.ts lib/chatProtocol.test.ts docs/superpowers/specs/2026-11-22-editor-chat-clear-and-edit-notice-design.md docs/superpowers/plans/2026-11-22-editor-chat-clear-and-edit-notice.md
git commit -m "feat: chat protocol helpers for the manuscript-edited notice"
```

---

### Task 2: 시스템 프롬프트에 알림 줄의 뜻 추가

**Files:**
- Modify: `lib/claude/editing.ts` (`buildChatSystemPrompt`의 "대화 원칙" 목록, `[지금 보는 곳]` 항목 바로 뒤)
- Test: `lib/claude/editing.test.ts` (`describe("buildChatSystemPrompt (대화)")` 안)

**Interfaces:**
- Consumes: `EDITED_NOTICE` from `@/lib/chatProtocol` (Task 1). `lib/claude/chat.ts`가 이미 이 파일을 import하므로 순환·server-only 문제 없음.
- Produces: `buildChatSystemPrompt(mode)`가 알림 줄 설명 항목을 포함한다(시그니처 불변).

- [ ] **Step 1: Write the failing test** — `it.each(["review","published"])("%s: 원고가 대화 중 바뀔 수 있고 알림 줄이 있으면 옛 답변이 틀린 게 아니라 편집자가 고친 것이라고 알린다")`: `prompt`가 `EDITED_NOTICE`, `"현재 원고"`, `"사과"`를 포함.

- [ ] **Step 2: Run to verify fail**

  Run: `npx vitest run lib/claude/editing.test.ts -t "buildChatSystemPrompt"`
  Expected: FAIL (새 테스트만).

- [ ] **Step 3: Implement** — 목록에 한 항목 추가(템플릿에서 `${EDITED_NOTICE}` 사용). 정확한 문구:

  `- 원고는 대화하는 동안 편집자가 고쳐서 바뀔 수 있고, 기준은 항상 현재 원고([소설 본문])입니다. 편집자 메시지에 ${EDITED_NOTICE}가 있으면, 이전 답변에서 인용한 구절이 지금 원고에 없는 것은 편집자가 고쳤기 때문이지 이전 답변이 틀려서가 아닙니다. 이전 답변이 틀렸다고 하거나 사과하지 말고, 현재 원고를 기준으로 이어서 답하세요.`

- [ ] **Step 4: Run to verify pass**

  Run: `npx vitest run lib/claude/editing.test.ts lib/claude/chat.test.ts`
  Expected: PASS (chat.test의 `toBe(buildChatSystemPrompt("review"))`도 통과).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/editing.ts lib/claude/editing.test.ts
git commit -m "feat: tell the chat prompt what the manuscript-edited notice means"
```

---

### Task 3: `useEditorChat` — 알림 붙이기 + `clear()`

**Files:**
- Modify: `components/admin/useEditorChat.ts`

**Interfaces:**
- Consumes: `manuscriptKey`, `manuscriptEdited`, `withFocus(text, focus, { manuscriptEdited })` (Task 1).
- Produces: 훅 반환값이 `{ turns, sending, send, stop, clear }`. `clear: () => void`.

- [ ] **Step 1: Implement 알림** — `lastKeyRef = useRef<string | null>(null)`를 두고, `send`에서 기존 가드(`!trimmed || abortRef.current`) 다음에 `const key = manuscriptKey(context.chapters, context.title)`, `const edited = manuscriptEdited(lastKeyRef.current, key)`, `lastKeyRef.current = key`를 한 뒤 `withFocus(trimmed, context.focus, { manuscriptEdited: edited })`로 user 턴을 만든다.

- [ ] **Step 2: Implement `clear`** — `abortRef.current?.abort()` → `abortRef.current = null` → `lastKeyRef.current = null` → `commit([])` → `setSending(false)`.

- [ ] **Step 3: 늦은 응답 차단** — `send`는 자기 `controller`를 기억해, 스트림 이벤트 콜백·`!response.ok` 분기·끊김 오류 분기·`catch` 안의 `patchLast`는 `abortRef.current === controller`일 때만 실행하고, `finally`의 `abortRef.current = null; setSending(false)`도 같은 조건일 때만 실행한다. (그렇지 않으면 `clear` 뒤 늦게 온 이벤트가 빈 목록의 마지막 턴을 고치려다 오류가 나거나, 지운 직후 새로 보낸 요청의 `abortRef`/`sending`을 덮어 쓴다.) `stop`의 동작은 그대로(받은 글 유지, 오류 표시 안 함).

- [ ] **Step 4: Verify types and lint**

  Run: `npx tsc --noEmit` then `npx eslint components/admin/useEditorChat.ts`
  Expected: 오류 없음.

- [ ] **Step 5: Commit**

```bash
git add components/admin/useEditorChat.ts
git commit -m "feat: chat hook adds the edited notice and a clear action"
```

(수동 확인은 Task 4에서 화면과 함께 한다.)

---

### Task 4: `대화 지우기` 버튼 + 연결 + 문서 + 최종 확인

**Files:**
- Modify: `components/admin/EditorChat.tsx`, `components/admin/ClaudePanel.tsx:212-224`, `CLAUDE.md`(편집 화면 Claude 대화 문단)

**Interfaces:**
- Consumes: `clear` from `useEditorChat` (Task 3).
- Produces: `EditorChat` props에 `onClear: () => void` 추가.

- [ ] **Step 1: Implement 버튼** — `EditorChat`에서 `focusSummary` 문장이 있는 줄을 `flex items-start justify-between gap-2` 한 줄로 만들어 오른쪽에 `size="sm" variant="ghost"` 버튼 `대화 지우기`를 둔다. `turns.length === 0`이면 `disabled`. 클릭 시 `window.confirm("대화를 모두 지울까요? 되돌릴 수 없어요.")`가 `true`일 때만 `onClear()`(대화가 없으면 버튼이 비활성이라 확인 창은 대화가 있을 때만 뜬다). 입력창·대상 선택은 건드리지 않는다.

- [ ] **Step 2: Wire** — `ClaudePanel`의 `<EditorChat … />`에 `onClear={chat.clear}` 전달.

- [ ] **Step 3: 문서** — `CLAUDE.md`의 "Claude와의 대화" 문단 끝에 두 문장 추가: `대화 지우기`(Claude 기억도 함께 초기화, 입력 중인 글·대상 선택은 유지)와, 원고가 지난 전송 뒤 바뀌었으면 메시지에 `EDITED_NOTICE` 줄이 박혀 가며 시스템 프롬프트가 그 뜻을 설명한다는 것(옛 메시지는 바꾸지 않아 캐시 유지).

- [ ] **Step 4: 자동 검증**

  Run: `npm run test` → Expected: 전체 PASS.
  Run: `npx tsc --noEmit` → Expected: 오류 없음.
  Run: `npx eslint components/admin/EditorChat.tsx components/admin/ClaudePanel.tsx components/admin/useEditorChat.ts lib/chatProtocol.ts lib/claude/editing.ts` → Expected: 이 변경으로 인한 새 오류 없음.
  Run: `npm run build` → Expected: 성공.

- [ ] **Step 5: 수동 확인** (로컬에 `.env.local`의 Firebase·`ANTHROPIC_API_KEY`·관리자 로그인이 필요 — 없으면 못 했다고 그대로 보고):
  - 대화가 없을 땐 버튼이 비활성, 있을 땐 확인 창 후 비워진다. 쓰던 글·대상 칩은 남는다.
  - 답이 오는 중에 지우면 즉시 멈추고, 곧바로 보낸 새 메시지가 정상 전송·응답된다.
  - 문단을 고친 뒤 질문하면 말풍선엔 알림이 안 보이고, Claude가 사과·"제가 틀렸다" 없이 현재 원고 기준으로 답한다. 고치지 않고 연달아 질문하면 알림이 안 붙는다(Network 탭 요청 본문 `messages`로 확인). 지운 직후 첫 질문에도 안 붙는다.

- [ ] **Step 6: Commit**

```bash
git add components/admin/EditorChat.tsx components/admin/ClaudePanel.tsx CLAUDE.md
git commit -m "feat: clear button for the editor chat"
```
