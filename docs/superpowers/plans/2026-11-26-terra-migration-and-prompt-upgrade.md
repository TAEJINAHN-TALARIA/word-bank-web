# terra 이관과 편집 프롬프트 고도화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 AI 호출 전체(구조화 7개 + 대화 스트림)를 환경변수 하나로 Claude/OpenAI(terra) 중에서 고르게 하고, 문단 정리 모달에 대사 구어체(⑤)·서술 문체(⑥) 점검과 레벨 기준표 기반의 마일드한 ③ 다듬기를 더한다.

**Architecture:** `lib/claude/structured.ts`의 `callStructured`/`streamConversation` 맨 앞에서 `REVIEW_PROVIDER`를 보고 새 파일 `lib/claude/openai.ts`(Responses API, `fetch` 직접 호출, 명시 캐시)로 보낸다. ⑤⑥은 ④와 같은 모양(`FactFinding`)의 점검형 단계로 만들어 같은 확인 화면에서 편집자가 고른 정정만 적용한다. ③은 프롬프트를 레벨 기준표로 바꾸고, 120자 넘는 문장은 코드가 찾아 대상 목록으로 건넨다.

**Tech Stack:** Next.js(App Router, 서버 액션), TypeScript, zod(`z.toJSONSchema`), vitest, OpenAI Responses API(SSE). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-25-terra-migration-and-prompt-upgrade-design.md` (+ 레벨 기준표 `docs/superpowers/specs/2026-11-25-level-rubric-draft.md`)

## Global Constraints

- 새 npm 의존성을 추가하지 않는다. OpenAI는 SDK 없이 `fetch`로 부른다.
- `REVIEW_PROVIDER`: `anthropic`(기본) | `openai`. 없거나 모르는 값이면 `anthropic`. Claude 경로의 기존 테스트는 그대로 통과해야 한다.
- OpenAI 모델 상수 `OPENAI_REVIEW_MODEL = "gpt-6.1-terra"`, 키는 `OPENAI_API_KEY`. `REVIEW_PROVIDER=openai`인데 키가 없으면 호출 시점에 한국어 오류 "OpenAI API 키가 없습니다".
- 요청 입력은 `[developer(context + prompt_cache_breakpoint), developer(system), user(task)]`, `prompt_cache_options: { mode: "explicit" }`. 브레이크포인트는 소설 본문 블록에만 건다. `reasoning.effort`는 호출자가 넘긴 값 그대로. `max_output_tokens`: 구조화 16000, 대화 8000. 서버 측 폴백·`reset` 이벤트 없음.
- 사용량 로그는 토큰 숫자만 남기고 본문·제목은 남기지 않는다.
- 글을 바꾸는 단계는 문단 수와 따옴표 짝(`“ ” "`)을 바꾸지 않는다. 숫자(아라비아 숫자 덩어리)는 `after`에 그대로 있어야 한다.
- 오류 메시지는 화면에 그대로 보이므로 한국어이고, 공급자 이름이 필요 없는 곳에서는 "Claude" 대신 "AI"를 쓴다(기존 Claude 경로의 문구는 그대로 둔다).
- 서버 액션은 실패를 예외가 아니라 `{ error }`로 돌려준다.
- 자동 테스트는 외부 호출을 하지 않는다(가짜 `fetch`/`vi.mock`).
- 검증 명령: `npx vitest run`, `npx tsc --noEmit`, `npx eslint <바꾼 파일>`.

## Rulings (설계와 다르게 정한 것 — 검토해 주세요)

1. **`getMasterReview`를 늘리지 않는다.** `EditorContextInput.level`이 이미 세션의 `targetLevel`("Lv1"~"Lv6") 문자열이다(`lib/data/masterReviews.ts:83`). 새 ③ 프롬프트는 이 값으로 기준표를 찾는다. (설계 §4의 "getMasterReview 확장"은 불필요.)
2. **레벨 기준표 상수에는 "어휘·문장구조" 칸만 옮긴다.** 내용 복잡성 칸은 이번 범위에서 쓰는 곳이 없어 상수에 넣지 않는다(YAGNI). 표의 값은 초안 문서의 칸을 그대로 쓴다.
3. **③의 길이 가드를 "120%"에서 "120% 이하 또는 +8자 이하"로 완화한다.** 파일럿에서 "트레이싱지 → 얇은 제도용 종이"처럼 짧은 구절을 풀어 쓴 3건이 120%에 걸려 버려졌다. 완화 폭은 8자로 둔다(제 판단).
4. **120자 넘는 문장은 코드가 찾아 프롬프트에 목록으로 건넨다.** 파일럿에서 모델은 글자 수를 세지 못해 규칙만으로는 움직이지 않았다(설계에 없던 단계).

## Review Focus

