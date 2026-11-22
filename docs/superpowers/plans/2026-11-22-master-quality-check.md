# 마스터 품질 점검 (편집 창) · 승인된 마스터 게이트 기록 전용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 창에서 마스터 게이트와 같은 점검(규칙 검사 + Gemini 심사)을 미리 돌려 보고, 승인된 마스터는 Layer 6 마스터 게이트에서 탈락해도 검토로 되돌리지 않고 결과만 기록한다.

**Architecture:** story-generator에서 `decideMasterGateFailure`가 승인된 마스터에 `'continue'`를 돌려주고 두 오케스트레이터가 그때 막지 않고 진행한다. 새 Cloud Function `adminEvaluateMaster`(순수 모듈 `masterEvaluation.js` + 주입 가능한 `generate`)가 편집본을 읽기 전용으로 점검한다. 웹은 클라이언트 함수·서버 액션·`ClaudePanel`의 `품질 점검` 탭으로 결과를 보여 준다.

**Tech Stack:** story-generator(Node ESM, `node:test`, Firebase Cloud Functions v2), word-bank-web(Next.js 16, React, TypeScript, Vitest node 환경 — 컴포넌트 렌더 테스트 없음).

**Spec:** `docs/superpowers/specs/2026-11-22-master-quality-check-design.md`

## Global Constraints

- 승인 전 마스터의 게이트 탈락은 기존대로 재생성(`regenerate`). 바꾸는 것은 **승인된** 마스터뿐이다.
- 승인 시점의 규칙 검사(`evaluateEditedMaster`)는 그대로 승인을 막는다.
- 점검 함수는 읽기 전용이다(Firestore에 쓰지 않음). 검토 대기 상태만 허용한다.
- 점검 판정은 기존 게이트와 같다: `languageLearningFit`·`characterVoiceConsistency`는 판정 제외, 나머지 중 2점 이하가 있으면 탈락. 규칙 검사 실패면 LLM 심사는 건너뛴다.
- Server Action은 throw하지 않고 `{ error }`를 돌려주며 `getAdminSession()`을 다시 확인한다(기존 규칙).
- Cloud Function 배포는 사용자 확인 후에만 한다. 배포 순서는 **함수 먼저, 웹(push) 나중**.
- 쉘이 백슬래시를 지울 수 있으니 정규식·`\n`이 든 수정은 Edit/Write 도구로 한다. 코드 주석은 한국어 "왜"만 짧게.

## Review Focus

- 승인된 마스터가 탈락해도 배치·온디맨드 두 경로 모두 검토로 되돌리지 않고 언어 단계로 이어진다 → Task 1 테스트(결정 함수) + 코드 읽기(두 호출 지점).
- 승인 전 마스터의 탈락은 여전히 재생성된다 → Task 1 테스트.
- 규칙 검사 실패면 심사를 호출하지 않는다 / 심사 API 오류·파싱 실패는 점검 오류로 돌려준다(점검이 던지지 않음) → Task 2 테스트.
- 점검 함수가 승인된 세션·검토 대기가 아닌 세션을 거절한다 → Task 2 코드 읽기(`loadAwaitingSession` 규칙 재사용) + 검증 테스트.
- 점검 결과가 점검 이후 바뀐 글에 대해 "낡음"으로 표시되고, `problemPhrases` 이동이 없는 구절에서 깨지지 않는다 → Task 4 테스트(문단 찾기).

---

### Task 1: story-generator — 승인된 마스터의 게이트를 기록 전용으로

**Files (저장소 `C:/Users/TAEJIN/Documents/story-generator`, 새 브랜치 `feat/master-gate-advisory`):**
- Modify: `src/pipeline/masterReview.js` (`decideMasterGateFailure`)
- Modify: `src/pipeline/orchestrator.js` (`finishLayer6Round`, import)
- Modify: `src/pipeline/syncOrchestrator.js` (`runTranslationAndGateLoop`, import)
- Modify: `src/pipeline/firestoreSessionStore.js` (`returnToMasterReview` 제거)
- Modify: `CLAUDE.md` (마스터 검토 게이트 단락)
- Test: `tests/masterReview.test.js`

**Interfaces:**
- Produces: `decideMasterGateFailure(session): 'continue' | 'regenerate'` — 승인된 마스터(`isMasterApproved`)면 `'continue'`, 아니면 `'regenerate'`.

