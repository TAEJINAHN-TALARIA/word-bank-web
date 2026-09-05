# 표현 풀 관리 화면 — 설계

**작성일**: 2026-09-05
**저장소**: word-bank-web(관리자 대시보드), word-bank(Cloud Functions + Firestore)
**선행 스펙**: word-bank의 `docs/superpowers/specs/2026-08-08-expression-push-notifications-design.md` — 이 스펙에서 "관리자 대시보드: 표현 풀 관리 화면"으로 남겨졌던 항목을 구체화한다.

## 배경

표현 추천 푸시 알림 기능은 이미 대부분 구현되어 있다(word-bank 앱/Cloud Functions 쪽, word-bank-web의 개인정보처리방침 반영 포함). 다만 콘텐츠 파이프라인의 관리자 화면이 빠져 있었고, 그 사이 word-bank에 `generateExpressionPool`/`updateExpression`/`deleteExpression` 3개 Cloud Function이 먼저 구현되어 있었다(`functions/src/expressionPool.ts`). 이 스펙은 그 함수들과 word-bank-web 화면을 함께 재설계한다.

### 기존 구현과의 차이 (왜 재설계하는가)

1. **인증 불일치**: `updateExpression`/`deleteExpression`/`generateExpressionPool`은 Firebase callable function(`onCall`)이라 호출자의 Firebase ID 토큰(admin custom claim 포함)이 필요하다. word-bank-web의 Server Action은 세션 쿠키(`__session`)만 들고 있어 ID 토큰이 없고, story-generator 연동에 쓰는 `x-admin-api-key` 공유 시크릿 패턴과도 다르다. → 아래 설계에서 정리.
2. **비용/응답시간**: `generateExpressionPool`은 동기 Gemini API 호출로, count가 클수록 응답이 수 분 걸릴 수 있고 word-bank-web이 배포된 Vercel의 서버리스 함수 타임아웃과 충돌할 위험이 있다. → Gemini Batch API(동일 품질, 약 50% 저렴, 비동기)로 전환.
3. **운영 부담**: 관리자가 언어별로 매번 수동으로 채워야 한다면 신규 언어 지원 시 표현 풀이 비어 알림이 발송되지 않는 리스크(선행 스펙의 "열린 리스크" 항목)가 계속 남는다. → 자동 스케줄러가 언어별 목표 풀 크기를 유지하도록 top-up.

## 범위

**포함**:
- word-bank Cloud Functions 변경: 인증 전환(`onCall` → 직접 Firestore 쓰기 또는 `x-admin-api-key` 방식 `onRequest`), Gemini Batch API 도입, 자동 top-up 스케줄러, 배치 작업 상태 폴링
- word-bank Firestore: `expressionPoolConfig`, `expressionBatchJobs` 컬렉션 신규 추가
- word-bank-web `/admin/expressions` 화면: 언어별 표현 풀 조회/검색/수정/삭제, 언어별 목표 풀 크기 설정, 수동 생성 오버라이드, 배치 작업 현황 모니터링

**제외**:
- 알림 발송 파이프라인(`sendExpressionNotifications`) 자체는 변경하지 않는다(이미 구현·배포됨)
- Add Word 화면의 단어/표현 자동 판별(`generateWordOrExpressionInfo`)은 이미 구현되어 변경 대상이 아님
- Gemini Batch API의 웹훅 기반 완료 통지는 도입하지 않는다(폴링으로 충분한 규모) — 향후 트래픽이 커지면 별도 검토

## 아키텍처

```
[onSchedule: topUpExpressionPools] (매일 1회, word-bank Cloud Functions)
    │ expressionPoolConfig/{language}.targetSize vs expressions/{language}/items의 count() 비교
    │ 부족하면 submitExpressionBatchInternal(language, shortfall) 호출 (requestedBy: 'auto')
    ▼
[Gemini Batch API] models/{model}:batchGenerateContent
    │ 기존 buildPoolPrompt/EXPRESSION_POOL_SCHEMA 재사용 (inline request 1건, count개를 배열로 요청)
    │ 제출 즉시 expressionBatchJobs/{jobId} 문서 생성 (status: 'pending', geminiBatchJobName)
    ▼
[onSchedule: pollExpressionBatchJobs] (30분마다, word-bank Cloud Functions)
    │ status in ['pending','running']인 job의 Gemini batch 상태 확인 (batches.get)
    │ SUCCEEDED → inlinedResponses 파싱해 expressions/{language}/items/*에 batch write, job.status='succeeded'
    │ FAILED/CANCELLED/EXPIRED → job.status='failed', job.error에 사유 기록 (재시도 없음, 다음 top-up 사이클이 count 미달로 자연 재시도)
    ▼
[word-bank-web] /admin/expressions (Next.js Server Component + Server Actions)
    │ 조회: getAdminFirestore()로 expressions/expressionPoolConfig/expressionBatchJobs 직접 read
    │ 수정/삭제/설정변경: getAdminFirestore()로 직접 write (word_cache 복구 액션과 동일 패턴)
    │ 수동 생성 오버라이드: adminSubmitExpressionBatch (onRequest, x-admin-api-key) 호출
    ▼
[관리자] 표현 풀 조회/검색/인라인 수정/삭제, 목표 풀 크기 설정, 배치 작업 현황 확인
```

