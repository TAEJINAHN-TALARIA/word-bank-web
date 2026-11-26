# terra 이관과 편집 프롬프트 고도화 (설계)

상태: 초안 — 편집자 승인 대기
관련: `2026-11-23-master-preprocess-design.md`(문단 정리 모달), `2026-11-25-level-rubric-draft.md`(레벨 기준표 초안), 모델 비교 기록(메모리 `project_model_comparison_2026_11`, 실험 하네스는 git에 없는 `.superpowers/model-compare/`)

## 왜

1. **비용**: 마스터 한 편(④ 1회 + ③ 10장)을 처리하는 데 Sonnet 5.5로 약 $0.27이 든다. 같은 원고로 gpt-6.1-terra를 OpenAI **명시 캐시**로 돌리면 약 $0.17이고 품질은 Sonnet과 비슷하다(블라인드 채점, ④ 심은 모순 9/9). 편집 대화도 같은 방식으로 터미널 실험에서 동작을 확인했다(캐시 쓰기 한 번 $0.022, 이후 질문당 약 $0.0014).
2. **품질 문제 세 가지**를 이번에 같이 다룬다. 모두 편집자가 직접 원고를 읽고 짚었다.
   - 대사가 실제 입말이 아니다(2장 한민우의 공문식 대사 등).
   - 서술 문체가 갑자기 바뀐다.
   - 레벨 기준이 문장 길이 하나뿐이라, 어휘·구조가 어려운 원고(이 원고는 문장 52%가 80자 초과)와 내용이 그 레벨에 맞는지를 보지 못한다. 그리고 지금 ③ 다듬기는 "수식어를 덜어낸다"를 기준으로 문체와 비유까지 깎는다(terra 명시 캐시 결과 172건, 평균 -18자, 글자의 14%).

## 목표 / 비목표 / 안티 목표

- 목표 1: `callStructured`의 7개 함수와 편집 대화 스트림을 환경변수 하나로 Claude와 OpenAI(terra) 중에서 고를 수 있게 한다. 기본값은 Claude, 되돌리는 데 코드 변경이 필요 없다.
- 목표 2: 대사 구어체 원칙을 방향 제시·문단 다듬기·대화 프롬프트에 넣고, 어색한 대사를 찾아 구어체 대안을 제안하는 점검(⑤)을 문단 정리 모달에 더한다.
- 목표 3: 서술 문체가 갑자기 바뀌는 곳을 찾는 점검(⑥)을 더한다.
- 목표 4: ③ 문장 다듬기를 레벨 기준표(어휘·문장구조 × 내용 복잡성)에 맞춰 **마일드하게** 다듬는 단계로 바꾼다. 문장 모양은 그대로 두고 그 레벨 독자가 막힐 곳만 최소한으로 고친다.
- 목표 5: 단계별 토큰 사용량을 서버 로그에 남겨 실제 비용을 확인할 수 있게 한다.
- 비목표: story-generator(Layer 4 생성, Layer 5 번역, Layer 6 게이트) 변경, 레벨 정의(`readability.js`)의 변경, 게시된 소설 모드(전처리는 마스터 검토에서만), Claude 경로 제거, 문장 쪼개기, OpenAI 모델의 자동 폴백.
- 안티 목표: 모델을 바꾼 일이 결과를 조용히 나쁘게 만드는 것(되돌릴 수 없거나 비교할 수 없는 상태). 새 점검이 줄거리·사실·숫자·문단 수·따옴표 짝을 바꾸는 것. 레벨 점검이 문체와 비유를 깎는 것.

## 제약과 현재 상태

