# 표현 풀 초기 대량 시딩(Seed Campaign) — 설계

**작성일**: 2026-09-06
**저장소**: word-bank(Cloud Functions), word-bank-web(관리자 대시보드)
**선행 스펙**: `docs/superpowers/specs/2026-09-05-expression-pool-admin-design.md` — 이 스펙에서 만든 표현 풀 관리 화면/파이프라인을 확장한다.

## 배경

선행 스펙으로 표현 풀 관리 화면과 Gemini Batch API 기반 자동 top-up(하루 최대 20개)이 구현됐다. 그런데 언어 하나를 처음부터 대량(예: 366개, "1년 내내 안 겹치게")으로 채우려면 하루 20개씩 약 19일이 걸린다. 이 스펙은 **관리자가 한 번의 액션으로 큰 목표치를 짧은 시간(며칠) 안에 채울 수 있는 별도의 "시딩 캠페인" 기능**을 추가한다.

핵심 제약(선행 스펙에서 이미 확인됨): Gemini 응답 하나에 담을 수 있는 출력 토큰에 물리적 상한(`maxOutputTokens: 65536`)이 있어, "표현 366개 × 14개 언어 뜻"을 한 번에 요청하는 건 불가능하다. 이 스펙은 이 문제를 **"표현 텍스트 생성"과 "언어별 뜻 번역"을 분리된 두 단계로 나눠서** 해결한다 — 각 단계는 366개를 한 번의 호출로 처리할 수 있는 크기다(아래 토큰 계산 참고).

## 범위

**포함**:
- word-bank: 표현 텍스트만 생성하는 1단계 배치, 언어별 번역만 생성하는 2단계 배치(14개), 1단계 완료 시 2단계 14개를 자동 제출하는 오케스트레이션, ID 기반 중복 방지(정규화된 텍스트를 문서 ID로 사용)
- word-bank-web: "초기 시딩 캠페인" 관리자 액션 + 화면, 작업 현황 테이블에 phase/번역언어 컬럼 추가

**제외 (이번 스펙 밖)**:
- 2단계 중 특정 언어 하나가 실패했을 때의 자동 재시도 — 실패 시 관리자가 기존 수정 화면으로 수동 보완(열린 리스크에 명시)
- 캠페인 진행률 바/그룹 뷰 — 이번엔 작업 목록에 컬럼만 추가, 그룹핑은 필요시 후속 작업
- 기존 일일 top-up 스케줄러, 수동 오버라이드(`adminSubmitExpressionBatch`, 1~20개)의 동작 변경 — **이 스펙은 완전히 추가되는 기능이며 기존 경로는 건드리지 않는다**

## 아키텍처

```
[관리자] "초기 시딩 캠페인" 화면에서 개수 입력 후 "시딩 시작"
    ▼
[word-bank-web] submitExpressionSeedCampaignAction → adminSubmitExpressionSeedCampaign (HTTP, x-admin-api-key)
    ▼
[word-bank] submitExpressionSeedTextBatch(language, count)
    │ expressionBatchJobs 문서 생성: { phase: 'text', campaignId: <자기 자신의 문서 ID>, ... }
    ▼
[Gemini Batch] 표현 텍스트만 생성 (뜻 없음) — count개, 한 번의 호출로 충분
    ▼
[poller, phase:'text' 분기] 정규화된 텍스트를 문서 ID로 저장(meanings: {} 상태) →
    같은 poller 실행 안에서 곧바로 14개 언어 번역 job을 자동 제출
    ▼
[word-bank] submitExpressionTranslateBatch(campaignId, language, texts, meaningLanguage) × 14
    │ expressionBatchJobs 문서 14개: { phase: 'translate', meaningLanguage, campaignId, ... }
    ▼
[Gemini Batch] 언어 하나당 count개 표현의 뜻/예문만 생성 — 언어당 한 번의 호출로 충분
    ▼
[poller, phase:'translate' 분기] 응답의 text로 정규화 ID를 재계산해 매칭,
    해당 표현 문서의 meanings.{언어} 필드만 병합 업데이트
```

## 데이터 모델