1. `REVIEW_PROVIDER=openai`인데 `OPENAI_API_KEY`가 없다 → 크래시가 아니라 화면에 보이는 한국어 오류. (Task 3)
2. OpenAI가 스키마에 안 맞는 JSON, 거절, 길이 초과, HTTP 오류를 돌려준다 → 모두 `ClaudeCallError`로 바뀌어 `{ error }`로 나온다. (Task 1)
3. 편집자가 대화 스트림을 중단한다 → 오류 이벤트 없이 조용히 끝난다. 응답 도중 `response.failed`는 오류 이벤트. (Task 2)
4. ⑤⑥ 정정이 따옴표 글자나 숫자를 바꾸거나 같은 구절을 두 점검이 고친다 → 정정이 버려지거나 건너뛰어지고 본문은 깨지지 않으며 건너뛴 수를 알린다. (Task 6, 8)
5. 가드를 완화해도 ③은 따옴표가 든 구절·대사 안쪽·숫자 변경·문단 번호 없는 항목을 여전히 버린다. 한 점검 단계가 실패해도 나머지는 진행한다. (Task 5, 9)

## File Structure

- Create `lib/claude/openai.ts` — OpenAI Responses 호출(구조화, 스트림, SSE 파서, 사용량 변환). 한 파일, 한 책임.
- Create `lib/claude/openai.test.ts`
- Modify `lib/claude/structured.ts` — 공급자 선택, `label` 입력, 사용량 로그.
- Modify `lib/claude/editor.ts` — `label` 전달, `polishChapter`가 `level`·대상 문장을 쓰도록, `checkDialogue`/`checkStyle`.
- Modify `lib/claude/editing.ts` — `SPOKEN_DIALOGUE` 상수와 세 프롬프트 반영.
- Create `lib/claude/levelRubric.ts` — 레벨별 상수.
- Modify `lib/claude/preprocessing.ts` — 새 ③ 프롬프트(함수), `findLongSentences`, 가드 완화, ⑤⑥ 프롬프트·검증.
- Modify `lib/actions/masterReviewActions.ts` — `checkDialogueAction`, `checkStyleAction`.
- Modify `lib/paragraphCleanup.ts` — `fetchCheck`, `applyCheckFixes`.
- Modify `components/admin/ParagraphCleanupModal.tsx` — 설정·병렬 점검·확인 화면·문구.
- Modify `CLAUDE.md` — 환경변수 한 줄.
- 각 `*.test.ts`는 같은 폴더의 기존 파일을 늘린다.

---

### Task 1: OpenAI 구조화 호출 (`callStructuredOpenAI`)

**Files:**
- Create: `lib/claude/openai.ts`, `lib/claude/openai.test.ts`

**Interfaces:**
- Produces:
  - `export const OPENAI_REVIEW_MODEL = "gpt-6.1-terra"`
  - `export function callStructuredOpenAI<T extends z.ZodType>(input: { schema: T; effort: "low"|"medium"|"high"; system: string; context: string; task: string; label?: string }, fetchImpl?: typeof fetch): Promise<z.output<T>>`
  - `export function openAIUsageToChatUsage(usage: unknown): ChatUsage` — `input_tokens`는 캐시 읽기·쓰기를 뺀 값, `cache_read_input_tokens`/`cache_creation_input_tokens`는 OpenAI의 `cached_tokens`/`cache_write_tokens`(Task 2와 3이 쓴다)
  - `export function buildOpenAIInput(context: string, system: string, rest: unknown[])` — `[developer(context+breakpoint), developer(system), ...rest]`
- Consumes: `ClaudeCallError`는 `structured.ts`에 있다. 순환 import를 피하려고 `openai.ts`에서 쓸 `ClaudeCallError`를 `lib/claude/callError.ts`(새 파일, 클래스 한 개)로 옮기고 `structured.ts`는 거기서 import해 다시 export한다(기존 import 경로 유지).