- Claude 호출은 `lib/claude/structured.ts` 하나에 모여 있다. `callStructured`(zod 구조화 출력, 소설 본문을 앞에 두고 캐시, 서버 측 폴백)와 `streamConversation`(대화 스트림, 중단 신호, 폴백 시 `reset` 이벤트, 사용량 로그). 호출하는 쪽은 `editor.ts`의 7개 함수와 `chat.ts`.
- 모달(`ParagraphCleanupModal.tsx`)의 흐름은 `setup → ④ → facts(편집자 선택) → ③①② → result`. 순수 로직은 `lib/paragraphCleanup.ts`, 서버 액션은 `masterReviewActions.ts`.
- 글을 바꾸는 단계는 ①(따옴표 짝으로 대사를 나눔)과 ②(문장을 글자 그대로 인용해 나눌 곳을 정함)보다 먼저여야 한다. 번역(Layer 5)이 문단 번호(`[p1]…`)로 1:1 매핑하므로 **문단 수와 따옴표 짝은 바뀌지 않아야** 한다.
- OpenAI 명시 캐시는 GPT-5.6 이상만 지원하고, 브레이크포인트는 `developer`/`user` 메시지의 `input_text` 블록에만 걸린다(최상위 `instructions` 불가). 캐시는 사고 수준(`reasoning.effort`)이 다르면 공유되지 않는다. 최소 길이는 1,024 토큰.
- 터미널에서 확인한 것: 스트리밍과 명시 캐시 동시 사용 가능, 두 번째 턴에서 같은 본문이 캐시에서 읽힘(17,543 토큰), 이전 assistant 답변은 `{ role: "assistant", content: [{ type: "output_text", text }] }`로 전달, 길이 초과는 `response.incomplete`(`incomplete_details.reason = "max_output_tokens"`), 사용량은 `response.completed`의 `response.usage`.
- 확인하지 못한 것: 첫 글자까지의 시간(terra 4.5초 / 캐시 읽기 3.2초, Sonnet과 비교하지 않음). 한 레벨 안의 어휘·구조 기준표 값(대부분 추정). ③ 새 프롬프트가 terra에서 마일드하게 동작하는지.
- 앱의 Vercel 프로젝트는 Hobby + Fluid Compute(함수 최대 300초). `OPENAI_API_KEY`는 아직 Production에 없다(편집자가 등록).

## 접근

**모델 이관(목표 1)**
1. **`structured.ts`에서 공급자를 가르는 얇은 층 (선택).** `REVIEW_PROVIDER`(`anthropic` 기본 | `openai`)로 `callStructured`와 `streamConversation`이 새 파일 `lib/claude/openai.ts`의 함수를 부른다. 호출하는 쪽은 변경 없음. 롤백은 환경변수와 재배포.
2. `editor.ts` 함수별로 공급자를 고른다. 같은 분기가 7곳에 퍼져서 제외.
3. Anthropic SDK 호출을 전부 걷어내고 OpenAI로 교체. 되돌릴 수 없고 비교도 못 해서 제외.

연동 방식은 SDK 없이 `fetch`로 직접 부른다(제 판단). 터미널 실험에서 이미 동작을 확인한 형태이고 의존성이 늘지 않는다. 스트림 SSE 파서는 직접 쓰고 테스트한다.

**점검 단계(목표 2~4)**
1. **④ 형태를 재사용한 "점검형" 단계 (선택).** ⑤ 대사, ⑥ 서술 문체를 ④와 같은 모양(`topic`, `description`, `occurrences[]`, 선택적 정정 `fix`)으로 만들고, 같은 확인 화면에서 편집자가 고른 것만 적용한다.
2. 대사는 ③처럼 장마다 호출하고 자동 적용. 대사 고치기는 인물 말투 판단이 들어가 자동 적용이 맞지 않아 제외.
3. 레벨 맞춤을 ③과 별도의 새 단계로 둔다(⑤ 대사, ⑥ 서술 문체와 합쳐 새 단계 셋). 호출과 화면이 늘고 ③과 같은 서술 문장을 두 단계가 고쳐 충돌하므로 제외. 대신 **③의 프롬프트를 레벨 기준으로 바꾸고** ⑤⑥만 새 단계로 더한다(선택).

## 설계

### 1. OpenAI 경로 (`lib/claude/openai.ts`, 새 파일)

공통
- 요청은 Responses API(`POST /v1/responses`). 모델은 상수 `OPENAI_REVIEW_MODEL = "gpt-6.1-terra"`, 키는 `OPENAI_API_KEY`.
- 입력은 `input: [developer(context + prompt_cache_breakpoint), developer(system), …]`. `prompt_cache_options: { mode: "explicit" }`. 소설 본문(`context`)이 항상 앞 블록이고 브레이크포인트는 그 블록에만 건다.
- `reasoning.effort`는 호출자가 넘긴 `low|medium|high` 그대로. `max_output_tokens: 16000`(구조화), `8000`(대화).
- 사용량(`input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`/`cache_write_tokens`)을 읽어 로그 형식으로 변환한다.

구조화(`callStructuredOpenAI`)
- `text.format = { type: "json_schema", name: "result", schema: z.toJSONSchema(schema)($schema 제거), strict: true }`.
- `input`의 세 번째는 `user(task)`. 응답이 `status === "incomplete"`이면 "응답이 길어 중간에 잘렸습니다" 오류, `refusal` 콘텐츠가 있으면 정책 거절 오류, `output_text`를 `schema.parse(JSON.parse(text))`로 검증한다. 모든 실패는 기존 `ClaudeCallError`와 같은 한국어 메시지로 바꾼다(문구에서 "Claude" 대신 "AI").