### `expressionBatchJobs` 스키마 확장 (기존 컬렉션, 필드만 추가 — 하위호환)

```
{
  // 기존 필드 그대로
  language, count, status, geminiBatchJobName, requestedBy, createdAt, completedAt?, error?,

  // 신규 optional 필드 — 없으면 기존 "단순 방식"(일일 top-up/수동 오버라이드) 작업
  phase?: 'text' | 'translate',
  meaningLanguage?: string,      // phase: 'translate'일 때만
  campaignId?: string,           // 1단계 job과 그 job이 낳은 14개 2단계 job이 공유하는 키.
                                  // 1단계 job 자신도 campaignId = 자기 문서 ID를 가진다(자기참조) —
                                  // 그래야 `where('campaignId','==',id)` 쿼리 하나로 캠페인의 15개
                                  // job을 전부 균일하게 조회할 수 있다.
}
```

새 컬렉션이나 새 Firestore 인덱스는 필요 없다 — `campaignId` 단일 필드 동등 비교 쿼리는 Firestore가 자동으로 인덱싱한다(이번 버전은 캠페인별 정렬/그룹 뷰를 안 만들기 때문에 복합 인덱스도 불필요).

### 중복 방지 — 문서 ID 정규화

`functions/src/expressionDedup.ts` (신규):
```ts
export function normalizeExpressionId(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
```
Unicode 문자/숫자가 아닌 연속된 문자를 하이픈 하나로 뭉개고 앞뒤 하이픈을 제거한다. 한국어/일본어/아랍어 등 비-라틴 문자 표현에도 동작한다(`\p{L}`은 유니코드 전체 문자 카테고리). Firestore 문서 ID 제약(빈 문자열 불가, `/` 불가, `.`/`..` 단독 불가, 1500바이트 이하)을 실제 표현 텍스트 길이에서 위반할 일은 없다.

`functions/src/expressionBatchPoller.ts`의 **기존(단순 방식) 저장 로직도 이 ID 스킴으로 교체**한다 — `itemsRef.doc()`(랜덤 ID) 대신 `itemsRef.doc(normalizeExpressionId(expr.text))`을 쓰고 `set(..., { merge: true })`로 바꾼다. 이러면 일일 top-up이 같은 표현을 다시 생성해도 새 문서 대신 기존 문서를 덮어써서, 기존 경로에도 중복 방지가 자동으로 적용된다.

## word-bank Cloud Functions 변경

### 공유 프롬프트 헬퍼 분리

기존 `expressionPool.ts`의 `COMMONNESS_ANCHORS`/`buildCommonnessAnchorLine`(오늘 추가한 CEFR 레벨/few-shot 기준/콘텐츠 제외 지시)를 `functions/src/promptQuality.ts`(신규)로 옮겨서 1단계/2단계 프롬프트 빌더가 공유한다. 콘텐츠 안전 기준(비속어/차별 표현 제외 + `safetySettings`)은 1단계뿐 아니라 2단계 번역에도 동일하게 적용한다(번역 과정에서 거친 표현이 섞여 들어올 가능성도 배제하기 위해).

### 1단계 — `functions/src/expressionSeedText.ts` (신규)

- `EXPRESSION_TEXT_SCHEMA`: `{ expressions: [{ text, register, similarExpressions }] }` (기존 `EXPRESSION_POOL_SCHEMA`에서 `meanings` 필드만 뺀 버전)
- `buildSeedTextPrompt(langName, count, langCode)`: 기존 `buildPoolPrompt`와 동일한 톤(CEFR A2-B1, commonness anchor, 콘텐츠 제외 지시)이되 `meanings`를 요청하지 않음
- `submitExpressionSeedTextBatch(language, count): Promise<{ jobId: string; campaignId: string }>`: `submitInlineBatch` 호출(요청 body는 기존과 동일한 `safetySettings` 포함) 후 `expressionBatchJobs` 문서 생성 시 `phase: 'text'`, `campaignId: <생성한 문서 자신의 ID>`를 함께 저장. `jobId === campaignId`.

