# 마스터 편집 화면 개선 ② — 품질 점검을 편집 창으로, 승인된 마스터의 게이트는 기록만 (설계)

## 왜

한국어 마스터는 사람이 검토·편집해 승인한다. 그런데 승인 뒤에 Layer 6 마스터 게이트(규칙 검사 + LLM 심사)가 다시 돌아 탈락하면 마스터가 검토 화면으로 되돌아온다(`returnToMasterReview`). 사람이 이미 책임지고 승인한 글을 다시 불러들이는 구조이고, 편집자는 승인 전에는 그 심사가 어떻게 볼지 알 수 없다. 한국어 마스터가 충분히 좋으면 뒤 단계는 번역과 언어별 점검만 남아야 한다. (①에서 정한 방향: 사용자가 "점검 결과만 기록하고 막지 않는 쪽"을 선택했다.)

## 목표 / 비목표

- 목표 1: 편집 화면에서 지금 편집 중인 글에 마스터 게이트와 같은 점검(규칙 검사 + LLM 심사)을 요청해 결과를 본다. 승인 전에 같은 기준으로 미리 본다.
- 목표 2: 승인된 마스터가 Layer 6 마스터 게이트에서 탈락해도 검토 화면으로 되돌리지 않는다. 결과는 `layer6Gates/master`에 그대로 기록하고 번역·언어별 점검으로 이어간다.
- 비목표: 번역(Layer 5)과 언어별 Layer 6 점검 변경, 승인 전(편집하지 않은) 마스터의 재생성 정책 변경(그대로 Layer 2부터 재생성), 점검 결과를 Firestore에 저장하는 것, 점검 통과를 승인의 조건으로 삼는 것, `characterVoiceConsistency`를 판정에 포함하는 것(여전히 detect-only).
- 안티 목표: 이미 승인 때 막히는 규칙 검사 실패를 승인 뒤에 풀어 버리는 것(규칙 검사는 승인 시점에 여전히 막는다), 점검 호출이 편집 상태를 바꾸는 것(읽기 전용).

## 접근 (사용자 방향 승인: 2026-11-22)

- **심사 방식**: 기존 Gemini 심사(`buildEvalPrompt`/`generateSync`)를 새 Cloud Function으로 열어 쓴다. 편집 창과 실제 게이트의 기준·프롬프트가 같다. Claude로 따로 심사하는 대안은 기준이 달라 편집 창에서는 통과해도 게이트에서는 탈락할 수 있어 제외.
- **게이트 변경**: 승인된 마스터가 탈락하면 `continue`(기록하고 진행). 되돌리기(`return_to_review`)와 `returnToMasterReview`를 제거한다. 승인 전 세션의 `regenerate`는 그대로.
- LLM 점수는 호출마다 조금 흔들린다. 편집 창의 통과가 이후 게이트 통과를 보장하지 않지만, 이제 게이트가 막지 않으므로 문제가 되지 않는다. 심사는 본문 전체가 아니라 `buildExcerpt`의 발췌본을 본다(기존 게이트와 같음).

## 설계

### 1. story-generator — 게이트를 기록만으로

- `decideMasterGateFailure(session)`: 승인된 마스터면 `'continue'`, 아니면 `'regenerate'`.
- 배치 경로 `finishLayer6Round`와 온디맨드 경로 `runTranslationAndGateLoop`: 마스터 게이트가 `pass`가 아니면 — `regenerate`는 기존 동작 그대로(배치 `handleDraftFailure`, 온디맨드 Layer 2 재시도), `continue`는 `console.warn`으로 사유를 남기고 막지 않은 채 다음 단계(언어별 게이트 재시도 판단)로 진행한다.
- `returnToMasterReview`와 오케스트레이터의 import를 제거한다. 과거에 되돌려진 세션의 `masterReview.gateNote`는 그대로 두고, 웹의 배너도 그 데이터를 위해 남긴다.
- `layer6Gates/master`의 기록 모양은 그대로(`status: 'fail'`, `llmEvalReasons`). 이 값을 읽는 곳은 마스터 게이트 판단 두 군데뿐이다.

### 2. story-generator — `adminEvaluateMaster`