대화(`streamConversationOpenAI`)
- `stream: true`. 입력은 위 두 `developer` 메시지 뒤에 `buildChatMessages`와 같은 의미로 대화 기록(첫 user 메시지에는 본문을 넣지 않는다 — 본문은 앞 `developer` 블록에 있다. 앱의 `[지금 보는 곳: …]` 줄은 각 user 메시지에 이미 박혀 있어 그대로 둔다). 이전 assistant 메시지는 `output_text` 형식.
- SSE를 읽어 `response.output_text.delta` → `{ t: "delta" }`, `response.completed` → `done`(사용량 로그), `response.incomplete`(`max_output_tokens`) → 기존 "응답이 길어 중간에 잘렸습니다" 오류, `response.failed` / `error` / 거절 → 오류 이벤트. 중단 신호는 `fetch`의 `signal`에 전달하고 중단이면 조용히 끝낸다(기존과 같음).
- 서버 측 폴백이 없으므로 `reset` 이벤트는 만들지 않는다.

공급자 선택
- `structured.ts`의 `callStructured`와 `streamConversation` 맨 앞에서 `REVIEW_PROVIDER === "openai"`면 위 함수로 보낸다. 값이 없거나 알 수 없으면 `anthropic`.
- `REVIEW_PROVIDER=openai`인데 `OPENAI_API_KEY`가 없으면 호출 시점에 한국어 오류("OpenAI API 키가 없습니다")를 낸다.
- 프롬프트 문구(`editing.ts`, `preprocessing.ts`)는 이관 단계에서 바꾸지 않는다. 프롬프트 변경(아래 2~4)은 이관이 끝나 두 공급자로 비교할 수 있게 된 뒤에 한다.

사용량 로그(목표 5)
- `callStructured` 입력에 `label?: string`(호출 이름, 예: `polishChapter`)을 더하고, 두 공급자 모두 응답 뒤에 `console.info("[editor-call] usage", { label, provider, effort, …사용량 숫자만 })`를 남긴다. 본문·제목은 남기지 않는다(기존 `[editor-chat] usage`와 같은 규칙). 대화는 기존 로그를 유지한다.

### 2. 대사 구어체 원칙 (목표 2의 앞부분)

- `IDEAS_SYSTEM_PROMPT`, `POLISH_SYSTEM_PROMPT`, `buildChatSystemPrompt`에 공통 문구 한 줄을 더한다: "대사는 그 인물이 실제로 입으로 하는 구어체로 쓰세요. 격식체 인물이라도 공문·문어체 문장이 아니라 입말로, 소리 내어 읽어 어색하지 않게 하세요." 새 상수 `SPOKEN_DIALOGUE`를 `editing.ts`에 두고 세 곳이 같은 문구를 쓴다.
- ③은 대사를 건드리지 않는다(따옴표 안 금지)는 지금 규칙을 유지한다.

### 3. 점검형 단계 ⑤ 대사 구어체, ⑥ 서술 문체 (목표 2·3)

공통 모양은 ④와 같다.
- 서버 액션 `checkDialogueAction`, `checkStyleAction`(`checkFactsAction`과 같은 입력·권한·게시본 거절·오류 형식), `editor.ts`에 `checkDialogue`, `checkStyle`. 원고 전체를 한 번 읽고(장마다가 아님. 인물별 말투 일관성과 장 사이 문체 변화는 장을 가로질러야 보인다), 사고 수준은 `high`로 ④와 같게 둔다(같은 수준이어야 명시 캐시를 공유한다).
- 항목 모양은 `FactFinding`과 같다: `topic`, `description`, `occurrences[]`(`chapterNumber`, `paragraphNumber`, `quote`), 선택적 `fix`(`chapterNumber`, `paragraphNumber`, `before`, `after`, `reason`).
- 검증은 ④의 순수 검증을 재사용한다(위치 존재, `before` 정확히 한 번, 겹침·빈 줄 금지). 추가: `before`와 `after`의 **따옴표 글자가 같아야** 한다(따옴표 짝이 깨지면 ①이 어긋난다). 숫자는 `before`의 아라비아 숫자가 `after`에 그대로 있어야 한다.