### 2단계 — `functions/src/expressionTranslate.ts` (신규)

- `EXPRESSION_TRANSLATE_SCHEMA`: `{ translations: [{ text, definition, example: { sentence, translation } }] }`
- `buildTranslatePrompt(langName, texts, meaningLangName)`: "다음은 이미 확정된 ${langName} 표현 목록이다: [...]. 각 표현에 대해 ${meaningLangName}로 뜻(definition)과, ${langName}로 된 예문(example.sentence) 및 그 ${meaningLangName} 번역(example.translation)을 만들어라. 응답의 "text" 필드에 입력받은 표현을 정확히 그대로 반복해서 어느 표현에 대한 응답인지 명확히 하라." + 동일한 콘텐츠 제외 지시
- `submitExpressionTranslateBatch(campaignId, language, texts, meaningLanguage): Promise<{ jobId: string }>`: job 문서에 `phase: 'translate'`, `meaningLanguage`, `campaignId`(전달받은 값 그대로) 저장
- 토큰 계산: 표현 366개 × 언어 하나치(definition+example.sentence+example.translation+text echo) ≈ 90~100 토큰/표현 ≈ **출력 3만5천 토큰 안팎** — 6만5천 상한 안에 여유 있게 들어간다. 언어당 count가 아무리 커도(현재 시딩 캠페인은 개수 상한을 별도로 두지 않지만, 실무상 366 정도가 상한선으로 예상됨) 2단계는 언어당 한 번의 호출로 충분하다.

### `expressionBatchPoller.ts` 변경 — phase별 분기

`pollExpressionBatchJobsHandler`의 `BATCH_STATE_SUCCEEDED` 처리를 `job.phase` 값에 따라 3갈래로 분기한다:

1. **`phase`가 없음(기존 단순 방식)**: 기존 로직 그대로, 단 저장 시 ID를 `normalizeExpressionId`로 교체(위 참고)
2. **`phase === 'text'`**: `EXPRESSION_TEXT_SCHEMA` 응답 파싱 → 각 표현을 `itemsRef.doc(normalizeExpressionId(expr.text)).set({ text, register, similarExpressions, meanings: {}, createdAt }, { merge: true })`로 저장 → job을 `succeeded`로 갱신 → **곧바로 같은 함수 실행 안에서** `MEANING_LANGUAGE_CODES` 14개 전부에 대해 `submitExpressionTranslateBatch(job.campaignId, job.language, <방금 파싱한 texts>, code)` 호출
3. **`phase === 'translate'`**: `EXPRESSION_TRANSLATE_SCHEMA` 응답 파싱 → 각 항목의 `text`로 `normalizeExpressionId`를 재계산해 매칭 → `itemsRef.doc(id).update({ [\`meanings.${job.meaningLanguage}\`]: { definition, example } })` → job을 `succeeded`로 갱신

세 분기 모두 기존과 동일하게 파싱/쓰기 실패는 그 job만 `failed`로 마킹하고(선행 스펙에서 고친 패턴 재사용), 다른 job/언어에 영향 주지 않는다.

### word-bank-web으로 노출되는 신규 엔드포인트

`functions/src/expressionSeedText.ts`에 추가:
```ts
export async function adminSubmitExpressionSeedCampaignHandler(req: Request, res: Response): Promise<void>
export const adminSubmitExpressionSeedCampaign = onRequest(...)
```
기존 `adminSubmitExpressionBatch`와 동일한 인증 패턴(`requireAdminSecret`), `{ language, count }` 바디, 응답은 `{ jobId, campaignId }`.

## word-bank-web 변경