- [ ] **Step 1: 실패하는 테스트로 고친다.** `describe('decideMasterGateFailure')`의 기대값을 바꾼다: 승인된 마스터(`approvedAt: { seconds: 1 }`) → `'continue'`; `approvedAt: null`과 `{}` → `'regenerate'`. 테스트 이름도 "승인된 마스터는 막지 않고 진행(기록 전용)"으로 맞춘다.
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/masterReview.test.js` / Expected: FAIL — 승인된 마스터 케이스가 `'return_to_review'`를 돌려줘 불일치.
- [ ] **Step 3: 구현.** 결정 함수와 주석을 위 Interfaces대로 바꾼다. `finishLayer6Round`(배치): 마스터가 `pass`가 아니고 결정이 `'regenerate'`면 기존 `handleDraftFailure` 후 `return`; `'continue'`면 `console.warn`(`[layer6] 승인된 마스터가 게이트에서 탈락했지만 기록만 하고 진행 — 사유: …`, 사유는 `formatGateFailureReasons(masterGate)`)를 남기고 `retryFailedLanguageGates`로 이어간다. `runTranslationAndGateLoop`(온디맨드): 같은 조건으로, `'regenerate'`면 기존 재생성 블록을 그대로 쓰고 `'continue'`면 경고만 남기고 아래 언어별 게이트 처리로 진행한다. 두 파일에서 `returnToMasterReview` import와 호출, `firestoreSessionStore.js`의 `returnToMasterReview` 함수를 제거한다(다른 참조가 없는지 `grep`으로 확인).
- [ ] **Step 4: `CLAUDE.md` 갱신** — "Master review gate" 단락의 "A Layer 6 master-gate failure on an approved master does NOT regenerate…returnToMasterReview…" 부분을 "승인된 마스터의 마스터 게이트 탈락은 재생성도 되돌리기도 하지 않고 `layer6Gates/master`에 기록만 한 채 언어 단계로 진행한다(`decideMasterGateFailure` → `'continue'`)"로 고치고, 과거에 되돌려진 세션의 `gateNote`는 그대로 남는다고 적는다.
- [ ] **Step 5: 검증** — Run: `npm test` / Expected: 전부 통과(기존 398 + 변경). `node -e "import('./functions/adminHandlers.js').then(()=>console.log('ok'))"`로 핸들러 모듈 로딩 확인.
- [ ] **Step 6: 커밋**

```bash
git switch -c feat/master-gate-advisory
git add src/pipeline/masterReview.js src/pipeline/orchestrator.js src/pipeline/syncOrchestrator.js src/pipeline/firestoreSessionStore.js tests/masterReview.test.js CLAUDE.md
git commit -m "feat: record-only master gate for human-approved masters"
```

---

### Task 2: story-generator — `adminEvaluateMaster` 점검 함수

**Files (같은 저장소·브랜치):**
- Create: `src/pipeline/masterEvaluation.js`
- Modify: `functions/adminHandlers.js` (`adminEvaluateMaster` 추가), `functions/index.js`(export가 필요하면 기존 방식대로)
- Test: `tests/masterEvaluation.test.js`

**Interfaces:**
- Produces:
  ```js
  // src/pipeline/masterEvaluation.js
  export const EVALUATION_SKIPPED_ITEM = 'languageLearningFit';
  export function summarizeScores(scores): { pass: boolean; failItems: string[]; items: { key: string; score: number; reason: string | null; problemPhrases?: string[]; gated: boolean }[] };
  export async function evaluateMasterForReview({ chapters, level, combo, characters, generate }):
    Promise<{ ruleBase: { pass: boolean; failures: string[]; warnings: string[] }; llm: null | { error: string } | { pass: boolean; failItems: string[]; items: ... } }>;
  ```
  `generate(request) => Promise<{ text?: string; error?: string }>`(`generateSync`와 같은 모양으로 주입). HTTP `adminEvaluateMaster`: `POST { sessionId, edits }` → 200 `{ success: true, ...결과 }`; 검증 실패 400, 세션 없음 404.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`tests/masterEvaluation.test.js`, `node:test`). 가짜 `generate`로 `evaluateMasterForReview`를 부르고 정상 마스터 챕터 10개(`본문 N\n\n둘째 문단 N`처럼 `chapterFormat`을 통과하는 형태 — 기존 `tests/masterReview.test.js`의 `chapters` 상수와 같은 모양)를 쓴다.
  - `'규칙 검사를 통과하고 모든 항목이 좋으면 llm.pass가 true이고 항목을 돌려준다'`: 가짜 응답은 `EVAL_ITEMS` 12개 키 전부에 `{ score: 4, reason: '좋음' }`인 JSON 문자열. `llm.items`에 `languageLearningFit`이 없고, `characterVoiceConsistency`는 `gated: false`, 나머지는 `gated: true`.
  - `'게이트 항목이 2점 이하면 pass가 false이고 failItems에 담는다'`: `levelFit`을 `{ score: 2, reason: '어려움', problemPhrases: ['어려운 구절'] }`로 → `failItems` `['levelFit']`, 그 항목에 `problemPhrases`가 실린다.
  - `'characterVoiceConsistency가 낮아도 판정에는 영향이 없다'`: 그 항목만 1점 → `pass === true`, `failItems` 빈 배열.
  - `'규칙 검사에 실패하면 심사를 호출하지 않는다'`: 챕터 수가 모자라는 입력(챕터 3개)으로 → `ruleBase.pass === false`, `ruleBase.failures`가 비어 있지 않고, `llm === null`, 가짜 `generate`가 호출되지 않음(호출 횟수 0).
  - `'심사 호출이 error를 돌려주면 llm.error를 담고 던지지 않는다'`, `'응답이 JSON이 아니면 llm.error를 담는다'`.
  - `summarizeScores`: 키가 일부 빠진 입력(예: `levelFit`만)도 던지지 않고 있는 항목만 돌려준다(점수가 없으면 0점 취급해 `gated`면 failItems에 포함).
- [ ] **Step 2: 실패 확인** — Run: `node --test tests/masterEvaluation.test.js` / Expected: FAIL — 모듈 없음.
- [ ] **Step 3: 구현.** `evaluateMasterForReview`: `assembleNovelText(chapters, 'ko')`로 본문을 만들고 `autoCheck(본문, 'ko', level)`의 `fail`/`warn` 이슈를 `ruleBase.failures`/`warnings` 메시지 배열로 바꾼다. 실패가 있으면 `llm: null`로 끝낸다. 아니면 `precheckTargets`를 거치지 말고 `buildLayer6Requests([{ target: 'master', lang: 'ko', storyText: 본문, ruleBaseWarnings: [] }], { level, combo, characters })[0].request`로 요청을 만들어 `generate`에 넘긴다. 결과 `error`면 `{ error }`, 아니면 `extractJSON(text)`(예외는 잡아 `{ error: '심사 응답을 해석하지 못했습니다' }`) 후 `summarizeScores`. `summarizeScores`는 `EVAL_ITEMS`에서 `languageLearningFit`을 뺀 순서로 항목을 만들고 `gated`는 `characterVoiceConsistency`만 false, `failItems`는 gated 항목 중 점수가 2 이하(없으면 0)인 키.
- [ ] **Step 4: 핸들러.** `adminEvaluateMaster`(`secrets: [ADMIN_API_SHARED_SECRET, GEMINI_API_KEY]`, `timeoutSeconds: 120`)를 기존 핸들러 패턴(`requirePost`, `loadAwaitingSession`)으로 추가: `{ sessionId, edits }`에서 `validateMasterReviewSave({ status: session.status, edits })`가 유효해야 하고, 저장된 `layer4`에 `mergeEditedChapters(layer4.output.chapters, edits)`를 적용한 챕터로, `getLayerOutput(sessionId, 'layer1')`의 `characters`와 세션의 `combo`·`targetLevel`로 `evaluateMasterForReview`를 부른다. `generate`는 핸들러 안에서 `const { generateSync } = await import('../src/geminiSyncClient.js')`로 가져와 `(request) => generateSync(request, { model: SYNC_MODEL })`(`SYNC_MODEL`은 `syncOrchestrator.js`가 쓰는 값을 같은 곳에서 가져온다). 아무것도 쓰지 않는다. `functions/index.js`에서 다른 admin 핸들러가 export되는 방식 그대로 export한다.
- [ ] **Step 5: 검증** — Run: `npm test` / Expected: 전부 통과. `node -e "import('./functions/adminHandlers.js').then(()=>console.log('ok'))"`.
- [ ] **Step 6: 커밋**

```bash
git add src/pipeline/masterEvaluation.js tests/masterEvaluation.test.js functions/adminHandlers.js functions/index.js
git commit -m "feat: add adminEvaluateMaster (read-only master quality check)"
```

(배포는 이 계획 밖에서 사용자 확인 후에 한다.)

---

### Task 3: 웹 — 점검 호출과 서버 액션

**Files (저장소 `word-bank-web`, 새 브랜치 `feat/editor-quality-check`):**
- Modify: `lib/admin-functions/storyGenerator.ts` (`evaluateMaster`, 타입)
- Modify: `lib/actions/masterReviewActions.ts` (`evaluateMasterAction`)
- Test: `lib/actions/masterReviewActions.test.ts`, `lib/admin-functions/storyGenerator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EvaluationItem = { key: string; score: number; reason: string | null; problemPhrases?: string[]; gated: boolean };
  export type MasterEvaluation = {
    ruleBase: { pass: boolean; failures: string[]; warnings: string[] };
    llm: null | { error: string } | { pass: boolean; failItems: string[]; items: EvaluationItem[] };
  };
  export async function evaluateMaster(sessionId: string, edits: MasterEdit[]): Promise<MasterEvaluation>; // storyGenerator.ts
  export async function evaluateMasterAction(input: { sessionId: string; chapters: MasterChapter[] }): Promise<{ error?: string; result?: MasterEvaluation }>; // masterReviewActions.ts
  ```
  `evaluateMasterAction`은 로그인 확인, `isValidChaptersInput(chapters)` 검증, `chapters`를 `MasterEdit[]`(`body = paragraphsToBody(paragraphs)`)로 바꿔 `evaluateMaster`를 부르고 실패는 `{ error }`.

- [ ] **Step 1: 브랜치와 실패하는 테스트.** `git switch -c feat/editor-quality-check`; 이 계획·설계 문서를 먼저 커밋(`git add docs/superpowers/specs/2026-11-22-master-quality-check-design.md docs/superpowers/plans/2026-11-22-master-quality-check.md && git commit -m "docs: add master quality check design and plan"`). 테스트: `storyGenerator.test.ts`에 `'evaluateMaster는 adminEvaluateMaster로 edits를 보내고 결과를 돌려준다'`(fetch 모킹: 요청 URL 끝이 `/adminEvaluateMaster`, 본문 `{ sessionId, edits }`, 응답 `{ success: true, ruleBase, llm }`에서 `ruleBase`와 `llm`만 돌려줌), `'함수가 오류를 돌려주면 그 메시지로 던진다'`. `masterReviewActions.test.ts`에 `'세션이 없으면 거절한다'`(로그인 확인 목록에 `evaluateMasterAction` 추가), `'챕터를 MasterEdit로 바꿔 함수에 넘기고 결과를 돌려준다'`(문단 두 개가 `\n\n`으로 이어진 body), `'함수가 실패하면 error를 돌려준다'`.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/actions/masterReviewActions.test.ts lib/admin-functions/storyGenerator.test.ts` / Expected: FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로. `postAdmin("adminEvaluateMaster", { sessionId, edits }, "점검 실패")`의 응답에서 `ruleBase`/`llm`을 꺼낸다(모양이 어긋나면 오류).
- [ ] **Step 4: 검증** — Run: `npx tsc --noEmit && npx vitest run` / Expected: 오류 없음, 전부 통과.
- [ ] **Step 5: 커밋**