## word-bank Cloud Functions 변경

### 제거

- `updateExpression`, `deleteExpression` (onCall) — 배포 이후 아무 곳에서도 호출되지 않는 죽은 코드(word-bank-web은 아래처럼 Firestore를 직접 씀). 대응하는 `expressionPool.test.ts`의 테스트도 제거.

### 변경

- `generateExpressionPoolHandler`의 프롬프트/스키마 빌더(`buildPoolPrompt`, `EXPRESSION_POOL_SCHEMA`, `MEANING_LANGUAGE_CODES`)는 그대로 유지하되, 동기 `:generateContent` 호출 로직을 제거하고 아래 신규 함수들로 대체한다.

### 신규

**`submitExpressionBatchInternal(language, count): Promise<{ jobId: string }>`** (internal, exported for tests)
- `buildPoolPrompt(langName, count)`로 프롬프트 구성 (기존과 동일)
- Gemini `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:batchGenerateContent`에 inline request 1건(`generationConfig.responseMimeType/responseSchema`는 기존과 동일) 제출
- 응답의 batch job 리소스 이름(`batches/*`)을 `geminiBatchJobName`으로 저장하며 `expressionBatchJobs`에 신규 문서 생성:
  ```
  { language, count, status: 'pending', geminiBatchJobName, requestedBy: 'auto' | 'manual', createdAt: FieldValue.serverTimestamp() }
  ```

**`adminSubmitExpressionBatch`** (onRequest, POST, `x-admin-api-key`)
- story-generator의 `adminPublishStory`와 동일한 인증 패턴(`ADMIN_API_SHARED_SECRET` — story-generator와 같은 GCP 프로젝트(`wordbank-6284f`)에 이미 존재하는 시크릿이므로 재사용, 신규 시크릿 생성 불필요)
- 요청 바디 `{ language, count }` 검증(`count`는 1~50), `submitExpressionBatchInternal(language, count, requestedBy: 'manual')` 호출, `{ jobId }` 응답

**`topUpExpressionPools`** (onSchedule, 매일 1회, 예: `'0 3 * * *'`)
- `expressionPoolConfig`의 모든 언어 문서를 순회하며 각 언어의 `expressions/{language}/items`에 대해 Firestore `count()` 집계 쿼리 실행
- `targetSize - currentCount > 0`이면 `submitExpressionBatchInternal(language, shortfall, requestedBy: 'auto')` 호출 (한 번에 최대 50개로 클램프 — Gemini 응답 스키마/토큰 한도 고려)
- 이미 해당 언어에 `pending`/`running` 상태인 job이 있으면 중복 제출하지 않고 스킵

**`pollExpressionBatchJobs`** (onSchedule, 30분마다)
- `expressionBatchJobs`에서 `status in ['pending', 'running']`인 문서 조회
- 각 job의 `geminiBatchJobName`으로 `GET https://generativelanguage.googleapis.com/v1beta/{name=batches/*}` 호출해 `state` 확인
- `BATCH_STATE_SUCCEEDED`: `output.inlinedResponses`를 파싱해 `expressions/{language}/items/*`에 batch write(기존 `generateExpressionPoolHandler`의 파싱/저장 로직 재사용), job을 `{ status: 'succeeded', completedAt }`로 갱신
- `BATCH_STATE_FAILED`/`CANCELLED`/`EXPIRED`: job을 `{ status: 'failed', error: <사유>, completedAt }`로 갱신 (재시도 없음)
- `BATCH_STATE_PENDING`/`RUNNING`: 상태 유지, 다음 폴링에서 재확인

### Firestore 신규 컬렉션 + 규칙

