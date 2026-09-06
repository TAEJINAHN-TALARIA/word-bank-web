# 표현 풀 초기 대량 시딩(Seed Campaign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표현 풀을 큰 목표치(예: 366개)로 며칠 안에 채울 수 있는 "시딩 캠페인" 기능을 추가한다 — 텍스트만 먼저 한 번에 생성하고, 14개 언어 번역을 자동으로 이어서 제출하는 2단계 파이프라인.

**Architecture:** 1단계(`expressionSeedText.ts`)가 표현 텍스트 N개를 한 번의 Gemini 호출로 생성해 `meanings: {}` 상태로 저장하고, poller가 그 성공을 감지하면 곧바로 2단계(`expressionTranslate.ts`) 14개 언어 번역 job을 자동 제출한다. 각 언어 번역도 언어당 한 번의 호출로 처리된다(토큰 계산상 366개까지 안전). 모든 저장은 정규화된 텍스트를 문서 ID로 써서(`expressionDedup.ts`) 중복 생성 시 자동으로 덮어쓴다. 기존 일일 top-up/수동 오버라이드 경로는 전혀 건드리지 않는다.

**Tech Stack:** word-bank/functions: TypeScript, firebase-functions v2, firebase-admin v13, Jest. word-bank-web: Next.js 16, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-expression-pool-seed-campaign-design.md` (선행 스펙: `docs/superpowers/specs/2026-09-05-expression-pool-admin-design.md`)

## Global Constraints

- 새 Firestore 컬렉션이나 새 복합 인덱스는 필요 없다 — `campaignId` 단일 필드 동등 비교는 Firestore가 자동 인덱싱한다.
- Gemini 모델은 `gemini-2.5-flash`, `maxOutputTokens: 65536`, `thinkingConfig: { thinkingBudget: 0 }` — 기존 경로와 동일.
- 기존 `adminSubmitExpressionBatch`(1~20개 소량 보충), `topUpExpressionPools`(일일 자동), 관리자 CRUD는 이번 플랜에서 동작을 변경하지 않는다 — 전부 순수 추가 기능이다.
- 1단계 캠페인의 `count` 상한은 500으로 둔다(토큰 예산 안전마진 — 65536 ÷ 약 55토큰/표현 ≈ 1190의 절반 이하로 여유를 둔 값. 2단계 언어당 계산도 500 × 약 95토큰 ≈ 47,500 토큰으로 상한 안에 들어온다).
- word-bank 테스트는 `npm --prefix functions test`(Jest), word-bank-web 테스트는 `npm run test`(Vitest run) + `npm run lint` + `npm run build`.
- word-bank는 별도 워크트리 없이 `main` 체크아웃에서 직접 작업한다(선행 세션의 소규모 변경과 동일 — 단, 체크아웃에 사용자의 관련 없는 미커밋 변경사항이 있으니 `git add`는 항상 이 플랜이 만든 파일만 지정한다). word-bank-web도 마찬가지로 현재 체크아웃(`master`)에서 직접 작업한다.

---

## Part A — word-bank (Cloud Functions)

### Task 1: 중복 방지 ID 정규화 헬퍼

**Files:**
- Create: `functions/src/expressionDedup.ts`
- Create: `functions/src/expressionDedup.test.ts`

**Interfaces:**
- Produces: `normalizeExpressionId(text: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/expressionDedup.test.ts`:
```ts
import { normalizeExpressionId } from './expressionDedup';

describe('normalizeExpressionId', () => {
  it('공백과 대소문자를 정규화한다', () => {
    expect(normalizeExpressionId('Break the Ice')).toBe('break-the-ice');
  });

  it('특수문자를 하이픈으로 치환한다', () => {
    expect(normalizeExpressionId("it's raining cats & dogs")).toBe('it-s-raining-cats-dogs');
  });

  it('앞뒤 공백/구두점을 제거한다', () => {
    expect(normalizeExpressionId('  piece of cake!  ')).toBe('piece-of-cake');
  });

  it('비-라틴 문자(한국어)를 그대로 보존한다', () => {
    expect(normalizeExpressionId('발 없는 말이 천리 간다')).toBe('발-없는-말이-천리-간다');
  });

  it('같은 표현의 대소문자/공백 변형은 같은 ID로 정규화된다', () => {
    expect(normalizeExpressionId('Break The Ice')).toBe(normalizeExpressionId('break the ice'));
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd functions && npx jest src/expressionDedup.test.ts`
Expected: FAIL with "Cannot find module './expressionDedup'"

- [ ] **Step 3: 구현**

`functions/src/expressionDedup.ts`:
```ts
export function normalizeExpressionId(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd functions && npx jest src/expressionDedup.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/expressionDedup.ts functions/src/expressionDedup.test.ts
git commit -m "feat: add normalized-text ID helper for expression dedup"
```

---

### Task 2: 공유 프롬프트 품질/안전 헬퍼 분리

**Files:**
- Create: `functions/src/promptQuality.ts`
- Modify: `functions/src/expressionPool.ts`

**Interfaces:**
- Produces: `buildCommonnessAnchorLine(langName, langCode): string`, `CONTENT_SAFETY_INSTRUCTION: string`, `GEMINI_SAFETY_SETTINGS: {category, threshold}[]`
- Also: `expressionPool.ts`의 `MEANING_LANGUAGE_CODES`에 `export` 추가(Task 6에서 poller가 임포트)

이 태스크는 순수 리팩터링이다 — `buildPoolPrompt`가 생성하는 프롬프트 문자열 내용은 그대로 유지되므로 `expressionPool.test.ts`는 수정하지 않는다(기존 테스트로 회귀 확인).

- [ ] **Step 1: `promptQuality.ts` 생성**

`functions/src/promptQuality.ts`:
```ts
// 언어별로 확신 있게 제시할 수 있는 "이 정도는 흔해야 한다" 기준 예시만 등록한다.
// 없는 언어에 잘못된 예시를 넣는 것보다, 설명형 기준(fallback)이 더 안전하다.
const COMMONNESS_ANCHORS: Record<string, string[]> = {
  en: ['break the ice', 'piece of cake', 'under the weather'],
};

export function buildCommonnessAnchorLine(langName: string, langCode: string): string {
  const anchors = COMMONNESS_ANCHORS[langCode];
  if (anchors) {
    const quoted = anchors.map((a) => `"${a}"`).join(', ');
    return `For calibration: expressions at this level of ubiquity are the right bar (all near-universally recognized by native ${langName} speakers) — ${quoted}. Only include expressions at least this well-known.`;
  }
  return `Only include expressions that would be near-universally recognized by native ${langName} speakers — the kind that appear in the most basic textbooks and dictionaries for this language, not regional, dated, or obscure ones.`;
}

export const CONTENT_SAFETY_INSTRUCTION =
  'Exclude vulgar, profane, sexually explicit, discriminatory, or otherwise offensive expressions — every expression must be appropriate for a general, professional, or educational audience.';

export const GEMINI_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
];
```

- [ ] **Step 2: `expressionPool.ts`에서 로컬 정의 제거하고 import로 교체**

`functions/src/expressionPool.ts`의 아래 블록:
```ts
const MEANING_LANGUAGE_CODES = ['ko', 'en', 'ja', 'zh', 'de', 'fr', 'es', 'pt', 'ar', 'la', 'hi', 'bn', 'ru', 'id'];
```
을 아래로 교체:
```ts
export const MEANING_LANGUAGE_CODES = ['ko', 'en', 'ja', 'zh', 'de', 'fr', 'es', 'pt', 'ar', 'la', 'hi', 'bn', 'ru', 'id'];
```

그 다음, 아래 블록(`COMMONNESS_ANCHORS`와 `buildCommonnessAnchorLine` 함수 전체):
```ts
// 언어별로 확신 있게 제시할 수 있는 "이 정도는 흔해야 한다" 기준 예시만 등록한다.
// 없는 언어에 잘못된 예시를 넣는 것보다, 설명형 기준(buildCommonnessAnchorLine의 fallback)이 더 안전하다.
const COMMONNESS_ANCHORS: Record<string, string[]> = {
  en: ['break the ice', 'piece of cake', 'under the weather'],
};

function buildCommonnessAnchorLine(langName: string, langCode: string): string {
  const anchors = COMMONNESS_ANCHORS[langCode];
  if (anchors) {
    const quoted = anchors.map((a) => `"${a}"`).join(', ');
    return `For calibration: expressions at this level of ubiquity are the right bar (all near-universally recognized by native ${langName} speakers) — ${quoted}. Only include expressions at least this well-known.`;
  }
  return `Only include expressions that would be near-universally recognized by native ${langName} speakers — the kind that appear in the most basic textbooks and dictionaries for this language, not regional, dated, or obscure ones.`;
}
```
을 통째로 삭제한다.

파일 상단 import 블록에 추가:
```ts
import { buildCommonnessAnchorLine, CONTENT_SAFETY_INSTRUCTION, GEMINI_SAFETY_SETTINGS } from './promptQuality';
```

`buildPoolPrompt` 함수 안의 이 줄:
```ts
Exclude vulgar, profane, sexually explicit, discriminatory, or otherwise offensive expressions — every expression must be appropriate for a general, professional, or educational audience.
```
을 아래로 교체:
```ts
${CONTENT_SAFETY_INSTRUCTION}
```

`submitExpressionBatchInternal` 안의 인라인 배열:
```ts
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
      ],
```
을 아래로 교체:
```ts
      safetySettings: GEMINI_SAFETY_SETTINGS,
```

- [ ] **Step 3: 기존 테스트로 회귀 확인 (내용 변경 없음을 검증)**

Run: `cd functions && npx jest src/expressionPool.test.ts`
Expected: PASS (10 tests, 기존과 동일 — 프롬프트 문자열 내용이 바뀌지 않았으므로)

- [ ] **Step 4: 전체 빌드 확인**

Run: `cd functions && npm run build`
Expected: 타입 에러 없이 성공

- [ ] **Step 5: 커밋**

```bash
git add functions/src/promptQuality.ts functions/src/expressionPool.ts
git commit -m "refactor: extract shared prompt-quality/safety helpers"
```

---

### Task 3: 기존(단순 방식) 저장 로직에 중복 방지 ID 적용

**Files:**
- Modify: `functions/src/expressionBatchPoller.ts`
- Modify: `functions/src/expressionBatchPoller.test.ts`

**Interfaces:**
- Consumes: `normalizeExpressionId` (Task 1)

- [ ] **Step 1: 실패하는(또는 신규) 테스트 작성**

`functions/src/expressionBatchPoller.test.ts`의 첫 번째 `it('SUCCEEDED 상태면...')` 테스트 안, `await pollExpressionBatchJobsHandler();` 바로 다음 줄에 아래 단언을 추가:
```ts
    expect(mockItemsDoc).toHaveBeenCalledWith('break-the-ice');
```
이 단언을 쓰려면 `mockFirestoreWithJobs`가 `mockItemsDoc`도 반환하도록 고쳐야 한다. `mockFirestoreWithJobs` 함수의 반환문:
```ts
  return { mockWriteBatchSet, mockWriteBatchCommit };
```
을 아래로 교체:
```ts
  return { mockWriteBatchSet, mockWriteBatchCommit, mockItemsDoc };
```
그리고 첫 번째 테스트의 구조분해 할당:
```ts
    const { mockWriteBatchSet, mockWriteBatchCommit } = mockFirestoreWithJobs([jobDoc]);
```
을 아래로 교체:
```ts
    const { mockWriteBatchSet, mockWriteBatchCommit, mockItemsDoc } = mockFirestoreWithJobs([jobDoc]);
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd functions && npx jest src/expressionBatchPoller.test.ts`
Expected: FAIL — `mockItemsDoc`가 아무 인자 없이(`itemsRef.doc()`) 호출되므로 `'break-the-ice'` 인자로 호출됐다는 단언이 실패

- [ ] **Step 3: 구현**

`functions/src/expressionBatchPoller.ts` 상단 import에 추가:
```ts
import { normalizeExpressionId } from './expressionDedup';
```

기존(단순 방식) 저장 루프:
```ts
          const writeBatch = db.batch();
          const itemsRef = db.collection('expressions').doc(job.language).collection('items');
          for (const expr of parsed.expressions) {
            writeBatch.set(itemsRef.doc(), {
              text: expr.text,
              register: expr.register,
              meanings: expr.meanings,
              similarExpressions: Array.isArray(expr.similarExpressions) ? expr.similarExpressions : [],
              createdAt: FieldValue.serverTimestamp(),
            });
          }
```
을 아래로 교체:
```ts
          const writeBatch = db.batch();
          const itemsRef = db.collection('expressions').doc(job.language).collection('items');
          for (const expr of parsed.expressions) {
            writeBatch.set(itemsRef.doc(normalizeExpressionId(expr.text)), {
              text: expr.text,
              register: expr.register,
              meanings: expr.meanings,
              similarExpressions: Array.isArray(expr.similarExpressions) ? expr.similarExpressions : [],
              createdAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd functions && npx jest src/expressionBatchPoller.test.ts`
Expected: PASS (전체 스위트, 새 단언 포함)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/expressionBatchPoller.ts functions/src/expressionBatchPoller.test.ts
git commit -m "fix: use normalized-text IDs for expression writes (dedup)"
```

---

### Task 4: 1단계 — 표현 텍스트 생성 배치

**Files:**
- Create: `functions/src/expressionSeedText.ts`
- Create: `functions/src/expressionSeedText.test.ts`

**Interfaces:**
- Consumes: `buildCommonnessAnchorLine`/`CONTENT_SAFETY_INSTRUCTION`/`GEMINI_SAFETY_SETTINGS` (Task 2), `submitInlineBatch` (기존 `geminiBatchClient.ts`), `requireAdminSecret` (기존 `adminSecret.ts`)
- Produces: `EXPRESSION_TEXT_SCHEMA`, `buildSeedTextPrompt(langName, count, langCode): string`, `submitExpressionSeedTextBatch(language, count): Promise<{jobId: string; campaignId: string}>`, `adminSubmitExpressionSeedCampaignHandler(req, res): Promise<void>`, `adminSubmitExpressionSeedCampaign` (onRequest export)

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/expressionSeedText.test.ts`:
```ts
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
}));
jest.mock('./secrets', () => ({
  geminiApiKey: { value: () => 'test-gemini-key' },
  adminApiSharedSecret: { value: () => 'test-admin-secret' },
}));
jest.mock('./geminiBatchClient', () => ({ submitInlineBatch: jest.fn() }));

import { getFirestore } from 'firebase-admin/firestore';
import { submitInlineBatch } from './geminiBatchClient';
import {
  buildSeedTextPrompt,
  submitExpressionSeedTextBatch,
  adminSubmitExpressionSeedCampaignHandler,
} from './expressionSeedText';

const mockGetFirestore = getFirestore as jest.Mock;
const mockSubmitInlineBatch = submitInlineBatch as jest.Mock;

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('buildSeedTextPrompt', () => {
  it('언어명과 개수를 포함하고 meanings는 요청하지 않는다', () => {
    const prompt = buildSeedTextPrompt('English', 366, 'en');
    expect(prompt).toContain('366');
    expect(prompt).toContain('English');
    expect(prompt).toContain('break the ice');
    expect(prompt).not.toContain('"meanings"');
  });
});

describe('submitExpressionSeedTextBatch', () => {
  it('Gemini 배치를 제출하고 phase:text/campaignId(자기 참조)를 가진 job을 생성한다', async () => {
    mockSubmitInlineBatch.mockResolvedValueOnce({ name: 'batches/abc123' });
    const mockSet = jest.fn().mockResolvedValueOnce(undefined);
    const mockDoc = jest.fn(() => ({ id: 'job1', set: mockSet }));
    const mockCollection = jest.fn(() => ({ doc: mockDoc }));
    mockGetFirestore.mockReturnValue({ collection: mockCollection });

    const result = await submitExpressionSeedTextBatch('en', 366);

    expect(mockSubmitInlineBatch).toHaveBeenCalledWith(
      'gemini-2.5-flash',
      expect.stringContaining('expression-seed-text-en-'),
      expect.objectContaining({
        contents: expect.any(Array),
        generationConfig: expect.objectContaining({ maxOutputTokens: 65536 }),
        safetySettings: expect.any(Array),
      }),
      'test-gemini-key',
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en', count: 366, status: 'pending', phase: 'text',
        campaignId: 'job1', geminiBatchJobName: 'batches/abc123',
      }),
    );
    expect(result).toEqual({ jobId: 'job1', campaignId: 'job1' });
  });
});

describe('adminSubmitExpressionSeedCampaignHandler', () => {
  it('x-admin-api-key가 없으면 401을 반환한다', async () => {
    const req: any = { method: 'POST', get: () => undefined, body: { language: 'en', count: 366 } };
    const res = makeRes();
    await adminSubmitExpressionSeedCampaignHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('GET 요청이면 405를 반환한다', async () => {
    const req: any = { method: 'GET', get: () => 'test-admin-secret' };
    const res = makeRes();
    await adminSubmitExpressionSeedCampaignHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('count가 500을 넘으면 400을 반환한다', async () => {
    const req: any = { method: 'POST', get: () => 'test-admin-secret', body: { language: 'en', count: 501 } };
    const res = makeRes();
    await adminSubmitExpressionSeedCampaignHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('유효한 요청이면 캠페인을 제출하고 jobId/campaignId를 반환한다', async () => {
    mockSubmitInlineBatch.mockResolvedValueOnce({ name: 'batches/abc123' });
    const mockSet = jest.fn().mockResolvedValueOnce(undefined);
    const mockDoc = jest.fn(() => ({ id: 'job1', set: mockSet }));
    const mockCollection = jest.fn(() => ({ doc: mockDoc }));
    mockGetFirestore.mockReturnValue({ collection: mockCollection });

    const req: any = { method: 'POST', get: () => 'test-admin-secret', body: { language: 'en', count: 366 } };
    const res = makeRes();
    await adminSubmitExpressionSeedCampaignHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job1', campaignId: 'job1' });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd functions && npx jest src/expressionSeedText.test.ts`
Expected: FAIL with "Cannot find module './expressionSeedText'"

- [ ] **Step 3: 구현**

`functions/src/expressionSeedText.ts`:
```ts
import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { geminiApiKey, adminApiSharedSecret } from './secrets';
import { requireAdminSecret } from './adminSecret';
import { LANG_NAMES } from './langNames';
import { submitInlineBatch } from './geminiBatchClient';
import { buildCommonnessAnchorLine, CONTENT_SAFETY_INSTRUCTION, GEMINI_SAFETY_SETTINGS } from './promptQuality';

const GEMINI_MODEL = 'gemini-2.5-flash';

// 65536(maxOutputTokens) ÷ 약 55토큰/표현 ≈ 1190의 절반 이하로 잡은 안전마진.
const MAX_SEED_COUNT = 500;

export const EXPRESSION_TEXT_SCHEMA = {
  type: 'object',
  properties: {
    expressions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          register: { type: 'string', enum: ['casual', 'formal'] },
          similarExpressions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        },
        required: ['text', 'register'],
      },
    },
  },
  required: ['expressions'],
};

export function buildSeedTextPrompt(langName: string, count: number, langCode: string): string {
  const anchorLine = buildCommonnessAnchorLine(langName, langCode);
  return `You are a language-learning content curator. Produce exactly ${count} commonly used real-life expressions/idioms in ${langName} that an A2-B1 (CEFR) level learner should know (everyday phrases, idioms, phrasal expressions — NOT single dictionary words).

${anchorLine}

${CONTENT_SAFETY_INSTRUCTION}

For each expression, provide:
- "text": the expression in its canonical form, in ${langName}.
- "register": "casual" or "formal".
- "similarExpressions": up to 3 similar expressions in ${langName} (optional).

Do not repeat the same expression twice. Do not fabricate — only include real, commonly used expressions. Do NOT provide any meanings/translations here — that will be done separately.`;
}

export async function submitExpressionSeedTextBatch(
  language: string,
  count: number,
): Promise<{ jobId: string; campaignId: string }> {
  const langName = LANG_NAMES[language] ?? language;
  const prompt = buildSeedTextPrompt(langName, count, language);

  const { name } = await submitInlineBatch(
    GEMINI_MODEL,
    `expression-seed-text-${language}-${Date.now()}`,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXPRESSION_TEXT_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 65536,
      },
      safetySettings: GEMINI_SAFETY_SETTINGS,
    },
    geminiApiKey.value(),
  );

  const db = getFirestore();
  const jobRef = db.collection('expressionBatchJobs').doc();
  await jobRef.set({
    language,
    count,
    status: 'pending',
    geminiBatchJobName: name,
    requestedBy: 'manual',
    phase: 'text',
    campaignId: jobRef.id,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { jobId: jobRef.id, campaignId: jobRef.id };
}

export async function adminSubmitExpressionSeedCampaignHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다' });
    return;
  }
  if (!requireAdminSecret(req, res, adminApiSharedSecret.value())) return;

  const { language, count } = req.body ?? {};
  if (!language || !count || count < 1 || count > MAX_SEED_COUNT) {
    res.status(400).json({ error: `language와 count(1-${MAX_SEED_COUNT})가 필요합니다` });
    return;
  }

  try {
    const result = await submitExpressionSeedTextBatch(language, count);
    res.status(200).json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export const adminSubmitExpressionSeedCampaign = onRequest(
  { secrets: [geminiApiKey, adminApiSharedSecret], timeoutSeconds: 60 },
  adminSubmitExpressionSeedCampaignHandler,
);
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd functions && npx jest src/expressionSeedText.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/expressionSeedText.ts functions/src/expressionSeedText.test.ts
git commit -m "feat: add seed-text batch submission for expression pool campaigns"
```

---

### Task 5: 2단계 — 언어별 번역 배치

**Files:**
- Create: `functions/src/expressionTranslate.ts`
- Create: `functions/src/expressionTranslate.test.ts`

**Interfaces:**
- Consumes: `CONTENT_SAFETY_INSTRUCTION`/`GEMINI_SAFETY_SETTINGS` (Task 2), `submitInlineBatch` (기존)
- Produces: `EXPRESSION_TRANSLATE_SCHEMA`, `buildTranslatePrompt(langName, texts, meaningLangName): string`, `submitExpressionTranslateBatch(campaignId, language, texts, meaningLanguage): Promise<{jobId: string}>`

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/expressionTranslate.test.ts`:
```ts
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
}));
jest.mock('./secrets', () => ({ geminiApiKey: { value: () => 'test-gemini-key' } }));
jest.mock('./geminiBatchClient', () => ({ submitInlineBatch: jest.fn() }));

import { getFirestore } from 'firebase-admin/firestore';
import { submitInlineBatch } from './geminiBatchClient';
import { buildTranslatePrompt, submitExpressionTranslateBatch } from './expressionTranslate';

const mockGetFirestore = getFirestore as jest.Mock;
const mockSubmitInlineBatch = submitInlineBatch as jest.Mock;

describe('buildTranslatePrompt', () => {
  it('표현 목록과 뜻 언어를 프롬프트에 포함하고, 원문을 그대로 echo하라고 지시한다', () => {
    const prompt = buildTranslatePrompt('English', ['break the ice', 'piece of cake'], 'Korean');
    expect(prompt).toContain('break the ice');
    expect(prompt).toContain('piece of cake');
    expect(prompt).toContain('Korean');
    expect(prompt).toContain('echo back the "text" field EXACTLY');
  });
});

describe('submitExpressionTranslateBatch', () => {
  it('Gemini 배치를 제출하고 phase:translate/meaningLanguage/전달받은 campaignId를 가진 job을 생성한다', async () => {
    mockSubmitInlineBatch.mockResolvedValueOnce({ name: 'batches/xyz789' });
    const mockSet = jest.fn().mockResolvedValueOnce(undefined);
    const mockDoc = jest.fn(() => ({ id: 'job2', set: mockSet }));
    const mockCollection = jest.fn(() => ({ doc: mockDoc }));
    mockGetFirestore.mockReturnValue({ collection: mockCollection });

    const result = await submitExpressionTranslateBatch('campaign1', 'en', ['break the ice'], 'ko');

    expect(mockSubmitInlineBatch).toHaveBeenCalledWith(
      'gemini-2.5-flash',
      expect.stringContaining('expression-translate-en-ko-'),
      expect.objectContaining({
        contents: expect.any(Array),
        generationConfig: expect.objectContaining({ maxOutputTokens: 65536 }),
        safetySettings: expect.any(Array),
      }),
      'test-gemini-key',
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en', count: 1, status: 'pending', phase: 'translate',
        meaningLanguage: 'ko', campaignId: 'campaign1', geminiBatchJobName: 'batches/xyz789',
      }),
    );
    expect(result).toEqual({ jobId: 'job2' });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd functions && npx jest src/expressionTranslate.test.ts`
Expected: FAIL with "Cannot find module './expressionTranslate'"

- [ ] **Step 3: 구현**

`functions/src/expressionTranslate.ts`:
```ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { geminiApiKey } from './secrets';
import { LANG_NAMES } from './langNames';
import { submitInlineBatch } from './geminiBatchClient';
import { CONTENT_SAFETY_INSTRUCTION, GEMINI_SAFETY_SETTINGS } from './promptQuality';

const GEMINI_MODEL = 'gemini-2.5-flash';

export const EXPRESSION_TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          definition: { type: 'string' },
          example: {
            type: 'object',
            properties: { sentence: { type: 'string' }, translation: { type: 'string' } },
            required: ['sentence', 'translation'],
          },
        },
        required: ['text', 'definition', 'example'],
      },
    },
  },
  required: ['translations'],
};

export function buildTranslatePrompt(langName: string, texts: string[], meaningLangName: string): string {
  const list = texts.map((t) => `- "${t}"`).join('\n');
  return `The following is a fixed list of already-confirmed ${langName} expressions/idioms:
${list}

For EACH expression above, provide, in ${meaningLangName}:
- "definition": a short explanation of the expression's meaning, written in ${meaningLangName}.
- "example": a natural example sentence using the expression, written in ${langName} ("sentence"), with its ${meaningLangName} translation ("translation").

In your response, echo back the "text" field EXACTLY as given above (character-for-character) so each translation can be matched to its expression — do not paraphrase or alter it.

${CONTENT_SAFETY_INSTRUCTION}

Provide exactly one entry per expression listed above, in any order.`;
}

export async function submitExpressionTranslateBatch(
  campaignId: string,
  language: string,
  texts: string[],
  meaningLanguage: string,
): Promise<{ jobId: string }> {
  const langName = LANG_NAMES[language] ?? language;
  const meaningLangName = LANG_NAMES[meaningLanguage] ?? meaningLanguage;
  const prompt = buildTranslatePrompt(langName, texts, meaningLangName);

  const { name } = await submitInlineBatch(
    GEMINI_MODEL,
    `expression-translate-${language}-${meaningLanguage}-${Date.now()}`,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXPRESSION_TRANSLATE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 65536,
      },
      safetySettings: GEMINI_SAFETY_SETTINGS,
    },
    geminiApiKey.value(),
  );

  const db = getFirestore();
  const jobRef = db.collection('expressionBatchJobs').doc();
  await jobRef.set({
    language,
    count: texts.length,
    status: 'pending',
    geminiBatchJobName: name,
    requestedBy: 'manual',
    phase: 'translate',
    meaningLanguage,
    campaignId,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { jobId: jobRef.id };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd functions && npx jest src/expressionTranslate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/expressionTranslate.ts functions/src/expressionTranslate.test.ts
git commit -m "feat: add per-language translation batch submission"
```

---

### Task 6: poller에 phase 분기 + 1→2단계 자동 체이닝 추가

**Files:**
- Modify: `functions/src/expressionBatchPoller.ts`
- Modify: `functions/src/expressionBatchPoller.test.ts`

**Interfaces:**
- Consumes: `MEANING_LANGUAGE_CODES` (Task 2, `expressionPool.ts`에서 export), `submitExpressionTranslateBatch` (Task 5)

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/expressionBatchPoller.test.ts` 상단 mock 블록에 추가:
```ts
jest.mock('./expressionTranslate', () => ({ submitExpressionTranslateBatch: jest.fn() }));
```
그리고 import 블록에 추가:
```ts
import { submitExpressionTranslateBatch } from './expressionTranslate';

const mockSubmitTranslateBatch = submitExpressionTranslateBatch as jest.Mock;
```
파일 끝(마지막 `});` 앞, `describe('pollExpressionBatchJobsHandler', ...)` 안)에 아래 테스트들을 추가:
```ts
  it('phase:text SUCCEEDED면 meanings:{} 상태로 저장하고 14개 언어 번역 job을 자동 제출한다', async () => {
    mockSubmitTranslateBatch.mockClear();
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc(
      'job1',
      { language: 'en', geminiBatchJobName: 'batches/abc', phase: 'text', campaignId: 'campaign1' },
      mockUpdate,
    );
    const { mockWriteBatchSet, mockItemsDoc } = mockFirestoreWithJobs([jobDoc]);

    mockGetBatch.mockResolvedValueOnce(
      succeededBatchWithText(JSON.stringify({
        expressions: [{ text: 'break the ice', register: 'casual', similarExpressions: [] }],
      })),
    );

    await pollExpressionBatchJobsHandler();

    expect(mockItemsDoc).toHaveBeenCalledWith('break-the-ice');
    expect(mockWriteBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'break the ice', meanings: {} }),
      { merge: true },
    );
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
    expect(mockSubmitTranslateBatch).toHaveBeenCalledTimes(14);
    expect(mockSubmitTranslateBatch).toHaveBeenCalledWith('campaign1', 'en', ['break the ice'], 'ko');
  });

  it('phase:text 파싱 실패면 job만 failed되고 번역 job은 제출하지 않는다', async () => {
    mockSubmitTranslateBatch.mockClear();
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc(
      'job1',
      { language: 'en', geminiBatchJobName: 'batches/abc', phase: 'text', campaignId: 'campaign1' },
      mockUpdate,
    );
    mockFirestoreWithJobs([jobDoc]);

    mockGetBatch.mockResolvedValueOnce(succeededBatchWithText('not json'));

    await pollExpressionBatchJobsHandler();

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(mockSubmitTranslateBatch).not.toHaveBeenCalled();
  });

  it('phase:translate SUCCEEDED면 해당 언어의 meanings 필드만 병합 업데이트한다', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc(
      'job2',
      { language: 'en', geminiBatchJobName: 'batches/xyz', phase: 'translate', meaningLanguage: 'ko', campaignId: 'campaign1' },
      mockUpdate,
    );
    const { mockWriteBatchSet, mockWriteBatchCommit, mockItemsDoc } = mockFirestoreWithJobs([jobDoc]);
    const mockDocUpdate = jest.fn();
    mockItemsDoc.mockReturnValue({ update: mockDocUpdate });

    mockGetBatch.mockResolvedValueOnce(
      succeededBatchWithText(JSON.stringify({
        translations: [{
          text: 'break the ice',
          definition: '어색한 분위기를 풀다',
          example: { sentence: 'He told a joke to break the ice.', translation: '그는 어색한 분위기를 풀려고 농담을 했다.' },
        }],
      })),
    );

    await pollExpressionBatchJobsHandler();

    expect(mockItemsDoc).toHaveBeenCalledWith('break-the-ice');
    expect(mockDocUpdate).toHaveBeenCalledWith({
      'meanings.ko': {
        definition: '어색한 분위기를 풀다',
        example: { sentence: 'He told a joke to break the ice.', translation: '그는 어색한 분위기를 풀려고 농담을 했다.' },
      },
    });
    expect(mockWriteBatchSet).not.toHaveBeenCalled();
    expect(mockWriteBatchCommit).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  });
```

`mockFirestoreWithJobs` 함수 전체(Task 3에서 `mockItemsDoc`을 반환하도록 이미 고친 상태)를 아래로 통째로 교체한다 — `finalizeTranslateJob`도 다른 두 finalize 함수와 동일하게 `db.batch()`를 통해 원자적으로 쓰기 때문에, batch mock에 `update`도 추가하고 그 스파이(`mockWriteBatchUpdate`)를 테스트에서 쓸 수 있도록 반환값에 포함시킨다:
```ts
function mockFirestoreWithJobs(jobDocs: ReturnType<typeof makeJobDoc>[]) {
  const mockJobsGet = jest.fn().mockResolvedValue({ docs: jobDocs });
  const mockLimit = jest.fn(() => ({ get: mockJobsGet }));
  const mockWhere = jest.fn(() => ({ get: mockJobsGet, limit: mockLimit }));
  const mockWriteBatchSet = jest.fn();
  const mockWriteBatchUpdate = jest.fn();
  const mockWriteBatchCommit = jest.fn().mockResolvedValue(undefined);
  const mockItemsDoc = jest.fn(() => ({ doc: jest.fn() }));
  const mockItemsCollection = jest.fn(() => ({ doc: mockItemsDoc }));

  mockGetFirestore.mockReturnValue({
    collection: jest.fn((name: string) => {
      if (name === 'expressionBatchJobs') return { where: mockWhere };
      if (name === 'expressions') return { doc: jest.fn(() => ({ collection: mockItemsCollection })) };
      throw new Error(`unexpected collection: ${name}`);
    }),
    batch: jest.fn(() => ({ set: mockWriteBatchSet, update: mockWriteBatchUpdate, commit: mockWriteBatchCommit })),
  });

  return { mockWriteBatchSet, mockWriteBatchUpdate, mockWriteBatchCommit, mockItemsDoc };
}
```
기존에 `mockWriteBatchSet, mockWriteBatchCommit`(또는 Task 3에서 추가한 `mockItemsDoc`까지)만 구조분해하던 기존 테스트들은 그대로 둔다 — 새 반환 필드(`mockWriteBatchUpdate`)를 안 쓰는 테스트는 구조분해에 추가하지 않아도 무방하다.

방금 Step 1에서 추가한 `phase:translate` 테스트의 코드도 위 변경(개별 `itemsRef.doc(id).update(...)` 대신 `writeBatch.update(...)` 사용)에 맞춰 아래로 교체한다:
```ts
  it('phase:translate SUCCEEDED면 해당 언어의 meanings 필드만 병합 업데이트한다', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc(
      'job2',
      { language: 'en', geminiBatchJobName: 'batches/xyz', phase: 'translate', meaningLanguage: 'ko', campaignId: 'campaign1' },
      mockUpdate,
    );
    const { mockWriteBatchSet, mockWriteBatchUpdate, mockWriteBatchCommit, mockItemsDoc } = mockFirestoreWithJobs([jobDoc]);

    mockGetBatch.mockResolvedValueOnce(
      succeededBatchWithText(JSON.stringify({
        translations: [{
          text: 'break the ice',
          definition: '어색한 분위기를 풀다',
          example: { sentence: 'He told a joke to break the ice.', translation: '그는 어색한 분위기를 풀려고 농담을 했다.' },
        }],
      })),
    );

    await pollExpressionBatchJobsHandler();

    expect(mockItemsDoc).toHaveBeenCalledWith('break-the-ice');
    expect(mockWriteBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      {
        'meanings.ko': {
          definition: '어색한 분위기를 풀다',
          example: { sentence: 'He told a joke to break the ice.', translation: '그는 어색한 분위기를 풀려고 농담을 했다.' },
        },
      },
    );
    expect(mockWriteBatchSet).not.toHaveBeenCalled();
    expect(mockWriteBatchCommit).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  });
```
(이 코드가 Step 1에서 이미 작성한 동일 이름의 테스트를 대체한다 — 최종적으로 파일에는 이 버전 하나만 남아야 한다.)

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd functions && npx jest src/expressionBatchPoller.test.ts`
Expected: FAIL — `Cannot find module './expressionTranslate'`(mock 대상 파일이 아직 없거나 무관하게 실제 poller 코드가 phase를 처리 안 해서 관련 단언들이 실패)

- [ ] **Step 3: 구현**

`functions/src/expressionBatchPoller.ts` 전체를 아래로 교체:
```ts
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { geminiApiKey } from './secrets';
import { getBatch } from './geminiBatchClient';
import { normalizeExpressionId } from './expressionDedup';
import { MEANING_LANGUAGE_CODES } from './expressionPool';
import { submitExpressionTranslateBatch } from './expressionTranslate';

const TERMINAL_FAILURE_STATES = ['BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED'];

async function finalizeLegacyJob(db: FirebaseFirestore.Firestore, job: any, jobDoc: FirebaseFirestore.QueryDocumentSnapshot, text: string): Promise<void> {
  const parsed = JSON.parse(text) as { expressions: any[] };
  if (!Array.isArray(parsed.expressions)) throw new Error('MISSING_EXPRESSIONS_ARRAY');

  const writeBatch = db.batch();
  const itemsRef = db.collection('expressions').doc(job.language).collection('items');
  for (const expr of parsed.expressions) {
    writeBatch.set(itemsRef.doc(normalizeExpressionId(expr.text)), {
      text: expr.text,
      register: expr.register,
      meanings: expr.meanings,
      similarExpressions: Array.isArray(expr.similarExpressions) ? expr.similarExpressions : [],
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await writeBatch.commit();
  await jobDoc.ref.update({ status: 'succeeded', completedAt: FieldValue.serverTimestamp() });
}

async function finalizeSeedTextJob(db: FirebaseFirestore.Firestore, job: any, jobDoc: FirebaseFirestore.QueryDocumentSnapshot, text: string): Promise<void> {
  const parsed = JSON.parse(text) as { expressions: any[] };
  if (!Array.isArray(parsed.expressions)) throw new Error('MISSING_EXPRESSIONS_ARRAY');

  const writeBatch = db.batch();
  const itemsRef = db.collection('expressions').doc(job.language).collection('items');
  const texts: string[] = [];
  for (const expr of parsed.expressions) {
    writeBatch.set(itemsRef.doc(normalizeExpressionId(expr.text)), {
      text: expr.text,
      register: expr.register,
      meanings: {},
      similarExpressions: Array.isArray(expr.similarExpressions) ? expr.similarExpressions : [],
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    texts.push(expr.text);
  }
  await writeBatch.commit();
  await jobDoc.ref.update({ status: 'succeeded', completedAt: FieldValue.serverTimestamp() });

  // 1단계 완료 직후, 같은 poller 실행 안에서 14개 언어 번역 job을 자동으로 이어서 제출한다.
  // 언어 하나 제출이 실패해도 나머지 13개는 계속 진행한다(job 단위 격리).
  for (const meaningLanguage of MEANING_LANGUAGE_CODES) {
    try {
      await submitExpressionTranslateBatch(job.campaignId, job.language, texts, meaningLanguage);
    } catch (e) {
      console.error(`pollExpressionBatchJobs: failed to submit translate batch for ${meaningLanguage}`, e);
    }
  }
}

async function finalizeTranslateJob(db: FirebaseFirestore.Firestore, job: any, jobDoc: FirebaseFirestore.QueryDocumentSnapshot, text: string): Promise<void> {
  const parsed = JSON.parse(text) as { translations: any[] };
  if (!Array.isArray(parsed.translations)) throw new Error('MISSING_TRANSLATIONS_ARRAY');

  const itemsRef = db.collection('expressions').doc(job.language).collection('items');
  const writeBatch = db.batch();
  for (const t of parsed.translations) {
    const docId = normalizeExpressionId(t.text);
    writeBatch.update(itemsRef.doc(docId), {
      [`meanings.${job.meaningLanguage}`]: { definition: t.definition, example: t.example },
    });
  }
  await writeBatch.commit();
  await jobDoc.ref.update({ status: 'succeeded', completedAt: FieldValue.serverTimestamp() });
}

export async function pollExpressionBatchJobsHandler(): Promise<void> {
  const db = getFirestore();
  const jobsSnap = await db.collection('expressionBatchJobs').where('status', 'in', ['pending', 'running']).get();

  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();
    try {
      const batch = await getBatch(job.geminiBatchJobName, geminiApiKey.value());

      if (batch.state === 'BATCH_STATE_SUCCEEDED') {
        try {
          const inlined = batch.output?.inlinedResponses?.inlinedResponses ?? [];
          const text = inlined[0]?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (!text) throw new Error('EMPTY_BATCH_RESPONSE');

          if (job.phase === 'text') {
            await finalizeSeedTextJob(db, job, jobDoc, text);
          } else if (job.phase === 'translate') {
            await finalizeTranslateJob(db, job, jobDoc, text);
          } else {
            await finalizeLegacyJob(db, job, jobDoc, text);
          }
        } catch (parseError) {
          console.error(`pollExpressionBatchJobs: failed to parse/write job ${jobDoc.id}`, parseError);
          await jobDoc.ref.update({
            status: 'failed',
            error: parseError instanceof Error ? parseError.message : String(parseError),
            completedAt: FieldValue.serverTimestamp(),
          });
        }
      } else if (TERMINAL_FAILURE_STATES.includes(batch.state)) {
        await jobDoc.ref.update({ status: 'failed', error: batch.state, completedAt: FieldValue.serverTimestamp() });
      } else {
        await jobDoc.ref.update({ status: 'running' });
      }
    } catch (e) {
      console.error(`pollExpressionBatchJobs: failed to poll job ${jobDoc.id}`, e);
      continue;
    }
  }
}

export const pollExpressionBatchJobs = onSchedule(
  { schedule: '*/30 * * * *', timeZone: 'UTC', timeoutSeconds: 300, memory: '256MiB', secrets: [geminiApiKey] },
  async () => {
    await pollExpressionBatchJobsHandler();
  },
);
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd functions && npx jest src/expressionBatchPoller.test.ts`
Expected: PASS (전체 스위트, phase별 신규 테스트 포함)

- [ ] **Step 5: 전체 테스트 + 빌드 확인**

Run: `cd functions && npm test && npm run build`
Expected: 전체 스위트 PASS, 빌드 클린

- [ ] **Step 6: 커밋**

```bash
git add functions/src/expressionBatchPoller.ts functions/src/expressionBatchPoller.test.ts
git commit -m "feat: chain seed-text -> per-language translate batches in poller"
```

---

### Task 7: `index.ts`에 신규 함수 export 추가

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `adminSubmitExpressionSeedCampaign` (Task 4)

- [ ] **Step 1: export 추가**

`functions/src/index.ts`의 아래 줄:
```ts
export { adminSubmitExpressionBatch } from './expressionPool';
```
바로 다음 줄에 추가:
```ts
export { adminSubmitExpressionSeedCampaign } from './expressionSeedText';
```

- [ ] **Step 2: 전체 테스트 + 빌드 확인**

Run: `cd functions && npm test && npm run build`
Expected: 전체 스위트 PASS(테스트 개수는 Task 1-6 누적), 빌드 클린

- [ ] **Step 3: 커밋**

```bash
git add functions/src/index.ts
git commit -m "feat: export adminSubmitExpressionSeedCampaign"
```

---

## Part B — word-bank-web (관리자 대시보드)

### Task 8: HTTP 래퍼 — 시딩 캠페인 제출

**Files:**
- Modify: `lib/admin-functions/expressionPool.ts`
- Modify: `lib/admin-functions/expressionPool.test.ts`

**Interfaces:**
- Produces: `submitExpressionSeedCampaign(language: string, count: number): Promise<{jobId: string; campaignId: string}>`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/admin-functions/expressionPool.test.ts`의 기존 `describe('submitExpressionBatch', ...)` 블록 뒤에 추가:
```ts
describe('submitExpressionSeedCampaign', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL = 'https://us-central1-wordbank-6284f.cloudfunctions.net';
    process.env.ADMIN_API_SHARED_SECRET = 'test-secret';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('jobId/campaignId를 응답으로 받으면 그대로 반환한다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job1', campaignId: 'job1' }),
    });

    const { submitExpressionSeedCampaign } = await import('./expressionPool');
    const result = await submitExpressionSeedCampaign('en', 366);

    expect(result).toEqual({ jobId: 'job1', campaignId: 'job1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://us-central1-wordbank-6284f.cloudfunctions.net/adminSubmitExpressionSeedCampaign',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-admin-api-key': 'test-secret' }),
        body: JSON.stringify({ language: 'en', count: 366 }),
      }),
    );
  });

  it('응답이 실패하면 에러 메시지를 던진다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'language와 count(1-500)가 필요합니다' }),
    });

    const { submitExpressionSeedCampaign } = await import('./expressionPool');

    await expect(submitExpressionSeedCampaign('en', 0)).rejects.toThrow('language와 count(1-500)가 필요합니다');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test -- lib/admin-functions/expressionPool.test.ts`
Expected: FAIL — `submitExpressionSeedCampaign` export가 없음

- [ ] **Step 3: 구현**

`lib/admin-functions/expressionPool.ts` 끝에 추가:
```ts
export async function submitExpressionSeedCampaign(
  language: string,
  count: number,
): Promise<{ jobId: string; campaignId: string }> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminSubmitExpressionSeedCampaign`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ language, count }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `시딩 캠페인 요청 실패 (${response.status})`);
  }
  return response.json();
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm run test -- lib/admin-functions/expressionPool.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/admin-functions/expressionPool.ts lib/admin-functions/expressionPool.test.ts
git commit -m "feat: add HTTP wrapper for expression seed-campaign submission"
```

---

### Task 9: Server Action — 시딩 캠페인 제출

**Files:**
- Modify: `lib/actions/expressionActions.ts`
- Modify: `lib/actions/expressionActions.test.ts`

**Interfaces:**
- Consumes: `submitExpressionSeedCampaign` (Task 8)
- Produces: `submitExpressionSeedCampaignAction(language, count): Promise<{jobId?: string; campaignId?: string; error?: string}>`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/actions/expressionActions.test.ts`의 `import * as expressionPoolModule from '@/lib/admin-functions/expressionPool';` 아래 줄에 추가:
```ts
const mockSubmitExpressionSeedCampaign = vi.mocked(expressionPoolModule.submitExpressionSeedCampaign);
```
그리고 `import { ... } from './expressionActions';` 블록에 `submitExpressionSeedCampaignAction`을 추가한 뒤, 파일 끝(`describe('fetchExpressionBatchJobsAction', ...)` 뒤)에 아래 블록 추가:
```ts
describe('submitExpressionSeedCampaignAction', () => {
  it('성공하면 jobId/campaignId를 반환하고 페이지를 재검증한다', async () => {
    mockSubmitExpressionSeedCampaign.mockResolvedValueOnce({ jobId: 'job1', campaignId: 'job1' });

    const result = await submitExpressionSeedCampaignAction('en', 366);

    expect(mockSubmitExpressionSeedCampaign).toHaveBeenCalledWith('en', 366);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({ jobId: 'job1', campaignId: 'job1' });
  });

  it('실패하면 에러 메시지를 반환한다', async () => {
    mockSubmitExpressionSeedCampaign.mockRejectedValueOnce(new Error('시딩 캠페인 요청 실패'));

    const result = await submitExpressionSeedCampaignAction('en', 366);

    expect(result).toEqual({ error: '시딩 캠페인 요청 실패' });
  });

  it('관리자 세션이 없으면 에러를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await submitExpressionSeedCampaignAction('en', 366);

    expect(result).toEqual({ error: '관리자 로그인이 필요합니다' });
    expect(mockSubmitExpressionSeedCampaign).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test -- lib/actions/expressionActions.test.ts`
Expected: FAIL — `submitExpressionSeedCampaignAction` export가 없음

- [ ] **Step 3: 구현**

`lib/actions/expressionActions.ts` 상단 import:
```ts
import { submitExpressionBatch } from "@/lib/admin-functions/expressionPool";
```
을 아래로 교체:
```ts
import { submitExpressionBatch, submitExpressionSeedCampaign } from "@/lib/admin-functions/expressionPool";
```

파일 끝(`fetchExpressionBatchJobsAction` 뒤)에 추가:
```ts
export async function submitExpressionSeedCampaignAction(
  language: string,
  count: number,
): Promise<{ jobId?: string; campaignId?: string; error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    const result = await submitExpressionSeedCampaign(language, count);
    revalidatePath("/admin/expressions");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "시딩 캠페인 요청 실패" };
  }
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm run test -- lib/actions/expressionActions.test.ts`
Expected: PASS (전체 스위트, 신규 3개 포함)

- [ ] **Step 5: 커밋**

```bash
git add lib/actions/expressionActions.ts lib/actions/expressionActions.test.ts
git commit -m "feat: add server action for expression seed-campaign submission"
```

---

### Task 10: `ExpressionBatchJob` 타입에 phase/campaignId 필드 추가

**Files:**
- Modify: `lib/data/expressions.ts`
- Modify: `lib/data/expressions.test.ts`

**Interfaces:**
- Produces (타입 변경): `ExpressionBatchJob`에 `phase: "text" | "translate" | null`, `meaningLanguage: string | null`, `campaignId: string | null` 필드 추가

- [ ] **Step 1: 실패하는 테스트 수정**

`lib/data/expressions.test.ts`의 `listExpressionBatchJobs` 테스트 안 `expect(result).toEqual([...])` 블록:
```ts
    expect(result).toEqual([{
      id: 'job1', language: 'en', count: 10, status: 'succeeded', requestedBy: 'manual',
      createdAt: '2026-08-05T00:00:00.000Z', completedAt: '2026-08-05T01:00:00.000Z', error: null,
    }]);
```
을 아래로 교체:
```ts
    expect(result).toEqual([{
      id: 'job1', language: 'en', count: 10, status: 'succeeded', requestedBy: 'manual',
      phase: null, meaningLanguage: null, campaignId: null,
      createdAt: '2026-08-05T00:00:00.000Z', completedAt: '2026-08-05T01:00:00.000Z', error: null,
    }]);
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test -- lib/data/expressions.test.ts`
Expected: FAIL — 실제 반환값에 `phase`/`meaningLanguage`/`campaignId` 필드가 없어 객체 불일치

- [ ] **Step 3: 구현**

`lib/data/expressions.ts`의 `ExpressionBatchJob` 타입:
```ts
export type ExpressionBatchJob = {
  id: string;
  language: string;
  count: number;
  status: "pending" | "running" | "succeeded" | "failed";
  requestedBy: "auto" | "manual";
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};
```
을 아래로 교체:
```ts
export type ExpressionBatchJob = {
  id: string;
  language: string;
  count: number;
  status: "pending" | "running" | "succeeded" | "failed";
  requestedBy: "auto" | "manual";
  phase: "text" | "translate" | null;
  meaningLanguage: string | null;
  campaignId: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};
```

`listExpressionBatchJobs`의 매핑:
```ts
    return {
      id: doc.id,
      language: data.language,
      count: data.count,
      status: data.status,
      requestedBy: data.requestedBy,
      createdAt: data.createdAt.toDate().toISOString(),
      completedAt: data.completedAt ? data.completedAt.toDate().toISOString() : null,
      error: data.error ?? null,
    };
```
을 아래로 교체:
```ts
    return {
      id: doc.id,
      language: data.language,
      count: data.count,
      status: data.status,
      requestedBy: data.requestedBy,
      phase: data.phase ?? null,
      meaningLanguage: data.meaningLanguage ?? null,
      campaignId: data.campaignId ?? null,
      createdAt: data.createdAt.toDate().toISOString(),
      completedAt: data.completedAt ? data.completedAt.toDate().toISOString() : null,
      error: data.error ?? null,
    };
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm run test -- lib/data/expressions.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/data/expressions.ts lib/data/expressions.test.ts
git commit -m "feat: add phase/campaignId fields to ExpressionBatchJob"
```

---

### Task 11: 작업 현황 테이블에 구분/번역 언어 컬럼 추가

**Files:**
- Modify: `components/admin/ExpressionBatchJobsTable.tsx`

**Interfaces:**
- Consumes: `ExpressionBatchJob`(Task 10의 확장된 타입), `LANG_NAMES`(`lib/constants/languages.ts`)

이 컴포넌트에는 자동 테스트가 없다(선행 스펙과 동일 — 렌더링 테스트 인프라 없음). 타입체크로만 검증한다.

- [ ] **Step 1: 구현**

`components/admin/ExpressionBatchJobsTable.tsx` 전체를 아래로 교체:
```tsx
import type { ExpressionBatchJob } from "@/lib/data/expressions";
import { LANG_NAMES } from "@/lib/constants/languages";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<ExpressionBatchJob["status"], string> = {
  pending: "대기중",
  running: "진행중",
  succeeded: "완료",
  failed: "실패",
};

const STATUS_VARIANT: Record<ExpressionBatchJob["status"], "secondary" | "warning" | "success" | "destructive"> = {
  pending: "secondary",
  running: "warning",
  succeeded: "success",
  failed: "destructive",
};

const PHASE_LABEL: Record<"text" | "translate", string> = {
  text: "텍스트 생성",
  translate: "번역",
};

export function ExpressionBatchJobsTable({ jobs }: { jobs: ExpressionBatchJob[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>상태</TableHead>
          <TableHead>언어</TableHead>
          <TableHead>개수</TableHead>
          <TableHead>요청</TableHead>
          <TableHead>구분</TableHead>
          <TableHead>번역 언어</TableHead>
          <TableHead>생성 시각</TableHead>
          <TableHead>완료 시각</TableHead>
          <TableHead>비고</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
            </TableCell>
            <TableCell>{job.language}</TableCell>
            <TableCell>{job.count}개</TableCell>
            <TableCell>{job.requestedBy === "auto" ? "자동" : "수동"}</TableCell>
            <TableCell>{job.phase ? PHASE_LABEL[job.phase] : "-"}</TableCell>
            <TableCell>{job.meaningLanguage ? (LANG_NAMES[job.meaningLanguage] ?? job.meaningLanguage) : "-"}</TableCell>
            <TableCell className="text-muted-foreground">{new Date(job.createdAt).toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-muted-foreground">
              {job.completedAt ? new Date(job.completedAt).toLocaleString("ko-KR") : "-"}
            </TableCell>
            <TableCell className={job.error ? "max-w-xs truncate text-destructive" : "max-w-xs truncate"}>
              {job.error ?? "-"}
            </TableCell>
          </TableRow>
        ))}
        {jobs.length === 0 && <EmptyTableRow colSpan={9} message="생성 작업 이력이 없습니다." />}
      </TableBody>
    </Table>
  );
}
```

`비고` 컬럼의 `text-destructive` 조건부 적용은 선행 스펙에서 남겨둔 Minor 항목(에러가 없을 때도 빨간색으로 보이던 것)을 함께 고친 것이다 — 이 파일을 다시 여는 김에 반영한다.

- [ ] **Step 2: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 이 파일 관련 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add components/admin/ExpressionBatchJobsTable.tsx
git commit -m "feat: show phase/meaning-language columns in batch jobs table"
```

---

### Task 12: 관리자 화면에 "초기 시딩 캠페인" 섹션 추가

**Files:**
- Modify: `components/admin/ExpressionPoolManager.tsx`

**Interfaces:**
- Consumes: `submitExpressionSeedCampaignAction` (Task 9)

이 컴포넌트에도 자동 테스트가 없다. 타입체크 + `npm run dev`로 수동 확인한다.

- [ ] **Step 1: import 및 상태 추가**

`components/admin/ExpressionPoolManager.tsx` 상단 import 블록:
```ts
import {
  fetchMoreExpressionsAction,
  fetchExpressionBatchJobsAction,
  updateExpressionPoolConfigAction,
  submitExpressionBatchAction,
} from "@/lib/actions/expressionActions";
```
을 아래로 교체:
```ts
import {
  fetchMoreExpressionsAction,
  fetchExpressionBatchJobsAction,
  updateExpressionPoolConfigAction,
  submitExpressionBatchAction,
  submitExpressionSeedCampaignAction,
} from "@/lib/actions/expressionActions";
```

`overrideCount` state 선언 바로 다음 줄에 추가:
```ts
  const [seedCount, setSeedCount] = useState("100");
```

- [ ] **Step 2: 핸들러 추가**

`handleSubmitOverride` 함수 정의 바로 다음에 추가:
```ts
  function handleSubmitSeedCampaign() {
    const count = Number(seedCount);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await submitExpressionSeedCampaignAction(language, count);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(
        `시딩 캠페인을 시작했습니다 (campaignId: ${result.campaignId}). 텍스트 생성이 끝나면 14개 언어 번역이 자동으로 이어집니다.`,
      );

      const jobsResult = await fetchExpressionBatchJobsAction(language);
      if ("error" in jobsResult) {
        return;
      }
      setJobs(jobsResult);
    });
  }
```

- [ ] **Step 3: "지금 바로 생성" 입력의 stale한 max 값 수정**

기존:
```tsx
        <label className="flex flex-col gap-1 text-sm">
          지금 바로 생성
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={50}
              value={overrideCount}
```
을 아래로 교체(`max={50}` → `max={20}` — 서버 쪽 상한이 이미 20으로 낮아져 있었는데 이 입력의 `max`만 예전 값 그대로 남아있던 것을 함께 고친다):
```tsx
        <label className="flex flex-col gap-1 text-sm">
          지금 바로 생성
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={20}
              value={overrideCount}
```

- [ ] **Step 4: 새 섹션 JSX 추가**

`</Card>`로 끝나는 표현 목록 Card 블록:
```tsx
      <Card>
        <CardContent>
          <ExpressionsTable language={language} initialPage={expressionsPage} />
        </CardContent>
      </Card>
```
바로 다음에 새 섹션 추가:
```tsx
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">초기 시딩 캠페인</h2>
        <p className="text-sm text-muted-foreground">
          큰 목표치를 며칠 안에 채웁니다 — 표현 텍스트를 먼저 생성하고, 14개 언어 번역이 자동으로 이어집니다.
        </p>
        <Card>
          <CardContent>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                목표 개수
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={seedCount}
                  onChange={(e) => setSeedCount(e.target.value)}
                  className="w-24 rounded-md border border-input bg-background px-3 py-1.5"
                />
              </label>
              <Button type="button" size="sm" disabled={isPending} onClick={handleSubmitSeedCampaign}>
                시딩 시작
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
```

- [ ] **Step 5: 타입체크 + 빌드 확인**

Run: `npx tsc --noEmit && npm run build`
Expected: 타입 에러 없음, 빌드 성공

- [ ] **Step 6: 개발 서버로 수동 확인**

Run: `npm run dev`

`/admin/expressions`에서: "초기 시딩 캠페인" 섹션이 보이는지, 목표 개수 입력 후 "시딩 시작" 클릭 시 에러 없이 동작하는지(실제 Gemini 호출은 스테이징에서 별도 검증), "지금 바로 생성" 입력의 최대값이 20으로 제한되는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add components/admin/ExpressionPoolManager.tsx
git commit -m "feat: add seed-campaign section to expression pool admin screen"
```

---

### Task 13: 전체 검증

**Files:** 없음(검증만)

- [ ] **Step 1: word-bank 전체 검증**

Run:
```bash
cd functions && npm test && npm run build
```
Expected: 둘 다 성공(전체 테스트 개수는 Task 1-7 누적)

- [ ] **Step 2: word-bank-web 전체 검증**

Run:
```bash
npm run lint
npm run test
npm run build
```
Expected: 셋 다 성공

- [ ] **Step 3: 수동 검증 체크리스트 (스테이징/실제 배포 환경, 실제 Gemini API 키 필요)**

- [ ] 영어(`en`)로 작은 개수(예: 5개)로 시딩 캠페인을 실행 — 1단계 job이 `succeeded`로 바뀌고 `expressions/en/items`에 `meanings: {}` 상태의 문서 5개가 생기는지 확인
- [ ] 같은 poller 사이클 안에서 14개의 `phase:'translate'` job이 자동으로 `expressionBatchJobs`에 생기는지 확인
- [ ] 그 14개가 각각 완료되면서 각 표현 문서의 `meanings.{언어}` 필드가 채워지는지, 그리고 **2단계 프롬프트가 반환한 `text`가 실제로 1단계가 생성한 원문과 정확히 일치해서 정규화 ID 매칭이 성공하는지**(스펙의 열린 리스크 항목 — 실패 시 표현이 뜻 없이 남는 사례가 있는지 확인)
- [ ] 같은 표현으로 캠페인을 두 번 돌렸을 때 문서 수가 늘지 않고 덮어써지는지(중복 방지 확인)
- [ ] 기존 "지금 바로 생성"(소량 오버라이드)과 일일 top-up이 이번 변경 이후에도 평소처럼 동작하는지

- [ ] **Step 4: 커밋 (검증 중 발견한 수정사항이 있었다면)**

수동 검증에서 2단계 echo 매칭 실패 등을 발견해 수정했다면:
```bash
git add functions/src/expressionTranslate.ts functions/src/expressionBatchPoller.ts
git commit -m "fix: correct expression text echo/matching per live API behavior"
```