- [ ] **Step 1: 테스트 작성** — 가짜 `fetchImpl`로 다음을 단언한다(테스트 이름은 그대로 쓴다).
  - `"요청 본문: 모델·명시 캐시·브레이크포인트 위치·사고 수준·strict 스키마"` — `body.model === OPENAI_REVIEW_MODEL`, `body.prompt_cache_options` `{ mode: "explicit" }`, `body.input[0]`이 `developer`이고 `content[0]`이 `{ type: "input_text", text: context, prompt_cache_breakpoint: { mode: "explicit" } }`, `input[1]`이 system `developer`, `input[2]`가 `user`(task), `body.reasoning.effort`, `body.max_output_tokens === 16000`, `body.text.format`이 `{ type: "json_schema", name: "result", strict: true }`이고 스키마에 `$schema` 키가 없다. 헤더 `Authorization: Bearer <OPENAI_API_KEY>`.
  - `"output_text를 스키마로 검증해 돌려준다"`
  - 오류 케이스 각각 `ClaudeCallError`이고 메시지 단언: `status: "incomplete"`+`max_output_tokens` → `/잘렸습니다/`, `refusal` 콘텐츠 → `/정책상 거절/`, 스키마 불일치 JSON → `/해석하지 못했습니다/`, HTTP 429 → `/요청이 많아/`, HTTP 401 → `/OPENAI_API_KEY/`, 그 밖의 HTTP → `/OpenAI API 오류 \(500\)/`, 키 없음 → `/OpenAI API 키가 없습니다/`(요청을 보내지 않는다).
  - `"사용량을 [editor-call] usage로 남기고 본문은 남기지 않는다"` — `console.info`를 spy, 호출 인자의 객체에 `{ label, provider: "openai", effort, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }`가 있고 `JSON.stringify` 결과에 context 문자열이 없다.
  - `openAIUsageToChatUsage({ input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 } })` → `{ input_tokens: 30, output_tokens: 7, cache_creation_input_tokens: 10, cache_read_input_tokens: 60 }`.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/claude/openai.test.ts` → Expected: FAIL(모듈 없음).
- [ ] **Step 3: `lib/claude/callError.ts` 만들고 `structured.ts`가 거기서 import·re-export하게 한다** (동작 변화 없음).
- [ ] **Step 4: `openai.ts` 구현.** `fetch("https://api.openai.com/v1/responses", …)`. 응답 파싱: `status === "incomplete"`(`incomplete_details.reason === "max_output_tokens"`이면 "응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요", 그 밖의 이유는 "AI 응답이 완료되지 못했습니다"), `output[].type === "message"`의 `content`에 `refusal`이 있으면 "AI가 이 요청을 처리하지 못했습니다 (정책상 거절)", 없으면 `schema.parse(JSON.parse(text))`(실패 시 "AI 응답을 해석하지 못했습니다"). 사용량은 응답 뒤 `console.info("[editor-call] usage", { label, provider: "openai", effort, ...openAIUsageToChatUsage(usage) })`.
- [ ] **Step 5: 통과 확인** — `npx vitest run lib/claude/openai.test.ts lib/claude/structured.test.ts` → PASS.
- [ ] **Step 6: Commit** — `git add lib/claude/openai.ts lib/claude/openai.test.ts lib/claude/callError.ts lib/claude/structured.ts && git commit -m "feat: OpenAI structured call with explicit cache"`

---

### Task 2: OpenAI 대화 스트림 (`streamConversationOpenAI`)

**Files:**
- Modify: `lib/claude/openai.ts`, `lib/claude/openai.test.ts`

**Interfaces:**
- Consumes: Task 1의 `buildOpenAIInput`, `openAIUsageToChatUsage`; `ChatEvent`, `ChatMessage`(`@/lib/chatProtocol`), `ChatUsage`(`structured.ts`의 타입 — 이 파일도 순환을 피하려고 타입만 `import type`).
- Produces: `export async function* streamConversationOpenAI(input: { system: string; context: string; messages: ChatMessage[]; effort: "low"|"medium"|"high"; signal?: AbortSignal; onUsage?: (u: ChatUsage) => void }, fetchImpl?: typeof fetch): AsyncGenerator<ChatEvent>`

- [ ] **Step 1: 테스트 작성** — SSE 본문을 `ReadableStream`으로 흉내 낸 가짜 `fetchImpl`(조각 경계를 일부러 이벤트 중간에서 자른 케이스 포함).
  - `"요청: stream true, 대화 기록 매핑, 이전 답변은 output_text"` — `input`이 `[developer(context+breakpoint), developer(system), …대화]`, user 메시지는 문자열 content 그대로(첫 메시지에 본문을 넣지 않는다), assistant 메시지는 `{ role: "assistant", content: [{ type: "output_text", text }] }`, `max_output_tokens === 8000`, `signal`이 fetch에 전달된다.
  - `"response.output_text.delta는 delta로, response.completed는 done과 onUsage 한 번"`
  - `"SSE 조각이 이벤트 중간에서 끊겨도 이어 붙여 읽는다"`
  - `"response.incomplete(max_output_tokens)는 길어서 잘렸다는 오류 이벤트"`, `"response.failed와 error 이벤트와 HTTP 오류는 오류 이벤트 하나로 끝난다"`, `"refusal은 정책상 거절 오류 이벤트"`
  - `"중단(signal abort)이면 오류 이벤트 없이 조용히 끝난다"`
  - `"키 없음 → 오류 이벤트 'OpenAI API 키가 없습니다'"`(예외로 던지지 않는다).
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/claude/openai.test.ts` → FAIL(함수 없음).
- [ ] **Step 3: 구현.** `res.body.getReader()` + `TextDecoder`로 `\n\n` 단위 이벤트를 쪼개고 `data:` 줄을 JSON 파싱. 예외는 던지지 않고 마지막에 오류 이벤트(기존 `streamConversation`과 같은 규칙: `signal?.aborted`이면 `return`). 이벤트 이름은 Global Constraints/설계 그대로: `response.output_text.delta`, `response.completed`(`response.usage`), `response.incomplete`, `response.failed`, `error`.
- [ ] **Step 4: 통과 확인** — `npx vitest run lib/claude/openai.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/claude/openai.ts lib/claude/openai.test.ts && git commit -m "feat: OpenAI chat stream (SSE)"`