- `POST { sessionId, edits }` — `edits`는 편집 중인 전 챕터 `{ chapterNumber, chapterTitle, body }[]`(저장 API와 같은 모양). 검토 대기 상태만 허용. `validateMasterReviewSave({ status, edits })`로 검증하고 `mergeEditedChapters(저장된 layer4 챕터, edits)`로 편집본을 만든다. 읽기 전용(아무것도 쓰지 않음).
- 새 모듈 `src/pipeline/masterEvaluation.js`: `evaluateMasterForReview({ chapters, level, combo, characters, generate })` — `assembleNovelText` → `autoCheck(…,'ko',level)`; 규칙 검사 실패가 있으면 LLM 심사는 건너뛴다(게이트와 같은 비용 절감). 통과하면 `buildLayer6Requests`로 만든 요청을 주입된 `generate`(= `generateSync`)로 보내 `extractJSON`한다.
- 응답: `{ ruleBase: { pass, failures, warnings }, llm: null | { error } | { pass, failItems, items: [{ key, score, reason, problemPhrases?, gated }] } }`. `items`는 `languageLearningFit`을 뺀 항목이고, `gated: false`는 `characterVoiceConsistency`(참고용). `llm.pass`는 게이트 기준 그대로(`gated` 항목 중 2점 이하가 없을 것).
- 함수 설정: secrets `ADMIN_API_SHARED_SECRET`·`GEMINI_API_KEY`, `timeoutSeconds: 120`, `generateSync`는 핸들러 안에서 늦게 import(승인 핸들러와 같은 이유).

### 3. 웹 — 품질 점검 탭과 승인 안내

- `lib/admin-functions/storyGenerator.ts`의 `evaluateMaster(sessionId, edits)`, 서버 액션 `evaluateMasterAction({ sessionId, chapters })`(로그인 확인, 편집 화면의 `chapters`를 `MasterEdit[]`로 바꿔 전송, 실패는 `{ error }`).
- `ClaudePanel`에 세 번째 탭 `품질 점검`(검토 모드만). `점검 실행` 버튼 → 규칙 검사 실패·경고 목록, 항목별 점수 배지(4~5 좋음, 3 경계, 1~2 낮음)와 한 줄 사유, `levelFit` 등의 `problemPhrases`는 본문에서 그 구절이 든 문단을 찾아 `이동` 버튼으로 편집 화면을 그 문단으로 옮긴다. `characterVoiceConsistency`는 "참고(판정 제외)"로 표시.
- 결과는 점검한 시점의 원고와 함께 들고 있다가, 이후 원고가 바뀌면 "점검 이후 글이 바뀌었어요"를 보인다.
- 승인 줄(하단 바)에 한 줄 안내: 점검 전 / 최근 점검에서 낮은 항목 N개(글이 바뀐 뒤면 "다시 점검 권장"). **승인은 막지 않는다.**

## 결정한 것(사용자 외)

- 점검 결과는 저장하지 않는다(화면 상태로만). 게이트 기록은 승인 뒤 파이프라인이 남기는 것으로 충분하다.
- 규칙 검사 실패 시 LLM 심사는 건너뛴다(기존 게이트와 동일, 비용 절감).
- `problemPhrases`의 문단 찾기는 공백을 정규화한 부분 문자열 일치(첫 일치 문단).

## 빌더에게 남긴 것

- 항목 한국어 이름 표(`contentSafety` → 내용 안전성 등)와 배지·목록 마크업(기존 패널 스타일), 문단 찾기 순수 함수의 위치(`lib/masterReview.ts` 또는 새 파일).
- 테스트: story-generator `tests/masterReview.test.js`(`decideMasterGateFailure`), 새 `tests/masterEvaluation.test.js`(가짜 `generate`로 통과·탈락·규칙 실패·API 오류·파싱 실패), 웹 액션·문단 찾기 단위 테스트. 화면은 수동 확인 목록.

## 알려 둘 한계

- 점검 한 번이 Gemini 호출 한 번(수십 초). 글이 바뀌면 다시 눌러야 한다.
- 승인된 마스터의 탈락이 더는 눈에 띄지 않는다 — `layer6Gates/master`와 Cloud Functions 로그에만 남는다.
- 파이프라인(오케스트레이터) 변경이라 배포는 `adminEvaluateMaster` 하나만이 아니라 게이트가 도는 함수들(`pollAllSessions`·`resumeOnDemand` 등)도 함께 올려야 한다.