`firestore.rules`에 추가 (기존 `expressions` 컬렉션의 `write: if false` 패턴과 동일 — 클라이언트는 읽기/쓰기 모두 불가, Admin SDK만 접근):

```
match /expressionPoolConfig/{language} {
  allow read, write: if false;
}
match /expressionBatchJobs/{jobId} {
  allow read, write: if false;
}
```

- `expressionPoolConfig/{language}`: `{ targetSize: number, updatedAt: Timestamp }`
- `expressionBatchJobs/{jobId}`: `{ language: string, count: number, status: 'pending'|'running'|'succeeded'|'failed', geminiBatchJobName: string, requestedBy: 'auto'|'manual', createdAt: Timestamp, completedAt?: Timestamp, error?: string }`

## word-bank-web 화면 설계 (`/admin/expressions`)

### 네비게이션

`app/admin/(dashboard)/layout.tsx`의 `NAV_ITEMS`에 추가:
```ts
{ href: "/admin/expressions", label: "표현 풀 관리" }
```

### 화면 구성 (`app/admin/(dashboard)/expressions/page.tsx`)

1. **언어 선택 드롭다운** — `lib/constants/languages.ts`에 word-bank의 `functions/src/langNames.ts`를 복제한 15개 언어 상수(코드 상단에 "word-bank/functions/src/langNames.ts와 동기화 유지" 주석)
2. **선택 언어 패널**:
   - 현재 풀 크기(count) / 목표 풀 크기(`targetSize`) — 편집 가능한 숫자 입력 + 저장 버튼
   - "지금 바로 생성" 버튼 + 개수 입력(1~50) — 수동 오버라이드, 제출 후 작업 현황에 반영
   - 표현 목록 테이블 — 열: `text`, `register`, `similarExpressions` 개수, 대표 언어(한국어) 뜻 미리보기, [수정]/[삭제]. 커서 기반 페이지네이션(기존 `stories`/`wordFixReports` 목록과 동일 패턴)
   - "수정" 클릭 → 우측 패널: 14개 언어 탭, 탭마다 `definition`/`example.sentence`/`example.translation` 입력 필드, 그 위에 `text`/`register`/`similarExpressions`(콤마 구분 입력) 필드. [저장]/[취소]
3. **작업 현황 섹션** — `expressionBatchJobs` 최근 목록(선택 언어 기준 또는 전체): 상태 배지(대기중/진행중/완료/실패), 언어, 개수, 자동/수동 구분, 생성·완료 시각, 실패 시 에러 메시지. 실시간 폴링 없음 — 페이지 새로고침/재방문 시 서버 렌더로 최신 상태 반영(다른 대시보드 페이지와 동일한 원칙).

### 데이터 접근 계층

**`lib/data/expressions.ts`** (신규, `"server-only"` + `getAdminFirestore()` 패턴):
- `listExpressionPoolConfigs(): Promise<{ language: string; targetSize: number; currentCount: number }[]>`
- `listExpressions(language: string, cursor?: string): Promise<{ items: Expression[]; nextCursor: string | null }>`
- `listExpressionBatchJobs(language?: string): Promise<ExpressionBatchJob[]>`

**`lib/actions/expressionActions.ts`** (신규, `"use server"`):
- `updateExpressionAction(language, id, updates)` — `getAdminSession()` 재확인, `updates` 키가 `['text', 'register', 'meanings', 'similarExpressions']` 화이트리스트 내인지 검증(word-bank의 기존 `updateExpressionHandler`에 있던 검증을 이쪽으로 이관), `getAdminFirestore().collection('expressions').doc(language).collection('items').doc(id).update(updates)`, `revalidatePath('/admin/expressions')`
- `deleteExpressionAction(language, id)` — 동일 인증 패턴, `.delete()`
- `updateExpressionPoolConfigAction(language, targetSize)` — `targetSize`가 양의 정수인지 검증 후 `expressionPoolConfig/{language}`에 `set({ targetSize, updatedAt }, { merge: true })`
- `submitExpressionBatchAction(language, count)` — `getAdminSession()` 재확인 후 `lib/admin-functions/expressionPool.ts`의 `submitExpressionBatch()` 호출, `revalidatePath`
- `fetchMoreExpressionsAction(language, cursor)` — 커서 페이지네이션