---

### Task 3: 공급자 선택과 사용량 로그

**Files:**
- Modify: `lib/claude/structured.ts`, `lib/claude/editor.ts`, `lib/claude/chat.ts`, `CLAUDE.md`
- Test: `lib/claude/structured.test.ts`, `lib/claude/editor.test.ts`

**Interfaces:**
- Consumes: `callStructuredOpenAI`, `streamConversationOpenAI`(Task 1·2), `ChatUsage`.
- Produces:
  - `callStructured` 입력에 `label?: string` 추가(기존 호출은 그대로 컴파일).
  - `export function reviewProvider(): "anthropic" | "openai"` — `process.env.REVIEW_PROVIDER === "openai"`이면 `"openai"`, 그 밖에는 `"anthropic"`.
  - Claude 경로도 응답 뒤 `console.info("[editor-call] usage", { label, provider: "anthropic", effort, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens })`.
  - `chat.ts`의 기존 `[editor-chat] usage` 로그에 `provider: reviewProvider()` 필드 추가.

- [ ] **Step 1: 테스트 작성** — `reviewProvider()`: 값 없음/`"anthropic"`/`"OPENAI "`(공백·대문자 섞임은 모르는 값) → `"anthropic"`, `"openai"` → `"openai"`. `callStructured`와 `streamConversation`이 `openai`일 때 각각 Task 1·2의 함수로 보내고(`vi.mock("./openai")`), 기본일 때는 보내지 않는다. `streamConversation`의 기존 가짜 클라이언트 테스트는 수정 없이 통과.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/claude/structured.test.ts` → FAIL.
- [ ] **Step 3: `structured.ts` 맨 앞 분기와 Claude 사용량 로그 구현.** `callStructured`의 `beta.messages.parse` 응답 `usage`를 읽어 로그를 남긴다(`response.usage`가 없으면 로그 생략). `editor.ts`의 7개 `callStructured` 호출에 `label`을 단다(`suggestIdeas`, `polishParagraph`, `suggestStructure`, `reviewStory`, `generatePreReview`, `polishChapter`, `checkFacts`와 같은 이름). `editor.test.ts`에 `"label을 넘긴다"` 단언을 `suggestIdeas`와 `polishChapter` 두 군데에 추가.
- [ ] **Step 4: `CLAUDE.md`의 Claude 기능 환경변수 줄(34행)에 한 문장 추가** — "`REVIEW_PROVIDER=openai`이면 편집 AI 호출이 OpenAI(`OPENAI_API_KEY`)로 간다. 기본은 Claude. 되돌릴 때는 환경변수를 지우고 재배포."
- [ ] **Step 5: 전체 확인** — `npx vitest run lib/claude && npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** — `git add lib/claude CLAUDE.md && git commit -m "feat: REVIEW_PROVIDER switch and per-call usage log"`

> 이 Task가 끝나면 **이관이 완성된 상태**다(기본 Claude). 편집자가 Vercel에 `OPENAI_API_KEY`와 `REVIEW_PROVIDER=openai`를 등록하는 시점은 편집자가 정한다. 이 시점에 멈추고 전후 비교를 할 수 있다.

---

### Task 4: 대사 구어체 원칙 (`SPOKEN_DIALOGUE`)

**Files:**
- Modify: `lib/claude/editing.ts`
- Test: `lib/claude/editing.test.ts`

**Interfaces:**
- Produces: `export const SPOKEN_DIALOGUE = "- 대사는 그 인물이 실제로 입으로 하는 구어체로 쓰세요. 격식체 인물이라도 공문·문어체 문장이 아니라 입말로, 소리 내어 읽어 어색하지 않게 하세요."`