```bash
git add lib/admin-functions/storyGenerator.ts lib/admin-functions/storyGenerator.test.ts lib/actions/masterReviewActions.ts lib/actions/masterReviewActions.test.ts
git commit -m "feat: add the master quality check call and server action"
```

---

### Task 4: 웹 — `품질 점검` 탭과 승인 안내

**Files:**
- Create: `lib/qualityCheck.ts` (순수 로직), `components/admin/QualityCheckPanel.tsx`
- Modify: `components/admin/ClaudePanel.tsx` (탭 추가), `components/admin/MasterEditor.tsx` (점검 결과 상태·승인 안내·`onJump` 연결), `CLAUDE.md`
- Test: `lib/qualityCheck.test.ts`

**Interfaces:**
- Consumes: `MasterEvaluation`, `EvaluationItem`, `evaluateMasterAction` (Task 3), `MasterChapter`.
- Produces:
  ```ts
  // lib/qualityCheck.ts
  export const ITEM_LABELS: Record<string, string>;                     // 항목 키 → 한국어 이름
  export function scoreTone(score: number): "good" | "borderline" | "low"; // 4~5 good, 3 borderline, 1~2 low
  export function findPhraseLocation(chapters: MasterChapter[], phrase: string): { chapterNumber: number; paragraphIndex: number } | null;
  export function chaptersKey(chapters: MasterChapter[]): string;        // 점검 이후 변경 감지용 안정적 직렬화
  export function approvalNote(evaluation: MasterEvaluation | null, stale: boolean): string; // 승인 줄 안내 문구
  ```