- **`lib/admin-functions/expressionPool.ts`**: `submitExpressionSeedCampaign(language, count): Promise<{ jobId: string; campaignId: string }>` HTTP 래퍼 추가(기존 `submitExpressionBatch`와 동일 패턴)
- **`lib/actions/expressionActions.ts`**: `submitExpressionSeedCampaignAction(language, count)` Server Action 추가(세션 체크 → 래퍼 호출 → revalidatePath)
- **`lib/data/expressions.ts`**: `ExpressionBatchJob` 타입에 `phase?: 'text' | 'translate'`, `meaningLanguage?: string`, `campaignId?: string` 추가, `listExpressionBatchJobs`의 매핑에 반영
- **`components/admin/ExpressionBatchJobsTable.tsx`**: 컬럼 2개 추가 — "구분"(phase 없으면 "-", 'text'면 "텍스트 생성", 'translate'면 "번역"), "번역 언어"(`meaningLanguage`를 `LANG_NAMES`로 표시, 없으면 "-")
- **`components/admin/ExpressionPoolManager.tsx`**: 새 섹션 "초기 시딩 캠페인" 추가 — 목표 개수 입력 + "시딩 시작" 버튼, `submitExpressionSeedCampaignAction` 호출. 기존 "지금 바로 생성"(1~20개 소량 보충용) 섹션은 그대로 유지.

## 에러 처리

- 1단계 실패(파싱 오류 등): job이 `failed`로 마킹되고, 2단계는 아예 제출되지 않는다(번역할 텍스트가 없으므로). 캠페인은 "1개 실패, 0개 진행"으로 보이고, 관리자가 새 캠페인으로 재시도하면 된다.
- 2단계 중 일부 언어 실패: 그 언어의 job만 `failed`, 나머지 13개는 독립적으로 계속 진행(이미 job 단위로 격리돼 있음). **자동 재시도는 이번 스펙 범위 밖** — 관리자가 기존 수정 화면(`ExpressionEditPanel`)에서 해당 언어 탭에 뜻/예문을 수동으로 채워 넣는 것으로 보완한다.
- 중복 방지 ID 충돌(서로 다른 두 표현이 정규화 후 같은 ID가 되는 극히 드문 경우): 나중에 생성된 쪽이 먼저 것을 덮어쓴다 — 사실상 유사 표현으로 취급하는 것과 같은 결과라 허용 가능한 동작으로 간주한다.

## 테스트 계획

- **word-bank**: `normalizeExpressionId` 유닛 테스트(다양한 언어/특수문자/공백 케이스). `expressionBatchPoller.test.ts`에 phase별 3갈래 분기 테스트 추가(특히 `phase:'text'` 성공 시 14개 번역 job이 정확한 인자로 제출되는지, `phase:'translate'` 성공 시 `meanings.{언어}` 필드만 병합되고 다른 언어 필드는 안 건드리는지). 기존 단순 방식 저장이 ID 기반으로 바뀐 것에 대한 회귀 테스트(같은 텍스트 재생성 시 문서 수가 늘지 않고 덮어써지는지).
- **word-bank-web**: 신규 액션/래퍼 테스트(기존 패턴과 동일). `ExpressionBatchJobsTable`의 신규 컬럼 렌더링은 수동 확인.
- **수동 검증**: 실제로 언어 하나(영어)에 소규모 개수(예: 5~10개)로 캠페인을 돌려서, 1단계 완료 → 14개 언어 job 자동 제출 → 전부 완료까지 실제 흐름을 확인한다. 이때 2단계 프롬프트가 실제로 원본 텍스트를 정확히 echo하는지(매칭 성공률)도 함께 확인.

## 열린 리스크

- 2단계 프롬프트가 요청한 정확한 문자열을 그대로 echo하지 않고 미세하게 다르게 반환할 경우(공백, 문장부호 차이 등), `normalizeExpressionId` 매칭이 실패해 그 표현은 해당 언어 뜻이 안 채워진 채 남을 수 있다. 정규화 함수가 이런 사소한 차이를 흡수하도록 설계됐지만, 실제 응답으로 검증 전까지는 확신할 수 없다 — 수동 검증 단계에서 특히 확인이 필요하다.
- 366개 같은 큰 count에서 2단계 언어별 호출의 실제 토큰 사용량은 추정치다 — 첫 실제 캠페인의 `usageMetadata`로 확인 필요.
- 2단계 일부 언어 실패에 대한 자동 재시도가 없다는 점(위 "제외" 항목) — 실사용 중 자주 발생하면 후속 스펙으로 재시도 기능을 추가해야 한다.