- [ ] **Step 1: 테스트 작성** — `IDEAS_SYSTEM_PROMPT`, `POLISH_SYSTEM_PROMPT`, `buildChatSystemPrompt("review")`, `buildChatSystemPrompt("published")` 네 가지가 `SPOKEN_DIALOGUE`를 포함한다. `SYSTEM_PROMPT`, `STRUCTURE_SYSTEM_PROMPT`는 포함하지 않는다.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/claude/editing.test.ts` → FAIL.
- [ ] **Step 3: 상수를 `KEEP_STYLE` 아래에 두고, 세 프롬프트의 원칙 목록 끝(`${KEEP_STYLE}` 바로 앞)에 `${SPOKEN_DIALOGUE}`를 넣는다.**
- [ ] **Step 4: 통과 확인** — `npx vitest run lib/claude/editing.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/claude/editing.ts lib/claude/editing.test.ts && git commit -m "feat: spoken-dialogue principle in ideas, polish and chat prompts"`

---

### Task 5: ③ 레벨 맞춤 다듬기 (기준표 + 대상 문장 + 가드)

**Files:**
- Create: `lib/claude/levelRubric.ts`, `lib/claude/levelRubric.test.ts`
- Modify: `lib/claude/preprocessing.ts`, `lib/claude/editor.ts`
- Test: `lib/claude/preprocessing.test.ts`, `lib/claude/editor.test.ts`

**Interfaces:**
- Produces:
  - `levelRubric.ts`: `export type LevelRubric = { reader: string; vocabulary: string }`, `export function levelRubric(level: string): LevelRubric | null` — `"Lv1"`~`"Lv6"`만, 그 밖에는 `null`. `reader`는 기준표의 독자(미취학 아동 … 대학생·성인 숙련 독자), `vocabulary`는 초안 문서 표의 "어휘·문장구조" 칸 텍스트 그대로.
  - `preprocessing.ts`: `export function buildChapterPolishSystemPrompt(level: string): string`(기존 상수 `CHAPTER_POLISH_SYSTEM_PROMPT`를 대체, 상수는 삭제하고 `editor.test.ts` import를 고친다), `export function findLongSentences(paragraphs: string[]): { paragraphNumber: number; sentence: string }[]`, `buildChapterPolishTask`의 입력에 `targets?: { paragraphNumber: number; sentence: string }[]` 추가, `MAX_CHAPTER_POLISH_CHANGES = 10`.
- Consumes: 없음(Task 3와 독립).

- [ ] **Step 1: 테스트 작성**
  - `levelRubric`: 6개 레벨이 모두 `reader`와 비어 있지 않은 `vocabulary`를 갖고, `"Lv7"`, `""`, `"A1"`은 `null`.
  - `findLongSentences(paragraphs)`: 120자 **초과** 문장만(120자 정확히는 제외), 따옴표 글자가 든 문장 제외, `.?!` 뒤 공백으로 문장을 나누고 `paragraphNumber`는 1부터. 120자 이하만 있으면 `[]`.
  - `buildChapterPolishSystemPrompt("Lv6")`: 레벨 독자(`levelRubric("Lv6").reader`)와 어휘 칸 텍스트를 포함, 그리고 다음 규칙 문구를 모두 포함 — 문장을 쪼개지 말 것, 120자 이하 문장은 길다는 이유로 고치지 말 것, 비유·은유·감각어를 지우거나 뜻이 약해지게 바꾸지 말 것, 따옴표 구절 금지, 숫자 보존, 장당 최대 10건. `"Lv9"`나 `""`이면 기준표 블록 없이 같은 원칙 문구만 가진다.
  - `buildChapterPolishTask({ chapterNumber: 3, targets })`: `targets`가 있으면 `[반드시 손볼 문장]` 블록과 `- 2문단: <문장>` 줄들이 들어가고, 없거나 빈 배열이면 그 블록이 없다.
  - `validateChapterPolish` 가드 완화(Ruling 3): 길이 120% 이하 통과, 120% 초과라도 `after - before ≤ 8`이면 통과, 120% 초과이고 +8자 초과면 버림. 기존 가드 테스트(따옴표 글자, 대사 안쪽, 숫자, 없는 문단, 문단별 겹침, 장당 최대 건수는 10으로)는 그대로 통과.
  - `editor.test.ts` `polishChapter`: 호출의 `system`이 `buildChapterPolishSystemPrompt(base.level)`, `task`에 120자 넘는 문장이 있는 장일 때만 `[반드시 손볼 문장]`이 있다.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/claude` → FAIL.