- [ ] **Step 1: 실패하는 테스트** (`lib/qualityCheck.test.ts`)
  - `scoreTone`: 5·4 → `"good"`, 3 → `"borderline"`, 2·1·0 → `"low"`.
  - `findPhraseLocation`: 문단에 든 구절을 찾아 `{ chapterNumber, paragraphIndex }`(0부터)를 돌려준다; 공백이 여러 칸/줄바꿈으로 달라도 공백 정규화로 찾는다; 없는 구절·빈 문자열은 `null`.
  - `chaptersKey`: 같은 내용이면 같은 문자열, 문단 하나라도 바뀌면 다른 문자열, 장 제목만 바뀌어도 다르다.
  - `approvalNote`: `null`이면 `"품질 점검을 아직 하지 않았어요"`; 통과(`ruleBase.pass`이고 `llm.pass`)면 `"최근 품질 점검: 통과"`; 낮은 항목 2개면 `"최근 품질 점검: 낮은 항목 2개"`; 규칙 검사 실패면 `"최근 품질 점검: 규칙 검사 실패 N건"`; `llm`이 `{ error }`면 `"최근 품질 점검: 심사 실패"`; `stale`이면 위 문구 뒤에 `" · 글이 바뀌었어요, 다시 점검을 권장해요"`를 붙인다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/qualityCheck.test.ts` / Expected: FAIL — 모듈 없음.
- [ ] **Step 3: 순수 로직 구현** — 위 Interfaces대로. `ITEM_LABELS`: `contentSafety` 내용 안전성, `culturalFit` 문화 적합성, `narrativeCompleteness` 서사 완결성, `characterConsistency` 인물 일관성, `chapterTransition` 장 전환, `levelFit` 레벨 적합성, `comboFit` 설정 반영, `technicalCleanliness` 기술적 흔적, `narrativeStyleConsistency` 문체·시점 일관성, `materialWeightFit` 소재 무게, `characterVoiceConsistency` 인물 말투(참고).
- [ ] **Step 4: 패널과 연결.**
  - `QualityCheckPanel`(클라이언트): props `{ evaluation: MasterEvaluation | null; stale: boolean; running: boolean; error: string | null; disabled: boolean; onRun: () => void; onJump: (chapterNumber: number, paragraphIndex: number) => void; chapters: MasterChapter[] }`. `점검 실행` 버튼(실행 중 "점검하는 중… 수십 초 걸려요"), 오류 줄, `stale`이면 안내, 규칙 검사 실패·경고 목록, 항목 목록(이름, 점수 배지 `scoreTone`으로 색, 사유, `problemPhrases` 각각을 `findPhraseLocation`으로 찾아 `이동` 버튼 — 못 찾으면 구절만 표시), `gated: false`는 "참고(판정 제외)". 기존 패널 스타일을 따른다.
  - `ClaudePanel`: 검토 모드에서만 세 번째 탭 `품질 점검`을 추가하고 `QualityCheckPanel`을 렌더(필요한 값은 props로 받는다).
  - `MasterEditor`: 상태 `evaluation`/`evaluatedKey`/`evaluating`/`evalError`; `runEvaluation()`이 `flushAutosave()` 후 `evaluateMasterAction({ sessionId: detail.id, chapters })`를 부르고 성공하면 결과와 그때의 `chaptersKey(chapters)`를 저장한다. `stale = evaluation !== null && evaluatedKey !== chaptersKey(chapters)`. 하단 승인 줄 문단에 `approvalNote(evaluation, stale)`를 덧붙인다(승인 버튼은 그대로, 막지 않음). `onJump={jump}` 재사용.
- [ ] **Step 5: `CLAUDE.md`** — 마스터 검토 단락에 한두 문장: `품질 점검` 탭이 `adminEvaluateMaster`(Gemini 심사, 읽기 전용)로 승인 전 점검을 돌리고 승인된 마스터의 게이트는 기록만 한다는 것, 배포 순서(함수 먼저).
- [ ] **Step 6: 자동 검증** — Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` / Expected: 오류 없음, 전부 통과, 빌드 성공.
- [ ] **Step 7: 커밋**

```bash
git add lib/qualityCheck.ts lib/qualityCheck.test.ts components/admin/QualityCheckPanel.tsx components/admin/ClaudePanel.tsx components/admin/MasterEditor.tsx CLAUDE.md
git commit -m "feat: quality check tab in master review"
```

- [ ] **Step 8: 수동 확인 목록을 사용자에게 넘긴다**(함수 배포 후): `2026-09_Lv6`에서 `품질 점검` 탭 → 실행(수십 초) → 규칙 검사/항목별 점수·사유 → `levelFit` 문제 구절 `이동` → 글을 고치면 "글이 바뀌었어요" → 승인 줄 안내 문구 → (승인은 막지 않음). 승인 후 게이트가 탈락해도 검토로 되돌아오지 않는지는 로그(`firebase functions:log`)와 `layer6Gates/master`로 확인.