**`lib/admin-functions/expressionPool.ts`** (신규, `lib/admin-functions/storyGenerator.ts`와 동일 패턴):
```ts
export async function submitExpressionBatch(language: string, count: number): Promise<{ jobId: string }>
```
`STORY_GENERATOR_FUNCTIONS_BASE_URL`/`ADMIN_API_SHARED_SECRET` 환경변수를 재사용한다(story-generator와 word-bank이 같은 Firebase 프로젝트 `wordbank-6284f`에 배포되므로 base URL과 시크릿 값이 그대로 유효함 — 새 환경변수 불필요). 변수명이 더 이상 story-generator 전용이 아니게 되는 점은 구현 단계에서 리네이밍 여부만 판단하면 되는 사소한 사항이다(값 자체는 바뀌지 않으므로 리네이밍해도 배포 리스크 없음).

### `Expression` 타입 (word-bank-web 측, 신규)

```ts
type Expression = {
  id: string;
  text: string;
  register: 'casual' | 'formal';
  meanings: Record<string, { definition: string; example: { sentence: string; translation: string } }>;
  similarExpressions: string[];
  createdAt: string; // ISO, Firestore Timestamp를 서버에서 변환
};

type ExpressionBatchJob = {
  id: string;
  language: string;
  count: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  requestedBy: 'auto' | 'manual';
  createdAt: string;
  completedAt?: string;
  error?: string;
};
```

## 에러 처리

- Batch 제출 실패(Gemini API 오류, `adminSubmitExpressionBatch`가 500 반환): Server Action이 에러 메시지를 그대로 `{ error }`로 반환해 화면에 표시(story-generator 연동과 동일 원칙 — 프로덕션에서 Server Action 에러 메시지가 마스킹되는 것을 피함)
- Gemini batch job이 `FAILED`/`CANCELLED`/`EXPIRED`: job 문서에 사유 저장 후 대시보드에 노출, 재시도는 하지 않음(다음 `topUpExpressionPools` 사이클이 여전히 count 미달임을 확인하고 자연스럽게 재제출)
- word-bank-web의 Firestore 직접 write 실패(`updateExpressionAction` 등): try/catch로 감싸 `{ error }` 반환(`restoreWordCacheEntryAction`과 동일 패턴)
- `topUpExpressionPools`가 이미 `pending`/`running` job이 있는 언어를 건너뛰므로, 폴링 주기(30분) 내에 중복 배치가 쌓이지 않음

## 테스트 계획

**word-bank**:
- `expressionPool.test.ts`를 신규 함수 중심으로 재작성: `submitExpressionBatchInternal`(Gemini 목 응답으로 job 문서 생성 검증), `topUpExpressionPools`(목표 대비 부족분 계산, 이미 진행중인 job 있을 때 스킵), `pollExpressionBatchJobs`(SUCCEEDED/FAILED/여전히 RUNNING 각 상태 전이)
- `adminSubmitExpressionBatch`의 `x-admin-api-key` 검증 로직 테스트(story-generator의 `adminHandlers` 테스트 패턴 참고)

**word-bank-web**:
- `lib/data/expressions.ts`, `lib/actions/expressionActions.ts`의 순수 로직 Vitest — 특히 `updateExpressionAction`의 필드 화이트리스트 검증, 커서 페이지네이션 경계값
- `lib/admin-functions/expressionPool.ts`는 `fetch` 목킹으로 성공/실패 응답 테스트

**수동 검증** (배포 전 1회, 스테이징):
- 수동 오버라이드로 실제 Batch 제출 → 폴링 → `expressions` 컬렉션 반영까지 end-to-end 확인
- `/admin/expressions`에서 표현 조회/검색/수정/삭제, 목표 풀 크기 저장이 실제 Firestore에 반영되는지 확인
- 목표 풀 크기를 낮게 설정해 top-up 스케줄러가 아무것도 제출하지 않는지, 높게 설정해 자동 제출되는지 확인

## 열린 리스크

- Gemini Batch API의 정확한 REST 요청/응답 스키마(특히 inline request의 정확한 필드명, 인증 헤더 vs 쿼리 파라미터)는 구현 단계에서 실제 호출로 재검증이 필요하다 — 이 스펙 작성 시점에 문서로 확인했으나 실제 계정/모델에 따라 세부사항이 다를 수 있음
- 언어별 목표 풀 크기의 기본값(신규 언어 추가 시 `expressionPoolConfig` 문서가 아예 없으면 top-up 대상에서 제외됨) — 구현 계획 단계에서 "신규 언어 추가 시 `expressionPoolConfig` 문서도 함께 생성" 운영 체크리스트 항목으로 명시 필요