- [ ] **Step 3: 구현.**
  - `levelRubric.ts`는 초안 문서의 표에서 칸을 그대로 옮긴 상수 맵.
  - 새 ③ 프롬프트 본문은 실험 하네스의 `LEVEL_SYSTEM`(`.superpowers/model-compare/compare.test.ts:32-52`, git에 없는 파일이므로 읽어서 옮긴다)을 바탕으로 하되 **레벨 줄을 `levelRubric(level)`로 채우고**, "은유와 감각어는 장식이라는 이유로 지우지 말고 뜻이 약해지는 낱말로도 바꾸지 마세요" 규칙을 더한다. 파일럿에서 8장 14문단의 은유가 깎인 일이 근거다. 낱말 풀이로 늘어나는 경우는 8자 이내라고 쓴다.
  - 대상 문장 블록 문구는 하네스 `MC_TARGETS` 블록(같은 파일 66-70행)을 그대로 쓴다.
  - 가드: `c.after.length > c.before.length * 1.2 && c.after.length - c.before.length > 8`이면 건너뛴다.
  - `editor.polishChapter`: `findLongSentences(chapter.paragraphs)`를 task에, `input.level`을 system에 쓴다.
- [ ] **Step 4: 통과 확인** — `npx vitest run lib/claude && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git add lib/claude && git commit -m "feat: level-rubric based mild polish with code-selected long sentences"`

---

### Task 6: ⑤ 대사 구어체 · ⑥ 서술 문체 점검 (프롬프트·검증·editor)

**Files:**
- Modify: `lib/claude/preprocessing.ts`, `lib/claude/editor.ts`
- Test: `lib/claude/preprocessing.test.ts`, `lib/claude/editor.test.ts`

**Interfaces:**
- Consumes: 기존 `FactFinding`, `RawFactFinding`, `validateFactFindings`, `MAX_FACT_FINDINGS`, `factsSchema`(모양이 같으므로 스키마를 재사용한다), `SPOKEN_DIALOGUE`(Task 4), `keepsNumbers`(같은 파일의 비공개 함수).
- Produces:
  - `export const DIALOGUE_CHECK_SYSTEM_PROMPT`, `export const STYLE_CHECK_SYSTEM_PROMPT`, `export function buildDialogueCheckTask(): string`, `export function buildStyleCheckTask(): string`
  - `export function validateCheckFindings(raw: RawFactFinding[], chapters: MasterChapter[]): FactFinding[]` — `validateFactFindings`를 거친 뒤, `fix.before`의 아라비아 숫자 덩어리가 `fix.after`에 없으면 그 `fix`만 `null`로 둔다(항목은 남긴다).
  - `editor.ts`: `export async function checkDialogue(input: EditorContextInput): Promise<FactFinding[]>`, `export async function checkStyle(input: EditorContextInput): Promise<FactFinding[]>` — 둘 다 `effort: "high"`(④와 같아야 캐시 공유), `schema: factsSchema`, `label`은 `checkDialogue`/`checkStyle`.

- [ ] **Step 1: 테스트 작성**
  - `validateCheckFindings`: (a) 숫자가 사라진 `fix`는 `null`이 되고 항목은 남는다, (b) 따옴표 글자(`“`, `”`, `"`)가 달라진 `fix`는 `null`(`validateFactFindings` 동작 확인), (c) `before`가 문단에 두 번 있으면 `null`, (d) 위치 없는 occurrence는 위치에서만 빠진다, (e) 9건을 주면 8건에서 자른다, (f) 빈 `fix.before`는 "정정 제안 없음"(`fix: null`)이고 occurrence가 있으면 항목은 남는다.
  - 프롬프트: ⑤ 프롬프트가 "따옴표 안의 대사", 인물 말투(설정집)를 입말로만 바꾸고 유지, 따옴표 글자·숫자·내용 불변, "확실한 것만 최대 8건", `fix.before`/`after`는 따옴표 글자 없이 대사 안쪽 구절, `SPOKEN_DIALOGUE`를 포함한다. ⑥ 프롬프트가 `[설정]`의 서술 문체 기준, 종결어미 급변·시점 이탈·장 사이 어조 변화·한 장만 수식 밀도가 유난히 높거나 낮음, 최대 8건, 정정은 고칠 구절이 분명할 때만(아니면 `fix.before` 빈 문자열)을 포함한다.
  - `editor.test.ts`: `checkDialogue`/`checkStyle`가 각자의 시스템 프롬프트·`effort: "high"`·전체 원고 context로 `callStructured`를 부르고 검증 결과를 돌려준다.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/claude` → FAIL.
- [ ] **Step 3: 구현.** 프롬프트는 `FACTS_SYSTEM_PROMPT`와 같은 구성(`INTRO` + 점검 원칙 + `DATA_NOTICE` + `JSON_ONLY`)으로 쓰고, 항목 모양 설명 문장(topic, description, occurrences, fix)을 같게 둔다.
- [ ] **Step 4: 통과 확인** — `npx vitest run lib/claude && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git add lib/claude && git commit -m "feat: dialogue-colloquial and narration-style check steps"`

---

### Task 7: 서버 액션 `checkDialogueAction` · `checkStyleAction`

**Files:**
- Modify: `lib/actions/masterReviewActions.ts`
- Test: `lib/actions/masterReviewActions.test.ts`

**Interfaces:**
- Consumes: Task 6의 `checkDialogue`, `checkStyle`.
- Produces: `export async function checkDialogueAction(input: ClaudeTarget): Promise<{ error?: string; findings?: FactFinding[] }>`, `checkStyleAction`도 같은 시그니처.

- [ ] **Step 1: 테스트 작성** — 기존 `checkFactsAction` 테스트와 똑같은 케이스를 두 액션에 대해: 로그인 없음 → `{ error: "관리자 로그인이 필요합니다" }`, `mode: "published"` → 거절 오류(`PREPROCESS_PUBLISHED_ERROR`), `loadEditorContext`의 `{ error }`를 그대로 반환, 성공 시 `{ findings }`, 호출 예외는 `{ error }`로.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/actions/masterReviewActions.test.ts` → FAIL.
- [ ] **Step 3: `checkFactsAction`을 그대로 본뜬 두 함수를 추가한다**(오류 기본 문구 "대사 구어체 점검 실패", "서술 문체 점검 실패"). 주석의 "마스터 전처리(③ 문장 다듬기, ④ 사실관계 점검)"를 ⑤⑥까지 포함하게 고친다.
- [ ] **Step 4: 통과 확인** — `npx vitest run lib/actions && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git add lib/actions && git commit -m "feat: server actions for dialogue and style checks"`