⑤ 대사 구어체
- 프롬프트: 따옴표 안의 대사 중 입으로 하는 말로 부자연스러운 것(공문·문어체, 설명조, 지나치게 긴 한 호흡)을 찾는다. 인물 설정집의 말투(격식체, 반말 등)는 유지하고 **입말**로만 바꾼다. 레벨 기준표의 "대사는 그 레벨의 구어체" 규칙. 확실한 것만 최대 8건. 대사 내용·사실·숫자는 바꾸지 않는다. `fix`는 대사 안쪽(`before`/`after` 모두 따옴표 글자 없이 대사 안의 구절)을 고친다.
- ③과 달리 이 단계만 대사 안쪽을 건드린다. 따옴표 글자와 따옴표 짝은 건드리지 않는다.

⑥ 서술 문체
- 프롬프트: [설정]의 서술 문체(`narrativeStyle`)에서 벗어나는 곳을 찾는다 — 종결어미가 갑자기 바뀜(`-다`에서 `-요`), 시점 이탈, 장 사이의 어조 변화, 한 장만 수식 밀도가 유난히 높거나 낮음. 확실한 것만 최대 8건. 정정(`fix`)은 선택(고칠 구절이 분명할 때만).

화면
- ④⑤⑥은 **같은 확인 화면**(`facts` 단계를 "점검 결과"로 확장)에 이어서 보여 준다. 항목마다 종류 표시, 위치와 인용, 정정 제안(`이 정정 적용`/`무시`, 기본은 무시). 편집자가 고른 정정만 적용한다.
- 세 단계는 원문에 대해 **병렬로** 호출한다. 적용할 때는 ④ → ⑥ → ⑤ 순으로 적용하고, 앞선 적용으로 `before`가 더는 정확히 한 번 있지 않으면 그 정정은 건너뛰고 화면에 "겹쳐서 적용하지 못한 정정 n건"으로 알린다(제 판단: 같은 구절을 두 점검이 고치는 일은 드물어서 순차 재호출보다 단순한 처리를 택함).
- 설정 화면의 단계 선택에 `대사 구어체 점검`, `서술 문체 점검`(기본 켜짐)을 더한다. 하나라도 켜져 있으면 실행할 수 있다는 규칙은 그대로.
- 한 단계가 실패해도 다른 단계와 이후 단계는 계속한다(오류 한 줄을 남김).

### 4. ③ 레벨 맞춤 다듬기 (목표 4)

- 지금의 `CHAPTER_POLISH_SYSTEM_PROMPT`("수식어·부사를 줄이고 군더더기를 덜어내세요")를 레벨 기준표 기반 프롬프트로 바꾼다. 단계 이름과 화면 위치, 장마다 호출, 검증을 통과한 항목을 **전부 적용**하는 방식은 그대로다.
- 새 프롬프트의 핵심: 이 소설의 목표 레벨 기준(어휘·문장구조)을 주고, **문장 모양은 그대로 둔 채 그 레벨 독자가 막힐 곳만 최소한으로** 고친다. 어려운 낱말은 쉬운 말로, 겹친 꾸밈은 한 겹을, 전문어는 일상어로. 비유와 문체(종결어미 포함)는 그대로. 문장 길이는 평균 목표일 뿐 발동 조건이 아니다(발동 조건은 어려운 낱말과 유난히 얽힌 문장). 장당 최대 10건(제 판단: 마일드한 수정은 지금의 20건보다 적게 잡는다).
- 내용 복잡성(기준표의 두 번째 축)은 ③이 고치지 않는다. 대신 ⑥과 같은 형태의 안내로 줄 수 있으나 이번 범위에서는 **레벨 기준 프롬프트에 기준표를 넣는 데까지만** 한다(내용 복잡성 점검 단계는 만들지 않음, 아래 "남은 질문" 참고).
- 검증은 기존 `validateChapterPolish`를 유지하되 "`after`가 `before`의 120%를 넘으면 버린다"는 규칙은 그대로 둔다(마일드한 수정은 길어지지 않는다). 따옴표·숫자·대사 안쪽 가드도 그대로.
- 목표 레벨은 세션 문서의 `targetLevel`("Lv1"~"Lv6")에서 읽는다. 지금 `levelGuidance`에는 레벨 번호가 없다(`sentenceLen`, `unit`, `stageLabel`만). `getMasterReview`(`lib/data/masterReviews.ts`)가 `targetLevel`도 돌려주도록 확장한다. 값이 없으면 기존 `levelGuidance` 문구만으로 동작한다(기준표 없이).
- 레벨 기준표는 `lib/claude/levelRubric.ts`에 레벨별 상수로 둔다. 값은 편집자가 확정한 `2026-11-25-level-rubric-draft.md`의 표를 그대로 옮긴다.

### 5. 순서와 단계 실행

`setup → [④ ⑤ ⑥ 병렬] → 점검 결과 확인(편집자 선택) → ③ 장마다 → ① → ② → result`