---

### Task 8: 점검 정정 적용 로직 (④ → ⑥ → ⑤, 겹침 건너뛰기)

**Files:**
- Modify: `lib/paragraphCleanup.ts`
- Test: `lib/paragraphCleanup.test.ts`

**Interfaces:**
- Consumes: `FactFinding`, `FactFix`, 기존 `settle`, `applyChanges`.
- Produces:
  - `export function fetchCheck(request: () => Promise<{ error?: string; findings?: FactFinding[] }>, failedMessage: string): Promise<FactCheck>` — `fetchFactCheck`는 이 함수를 "사실관계 점검을 받지 못했습니다"로 부르는 얇은 래퍼로 바꾼다(동작 불변).
  - `export function applyCheckFixes(chapters: MasterChapter[], fixes: FactFix[]): { chapters: MasterChapter[]; skipped: number }` — `fixes`를 **주어진 순서대로** 한 건씩 해당 문단에 적용한다. 그 시점의 문단에 `before`가 정확히 한 번 있지 않으면 건너뛰고 `skipped`를 센다. 입력은 바꾸지 않는다.

- [ ] **Step 1: 테스트 작성**
  - `applyCheckFixes`: 서로 다른 문단의 정정 둘이 모두 적용된다. 같은 문단의 겹치지 않는 정정 둘이 모두 적용된다. 앞 정정이 `before`를 바꿔 뒤 정정의 `before`가 사라지면 뒤 정정은 건너뛰고 `skipped === 1`, 본문은 앞 정정만 반영된 상태. `before`가 두 번 나오면 건너뜀. 순서를 바꾸면 어느 쪽이 적용되는지가 달라진다(순서 보장). 입력 배열 불변. 빈 `fixes`면 같은 내용 복사본, `skipped === 0`.
  - `fetchCheck`: 성공/`{ error }`/예외/`findings` 없음 → 각각 `{ findings }`, `{ error }`, `{ error: 예외 메시지 }`, `{ error: failedMessage }`.
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run lib/paragraphCleanup.test.ts` → FAIL.
- [ ] **Step 3: 구현.** `applyCheckFixes`는 `applyChanges`를 쓰지 않고(한 번만 있는지 확인이 필요) 문단에서 `indexOf` 두 번으로 확인한 뒤 치환한다.
- [ ] **Step 4: 통과 확인** — `npx vitest run lib/paragraphCleanup.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/paragraphCleanup.ts lib/paragraphCleanup.test.ts && git commit -m "feat: ordered check-fix application with overlap skip"`

---

### Task 9: 문단 정리 모달 — 병렬 점검과 확인 화면

**Files:**
- Modify: `components/admin/ParagraphCleanupModal.tsx`

**Interfaces:**
- Consumes: `checkFactsAction`, `checkDialogueAction`, `checkStyleAction`(Task 7), `fetchCheck`, `applyCheckFixes`(Task 8), 새 ③(Task 5, 호출 방식 불변).
- Produces: 화면 동작(아래). 컴포넌트 테스트 인프라가 없으므로 이 Task의 검증은 순수 로직 테스트(Task 8), `tsc`, `eslint`, 개발 서버 수동 확인이다.

화면 동작(설계 §3·§5):
- 설정: 기존 "사실관계 점검" 아래에 `대사 구어체 점검`, `서술 문체 점검` 체크박스(기본 켜짐)와 설명 한두 문장. "하나라도 켜져 있으면 실행" 규칙에 두 체크를 포함. 상단 안내 순서 문구는 "점검(사실관계·대사·문체) → 문장 다듬기 → 대사 나누기 → 문단 구성 제안". 문장 다듬기 설명은 "수식어와 군더더기를 덜어내요"를 "그 레벨 독자가 막힐 낱말과 얽힌 문장만 최소한으로 고쳐요(문장을 쪼개지 않아요)"로. 사용자에게 보이는 "Claude" 표기는 "AI"로 바꾼다(`STAGE_LABEL`, 설명, "Claude 문단 구성 제안" → "AI 문단 구성 제안", "Claude 제안 모두 수락" → "AI 제안 모두 수락").
- 실행: 켜진 점검 셋을 `Promise.all`로 병렬 호출한다(각각 `fetchCheck`). 한 단계가 실패해도 다른 단계와 이후 단계는 진행하고, 결과 화면에 단계별 오류 한 줄을 남긴다(기존 `factsError` 표시를 세 종류로 확장). 항목이 하나라도 있으면 확인 화면으로, 없으면 바로 ③으로.
- 확인 화면(phase `facts` → `checks`로 이름 변경): 종류별로 구역을 나눠 "사실관계 / 대사 구어체 / 서술 문체"를 라벨로 보여 주고, 항목 UI(topic, description, 위치+인용, 정정 `이 정정 적용`/`무시`, 기본 무시)는 기존 ④ 것을 재사용한다. 선택 상태 키는 `${kind}-${index}`.
- 계속: 고른 정정을 **④ → ⑥ → ⑤ 순으로** 모아 `applyCheckFixes`에 넘기고, 결과 `chapters`를 ③의 입력으로 쓴다. `skipped > 0`이면 결과 화면에 "겹쳐서 적용하지 못한 정정 n건" 알림.
- 결과 화면 장별 요약의 "사실관계 정정 n곳"은 "점검 정정 n곳"(세 종류 합)으로.

- [ ] **Step 1: 상태와 `Run` 타입 바꾸기** — `findings`/`fixes`/`factsError`를 `checks: Record<"facts"|"style"|"dialogue", FactCheck>`와 `fixes: FactFix[]`, `skippedFixes: number`로 바꾼다. `Phase`의 `"facts"`를 `"checks"`로.
- [ ] **Step 2: `execute`·`continueAfterFacts`(→ `continueAfterChecks`)·`proceed` 수정**, 설정·확인·결과 JSX 수정(위 동작).
- [ ] **Step 3: 확인** — `npx tsc --noEmit && npx eslint components/admin/ParagraphCleanupModal.tsx lib` → 오류 없음.
- [ ] **Step 4: 전체 테스트** — `npx vitest run` → 모두 통과(실패가 있으면 이름과 함께 보고).
- [ ] **Step 5: 수동 확인(개발 서버)** — 편집 화면에서 문단 정리를 열어 (a) 설정에 새 체크 두 개가 보이고 모두 끄면 실행이 막히는지, (b) 점검 항목이 있을 때 세 구역이 나오는지, (c) 계속 후 ③ 진행·결과 화면이 이전과 같은지 확인한다. 실제 API 호출은 편집자가 `.env.local` 키로 한 번 돌려 보고 결과를 본다(자동화하지 않음).
- [ ] **Step 6: Commit** — `git add components/admin/ParagraphCleanupModal.tsx && git commit -m "feat: parallel dialogue/style checks in the cleanup modal"`

---

## Self-Review

- **스펙 범위**: §1 OpenAI 경로·공급자 선택·사용량 로그 → Task 1–3. §2 `SPOKEN_DIALOGUE` → Task 4. §4 레벨 맞춤 ③ → Task 5. §3 ⑤⑥ → Task 6–9. §5 순서·병렬·건너뛰기 → Task 8–9. §6 비용은 구현 뒤 사용량 로그로 확인(별도 구현 없음). 검증 절 항목은 각 Task 테스트에 대응.
- **타입 일관성**: `FactFinding`/`FactFix`/`FactCheck`는 기존 타입을 그대로 재사용. `callStructured`의 `label` 추가는 선택 필드. `CHAPTER_POLISH_SYSTEM_PROMPT` 상수 삭제 → `buildChapterPolishSystemPrompt(level)`(Task 5에서 `editor.test.ts` import를 같이 고친다).
- **스펙과 다른 점**은 위 Rulings 4건뿐이고 Task 5에 근거가 있다.
- **스펙 밖으로 두는 것**: 내용 복잡성 점검 단계, story-generator 변경, 게시된 소설 모드, 문장 쪼개기, OpenAI 자동 폴백.