- ③은 선택된 정정이 적용된 본문을 입력으로 받는다. 점검 결과가 하나도 없거나 단계가 꺼져 있으면 확인 화면 없이 ③으로 간다.
- "멈추고 지금까지 보기"는 지금까지 받은 결과로 `result`로 간다(기존 동작과 같음).
- 호출 수: 한 편(10장)에 ④⑤⑥ 각 1회(전체 원고) + ③ 10회 + ② 10회. 설정 화면의 문구가 호출 수를 보여 주는 지금 방식을 유지하고 새 단계만큼 갱신한다.

### 6. 비용 (추정치, 이번 실험에서 측정한 것은 ④와 ③뿐)

terra 명시 캐시 기준으로 ④+③이 약 $0.17. ⑤⑥은 같은 사고 수준(`high`)이라 ④와 캐시를 공유하므로 각 약 $0.02~0.04(추정). ③이 `medium`이라 캐시 쓰기가 한 번 더 든다(약 $0.02). 합쳐 약 $0.25~0.3(추정)이고, 현재 Sonnet 한 편 $0.27(④+③만)과 비슷한 비용으로 단계가 둘 늘어난다. 확정은 구현 뒤 사용량 로그로 한다.

## 단계(실행 순서와 검증)

1. **프롬프트 시험(앱 변경 없음)**: 새 ③ 프롬프트(레벨 기준표, 마일드)를 실험 하네스로 terra에 3장(3·2·8장) 돌려 80자 초과 문장 수, 글자 수 변화, 가드에 걸리는 수정 수를 보고, 원본/수정안 Word 파일 둘로 편집자가 본다. 마일드하지 않다고 판단되면 이 단계에서 프롬프트를 고치거나 중단한다. 예상 비용 $0.15, 상한 $0.3.
2. **모델 이관(A)**: `openai.ts`와 공급자 선택, 사용량 로그. 프롬프트는 건드리지 않는다. 기본 Claude로 배포 → 편집자가 Vercel에 `OPENAI_API_KEY`와 `REVIEW_PROVIDER=openai` 등록 → 같은 원고로 전후 비교.
3. **프롬프트·단계(B)**: `SPOKEN_DIALOGUE`, 레벨 기준표와 새 ③, 점검형 단계 ⑤⑥, 확인 화면 확장.

## 검증

- `openai.ts`: 가짜 `fetch`로 요청 형태(브레이크포인트 위치, 사고 수준, 스키마), 응답 처리(성공, 길이 초과, 거절, 파싱 실패, HTTP 오류), 스트림(조각 순서, 중단, 길이 초과, 실패), 사용량 변환을 단위 테스트한다. Claude 경로의 기존 테스트는 그대로 통과해야 한다.
- 공급자 선택: 기본값, `openai`, 알 수 없는 값, 키 없음.
- ⑤⑥ 검증 함수: 위치 없음, `before` 두 번, 따옴표 글자 변화, 숫자 변화, 겹침, 최대 건수.
- 적용 순서: ④ → ⑥ → ⑤에서 겹치는 정정이 건너뛰어지고 알림이 남는지.
- 새 ③: 기존 `validateChapterPolish` 테스트가 그대로 통과(가드 불변), 프롬프트 문구에 따옴표·숫자·문체 보존 규칙이 들어 있는지.
- 전체: `npx vitest run`, `npx tsc --noEmit`, `npx eslint`. 실제 API는 프롬프트 시험과 이관 후 비교에서만 쓴다(자동 테스트는 외부 호출을 하지 않는다).

## 남은 질문 (편집자 몫)

1. 레벨 기준표의 확정(어휘·구조 칸의 세부 값). 확정 전에는 새 ③ 프롬프트를 확정할 수 없다.
2. 내용 복잡성 축을 점검 단계로 만들지(위치·이유 안내만) 이번에는 기준표만 프롬프트에 넣을지. 이 설계는 후자로 시작한다.
3. `REVIEW_PROVIDER=openai`로 바꾸는 시점과, Production에 등록할 새 OpenAI 키. (실험용 키 두 개는 폐기 권장.)
4. 대화(대화 스트림)의 첫 글자까지의 시간이 Claude보다 느리면 이관 범위에서 대화를 뺄지.

## 구현자에게 맡기는 것

- `openai.ts` 내부 구조, SSE 파서 구현, 테스트 구성.
- `getMasterReview`에 `targetLevel`을 어떻게 싣는지.
- 확인 화면 문구와 컴포넌트 분리.
- 사용량 로그의 정확한 필드 이름.
