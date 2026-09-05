# 표현 풀 관리 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** word-bank Cloud Functions에 Gemini Batch API 기반 표현 풀 자동 생성(스케줄러+수동 오버라이드)을 추가하고, word-bank-web에 `/admin/expressions` 화면(조회/검색/수정/삭제/목표 풀 크기 설정/작업 현황)을 만든다.

**Architecture:** word-bank의 `topUpExpressionPools`(매일)가 언어별 목표 풀 크기 미달분을 감지해 Gemini Batch API에 제출하고, `pollExpressionBatchJobs`(30분마다)가 완료된 배치를 Firestore `expressions/{language}/items`에 반영한다. `updateExpression`/`deleteExpression`(기존 onCall, 미사용)은 제거하고 word-bank-web이 `getAdminFirestore()`로 직접 Firestore를 쓴다(기존 `restoreWordCacheEntryAction`과 동일 패턴). 수동 생성 오버라이드만 새 `adminSubmitExpressionBatch`(onRequest + `x-admin-api-key`)를 거친다.

**Tech Stack:** word-bank/functions: TypeScript, firebase-functions v2, firebase-admin v13, Jest. word-bank-web: Next.js 16(App Router), TypeScript, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-05-expression-pool-admin-design.md`

## Global Constraints

- word-bank의 Cloud Functions 프로젝트는 `wordbank-6284f`(story-generator와 동일 프로젝트) — `ADMIN_API_SHARED_SECRET`는 이미 존재하는 시크릿이므로 새로 생성하지 않는다.
- word-bank-web은 `STORY_GENERATOR_FUNCTIONS_BASE_URL`/`ADMIN_API_SHARED_SECRET` 환경변수를 재사용한다(새 env var 없음).
- `expressions/{language}/items`, `expressionPoolConfig/{language}`, `expressionBatchJobs/{jobId}`는 모두 `allow read, write: if false`(Admin SDK 전용).
- word-bank-web에서 Firestore 직접 read/write는 `getAdminFirestore()`(`lib/firebase/admin.ts`)로만 한다. 모든 Server Action은 `getAdminSession()`을 재확인한다.
- Gemini 모델은 기존과 동일하게 `gemini-2.5-flash`를 쓴다.
- word-bank 테스트는 `npm --prefix functions test`(Jest), word-bank-web 테스트는 `npm run test`(Vitest run) + `npm run lint` + `npm run build`.

---

## Part A — word-bank (Cloud Functions)

### Task 1: 관리자 공유 시크릿 검증 헬퍼

**Files:**
- Create: `functions/src/adminSecret.ts`
- Create: `functions/src/adminSecret.test.ts`
- Modify: `functions/src/secrets.ts`

**Interfaces:**
- Produces: `isValidAdminSecret(provided: string | undefined, expected: string): boolean`, `requireAdminSecret(req: Request, res: Response, expected: string): boolean`, `adminApiSharedSecret` (SecretParam)

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/adminSecret.test.ts`:
```ts
import { isValidAdminSecret } from './adminSecret';

describe('isValidAdminSecret', () => {
  it('일치하는 시크릿이면 true를 반환한다', () => {
    expect(isValidAdminSecret('abc123', 'abc123')).toBe(true);
  });

  it('일치하지 않는 시크릿이면 false를 반환한다', () => {
    expect(isValidAdminSecret('abc123', 'xyz789')).toBe(false);
  });

  it('provided가 없으면 false를 반환한다', () => {
    expect(isValidAdminSecret(undefined, 'abc123')).toBe(false);
  });

  it('길이가 다르면 false를 반환한다', () => {
    expect(isValidAdminSecret('short', 'a-much-longer-secret')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm --prefix functions test -- adminSecret.test.ts`
Expected: FAIL with "Cannot find module './adminSecret'"

- [ ] **Step 3: 구현**

`functions/src/adminSecret.ts`:
```ts
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

export function isValidAdminSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export function requireAdminSecret(req: Request, res: Response, expected: string): boolean {
  if (!isValidAdminSecret(req.get('x-admin-api-key'), expected)) {
    res.status(401).json({ error: '인증 실패' });
    return false;
  }
  return true;
}
```

`functions/src/secrets.ts` (전체 파일을 아래로 교체):
```ts
import { defineSecret } from 'firebase-functions/params';

export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const adminApiSharedSecret = defineSecret('ADMIN_API_SHARED_SECRET');
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm --prefix functions test -- adminSecret.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/adminSecret.ts functions/src/adminSecret.test.ts functions/src/secrets.ts
git commit -m "feat: add admin shared-secret verification helper"
```

---

### Task 2: Gemini Batch API 클라이언트 래퍼

**Files:**
- Create: `functions/src/geminiBatchClient.ts`
- Create: `functions/src/geminiBatchClient.test.ts`

**Interfaces:**
- Produces: `submitInlineBatch(model: string, displayName: string, request: GeminiBatchRequest, apiKey: string): Promise<{ name: string }>`, `getBatch(name: string, apiKey: string): Promise<GeminiBatchStatus>`, types `GeminiBatchRequest`, `GeminiBatchStatus`

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/geminiBatchClient.test.ts`:
```ts
import { submitInlineBatch, getBatch } from './geminiBatchClient';

describe('geminiBatchClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  describe('submitInlineBatch', () => {
    it('POST으로 배치를 제출하고 batch 이름을 반환한다', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'batches/abc123' }),
      });

      const result = await submitInlineBatch(
        'gemini-2.5-flash',
        'test-batch',
        { contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: {} },
        'test-key',
      );

      expect(result).toEqual({ name: 'batches/abc123' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('models/gemini-2.5-flash:batchGenerateContent?key=test-key'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('응답이 실패하면 에러를 던진다', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        text: async () => 'bad request',
      });

      await expect(
        submitInlineBatch('gemini-2.5-flash', 'test-batch', { contents: [], generationConfig: {} }, 'test-key'),
      ).rejects.toThrow('bad request');
    });
  });

  describe('getBatch', () => {
    it('GET으로 배치 상태를 조회한다', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: 'BATCH_STATE_SUCCEEDED', output: { inlinedResponses: [] } }),
      });

      const result = await getBatch('batches/abc123', 'test-key');

      expect(result.state).toBe('BATCH_STATE_SUCCEEDED');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/batches/abc123?key=test-key',
      );
    });

    it('응답이 실패하면 에러를 던진다', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, text: async () => 'not found' });

      await expect(getBatch('batches/missing', 'test-key')).rejects.toThrow('not found');
    });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm --prefix functions test -- geminiBatchClient.test.ts`
Expected: FAIL with "Cannot find module './geminiBatchClient'"

- [ ] **Step 3: 구현**

`functions/src/geminiBatchClient.ts`:
```ts
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type GeminiBatchRequest = {
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: Record<string, unknown>;
};

export type GeminiBatchStatus = {
  state: string;
  output?: {
    inlinedResponses?: Array<{ response?: any; error?: any }>;
  };
};

export async function submitInlineBatch(
  model: string,
  displayName: string,
  request: GeminiBatchRequest,
  apiKey: string,
): Promise<{ name: string }> {
  const response = await fetch(`${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName,
      inputConfig: { requests: { requests: [{ request, metadata: { key: 'expression-pool' } }] } },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini batch submit error: ${errorText}`);
  }
  const data = (await response.json()) as { name: string };
  return { name: data.name };
}

export async function getBatch(name: string, apiKey: string): Promise<GeminiBatchStatus> {
  const response = await fetch(`${GEMINI_API_BASE}/${name}?key=${apiKey}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini batch get error: ${errorText}`);
  }
  return (await response.json()) as GeminiBatchStatus;
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm --prefix functions test -- geminiBatchClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/geminiBatchClient.ts functions/src/geminiBatchClient.test.ts
git commit -m "feat: add Gemini Batch API client wrapper"
```

---

### Task 3: `expressionPool.ts` 재작성 — 배치 제출 + 관리자 오버라이드

**Files:**
- Modify: `functions/src/expressionPool.ts` (전체 교체)
- Modify: `functions/src/expressionPool.test.ts` (전체 교체)

**Interfaces:**
- Consumes: `submitInlineBatch` (Task 2), `requireAdminSecret` (Task 1), `geminiApiKey`/`adminApiSharedSecret` (Task 1), `LANG_NAMES` (기존 `langNames.ts`)
- Produces: `buildPoolPrompt(langName: string, count: number): string`, `submitExpressionBatchInternal(language: string, count: number, requestedBy: 'auto' | 'manual'): Promise<{ jobId: string }>`, `adminSubmitExpressionBatchHandler(req, res): Promise<void>`, `adminSubmitExpressionBatch` (onRequest export)

- [ ] **Step 1: 실패하는 테스트 작성 (기존 파일을 아래로 전체 교체)**

`functions/src/expressionPool.test.ts`:
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
  buildPoolPrompt,
  submitExpressionBatchInternal,
  adminSubmitExpressionBatchHandler,
} from './expressionPool';

const mockGetFirestore = getFirestore as jest.Mock;
const mockSubmitInlineBatch = submitInlineBatch as jest.Mock;

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('buildPoolPrompt', () => {
  it('언어명과 개수를 프롬프트에 포함한다', () => {
    const prompt = buildPoolPrompt('Spanish', 10);
    expect(prompt).toContain('10 commonly used real-life expressions');
    expect(prompt).toContain('Spanish');
  });
});

describe('submitExpressionBatchInternal', () => {
  it('Gemini 배치를 제출하고 expressionBatchJobs 문서를 생성한다', async () => {
    mockSubmitInlineBatch.mockResolvedValueOnce({ name: 'batches/abc123' });
    const mockSet = jest.fn().mockResolvedValueOnce(undefined);
    const mockDoc = jest.fn(() => ({ id: 'job1', set: mockSet }));
    const mockCollection = jest.fn(() => ({ doc: mockDoc }));
    mockGetFirestore.mockReturnValue({ collection: mockCollection });

    const result = await submitExpressionBatchInternal('es', 10, 'manual');

    expect(mockSubmitInlineBatch).toHaveBeenCalledWith(
      'gemini-2.5-flash',
      expect.stringContaining('expression-pool-es-'),
      expect.objectContaining({ contents: expect.any(Array) }),
      'test-gemini-key',
    );
    expect(mockCollection).toHaveBeenCalledWith('expressionBatchJobs');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'es',
        count: 10,
        status: 'pending',
        geminiBatchJobName: 'batches/abc123',
        requestedBy: 'manual',
      }),
    );
    expect(result).toEqual({ jobId: 'job1' });
  });
});

describe('adminSubmitExpressionBatchHandler', () => {
  it('x-admin-api-key가 없으면 401을 반환한다', async () => {
    const req: any = { method: 'POST', get: () => undefined, body: { language: 'es', count: 10 } };
    const res = makeRes();
    await adminSubmitExpressionBatchHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('GET 요청이면 405를 반환한다', async () => {
    const req: any = { method: 'GET', get: () => 'test-admin-secret' };
    const res = makeRes();
    await adminSubmitExpressionBatchHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('count가 범위를 벗어나면 400을 반환한다', async () => {
    const req: any = { method: 'POST', get: () => 'test-admin-secret', body: { language: 'es', count: 100 } };
    const res = makeRes();
    await adminSubmitExpressionBatchHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('유효한 요청이면 배치를 제출하고 jobId를 반환한다', async () => {
    mockSubmitInlineBatch.mockResolvedValueOnce({ name: 'batches/abc123' });
    const mockSet = jest.fn().mockResolvedValueOnce(undefined);
    const mockDoc = jest.fn(() => ({ id: 'job1', set: mockSet }));
    const mockCollection = jest.fn(() => ({ doc: mockDoc }));
    mockGetFirestore.mockReturnValue({ collection: mockCollection });

    const req: any = { method: 'POST', get: () => 'test-admin-secret', body: { language: 'es', count: 10 } };
    const res = makeRes();
    await adminSubmitExpressionBatchHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job1' });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm --prefix functions test -- expressionPool.test.ts`
Expected: FAIL (옛 `expressionPoolHandler`/`updateExpressionHandler` 등을 찾지 못하거나 새 export가 없어서 실패)

- [ ] **Step 3: 구현 (전체 파일 교체)**

`functions/src/expressionPool.ts`:
```ts
import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { geminiApiKey, adminApiSharedSecret } from './secrets';
import { requireAdminSecret } from './adminSecret';
import { LANG_NAMES } from './langNames';
import { submitInlineBatch } from './geminiBatchClient';

const GEMINI_MODEL = 'gemini-2.5-flash';

const MEANING_LANGUAGE_CODES = ['ko', 'en', 'ja', 'zh', 'de', 'fr', 'es', 'pt', 'ar', 'la', 'hi', 'bn', 'ru', 'id'];

function buildMeaningsSchema(): object {
  const properties: Record<string, object> = {};
  for (const code of MEANING_LANGUAGE_CODES) {
    properties[code] = {
      type: 'object',
      properties: {
        definition: { type: 'string' },
        example: {
          type: 'object',
          properties: { sentence: { type: 'string' }, translation: { type: 'string' } },
          required: ['sentence', 'translation'],
        },
      },
      required: ['definition', 'example'],
    };
  }
  return { type: 'object', properties, required: MEANING_LANGUAGE_CODES };
}

export const EXPRESSION_POOL_SCHEMA = {
  type: 'object',
  properties: {
    expressions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          register: { type: 'string', enum: ['casual', 'formal'] },
          meanings: buildMeaningsSchema(),
          similarExpressions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        },
        required: ['text', 'register', 'meanings'],
      },
    },
  },
  required: ['expressions'],
};

export function buildPoolPrompt(langName: string, count: number): string {
  const meaningLangList = MEANING_LANGUAGE_CODES.map((c) => LANG_NAMES[c] ?? c).join(', ');
  return `You are a language-learning content curator. Produce exactly ${count} commonly used real-life expressions/idioms in ${langName} that an intermediate learner should know (everyday phrases, idioms, phrasal expressions — NOT single dictionary words).

For each expression, provide:
- "text": the expression in its canonical form, in ${langName}.
- "register": "casual" or "formal".
- "meanings": an object with ONE entry per language in this exact list: ${meaningLangList}. Each entry has "definition" (a short explanation of the expression's meaning, written in that language) and "example" (a natural example sentence using the expression, written in ${langName}, with "sentence" in ${langName} and "translation" of that sentence into the meaning language).
- "similarExpressions": up to 3 similar expressions in ${langName} (optional).

Do not repeat the same expression twice. Do not fabricate — only include real, commonly used expressions.`;
}

export async function submitExpressionBatchInternal(
  language: string,
  count: number,
  requestedBy: 'auto' | 'manual',
): Promise<{ jobId: string }> {
  const langName = LANG_NAMES[language] ?? language;
  const prompt = buildPoolPrompt(langName, count);

  const { name } = await submitInlineBatch(
    GEMINI_MODEL,
    `expression-pool-${language}-${Date.now()}`,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXPRESSION_POOL_SCHEMA,
        maxOutputTokens: 8192,
      },
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
    requestedBy,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { jobId: jobRef.id };
}

export async function adminSubmitExpressionBatchHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다' });
    return;
  }
  if (!requireAdminSecret(req, res, adminApiSharedSecret.value())) return;

  const { language, count } = req.body ?? {};
  if (!language || !count || count < 1 || count > 50) {
    res.status(400).json({ error: 'language와 count(1-50)가 필요합니다' });
    return;
  }

  try {
    const result = await submitExpressionBatchInternal(language, count, 'manual');
    res.status(200).json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export const adminSubmitExpressionBatch = onRequest(
  { secrets: [geminiApiKey, adminApiSharedSecret], timeoutSeconds: 60 },
  adminSubmitExpressionBatchHandler,
);
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm --prefix functions test -- expressionPool.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/expressionPool.ts functions/src/expressionPool.test.ts
git commit -m "refactor: move expression pool generation to Gemini Batch API"
```

---

### Task 4: 자동 top-up 스케줄러

**Files:**
- Create: `functions/src/expressionPoolTopUp.ts`
- Create: `functions/src/expressionPoolTopUp.test.ts`

**Interfaces:**
- Consumes: `submitExpressionBatchInternal` (Task 3)
- Produces: `topUpExpressionPoolsHandler(): Promise<void>`, `topUpExpressionPools` (onSchedule export)

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/expressionPoolTopUp.test.ts`:
```ts
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));
jest.mock('./expressionPool', () => ({ submitExpressionBatchInternal: jest.fn() }));

import { getFirestore } from 'firebase-admin/firestore';
import { submitExpressionBatchInternal } from './expressionPool';
import { topUpExpressionPoolsHandler } from './expressionPoolTopUp';

const mockGetFirestore = getFirestore as jest.Mock;
const mockSubmit = submitExpressionBatchInternal as jest.Mock;

function makeConfigDoc(language: string, targetSize: number) {
  return { id: language, data: () => ({ targetSize }) };
}

function mockFirestoreFor({
  configDocs,
  currentCount,
  pendingEmpty,
}: {
  configDocs: ReturnType<typeof makeConfigDoc>[];
  currentCount: number;
  pendingEmpty: boolean;
}) {
  const mockConfigGet = jest.fn().mockResolvedValue({ docs: configDocs });
  const mockCountGet = jest.fn().mockResolvedValue({ data: () => ({ count: currentCount }) });
  const mockPendingGet = jest.fn().mockResolvedValue({ empty: pendingEmpty });
  const mockLimit = jest.fn(() => ({ get: mockPendingGet }));
  const mockWhere2 = jest.fn(() => ({ limit: mockLimit }));
  const mockWhere1 = jest.fn(() => ({ where: mockWhere2 }));
  const mockCount = jest.fn(() => ({ get: mockCountGet }));
  const mockItemsDoc = jest.fn(() => ({ collection: jest.fn(() => ({ count: mockCount })) }));

  mockGetFirestore.mockReturnValue({
    collection: jest.fn((name: string) => {
      if (name === 'expressionPoolConfig') return { get: mockConfigGet };
      if (name === 'expressions') return { doc: mockItemsDoc };
      if (name === 'expressionBatchJobs') return { where: mockWhere1 };
      throw new Error(`unexpected collection: ${name}`);
    }),
  });
}

describe('topUpExpressionPoolsHandler', () => {
  beforeEach(() => {
    mockSubmit.mockClear();
  });

  it('풀 크기가 목표보다 부족하면 부족분만큼 배치를 제출한다', async () => {
    mockFirestoreFor({ configDocs: [makeConfigDoc('es', 50)], currentCount: 20, pendingEmpty: true });

    await topUpExpressionPoolsHandler();

    expect(mockSubmit).toHaveBeenCalledWith('es', 30, 'auto');
  });

  it('목표를 이미 채웠으면 배치를 제출하지 않는다', async () => {
    mockFirestoreFor({ configDocs: [makeConfigDoc('es', 50)], currentCount: 60, pendingEmpty: true });

    await topUpExpressionPoolsHandler();

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('이미 진행중인 배치 작업이 있으면 중복 제출하지 않는다', async () => {
    mockFirestoreFor({ configDocs: [makeConfigDoc('es', 50)], currentCount: 20, pendingEmpty: false });

    await topUpExpressionPoolsHandler();

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('부족분이 50을 넘으면 50으로 클램프한다', async () => {
    mockFirestoreFor({ configDocs: [makeConfigDoc('ja', 200)], currentCount: 0, pendingEmpty: true });

    await topUpExpressionPoolsHandler();

    expect(mockSubmit).toHaveBeenCalledWith('ja', 50, 'auto');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm --prefix functions test -- expressionPoolTopUp.test.ts`
Expected: FAIL with "Cannot find module './expressionPoolTopUp'"

- [ ] **Step 3: 구현**

`functions/src/expressionPoolTopUp.ts`:
```ts
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { geminiApiKey } from './secrets';
import { submitExpressionBatchInternal } from './expressionPool';

const MAX_BATCH_COUNT = 50;

export async function topUpExpressionPoolsHandler(): Promise<void> {
  const db = getFirestore();
  const configSnap = await db.collection('expressionPoolConfig').get();

  for (const configDoc of configSnap.docs) {
    const language = configDoc.id;
    const targetSize = configDoc.data().targetSize;
    if (typeof targetSize !== 'number' || targetSize <= 0) continue;

    const countSnap = await db.collection('expressions').doc(language).collection('items').count().get();
    const currentCount = countSnap.data().count;
    const shortfall = targetSize - currentCount;
    if (shortfall <= 0) continue;

    const pendingSnap = await db
      .collection('expressionBatchJobs')
      .where('language', '==', language)
      .where('status', 'in', ['pending', 'running'])
      .limit(1)
      .get();
    if (!pendingSnap.empty) continue;

    await submitExpressionBatchInternal(language, Math.min(shortfall, MAX_BATCH_COUNT), 'auto');
  }
}

export const topUpExpressionPools = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'UTC', timeoutSeconds: 300, memory: '256MiB', secrets: [geminiApiKey] },
  async () => {
    await topUpExpressionPoolsHandler();
  },
);
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm --prefix functions test -- expressionPoolTopUp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add functions/src/expressionPoolTopUp.ts functions/src/expressionPoolTopUp.test.ts
git commit -m "feat: add scheduled top-up for expression pools"
```

---

### Task 5: 배치 작업 폴링/완료 처리 + 배포 설정(index/rules/indexes)

**Files:**
- Create: `functions/src/expressionBatchPoller.ts`
- Create: `functions/src/expressionBatchPoller.test.ts`
- Modify: `functions/src/index.ts:12`
- Modify: `firestore.rules` (expressions 컬렉션 주석 + 신규 2개 컬렉션 규칙)
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: `getBatch` (Task 2)
- Produces: `pollExpressionBatchJobsHandler(): Promise<void>`, `pollExpressionBatchJobs` (onSchedule export)

- [ ] **Step 1: 실패하는 테스트 작성**

`functions/src/expressionBatchPoller.test.ts`:
```ts
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
}));
jest.mock('./secrets', () => ({ geminiApiKey: { value: () => 'test-key' } }));
jest.mock('./geminiBatchClient', () => ({ getBatch: jest.fn() }));

import { getFirestore } from 'firebase-admin/firestore';
import { getBatch } from './geminiBatchClient';
import { pollExpressionBatchJobsHandler } from './expressionBatchPoller';

const mockGetFirestore = getFirestore as jest.Mock;
const mockGetBatch = getBatch as jest.Mock;

function makeJobDoc(id: string, data: Record<string, unknown>, updateSpy: jest.Mock) {
  return { id, data: () => data, ref: { update: updateSpy } };
}

function mockFirestoreWithJobs(jobDocs: ReturnType<typeof makeJobDoc>[]) {
  const mockJobsGet = jest.fn().mockResolvedValue({ docs: jobDocs });
  const mockLimit = jest.fn(() => ({ get: mockJobsGet }));
  const mockWhere = jest.fn(() => ({ get: mockJobsGet, limit: mockLimit }));
  const mockWriteBatchSet = jest.fn();
  const mockWriteBatchCommit = jest.fn().mockResolvedValue(undefined);
  const mockItemsDoc = jest.fn(() => ({ doc: jest.fn() }));
  const mockItemsCollection = jest.fn(() => ({ doc: mockItemsDoc }));

  mockGetFirestore.mockReturnValue({
    collection: jest.fn((name: string) => {
      if (name === 'expressionBatchJobs') return { where: mockWhere };
      if (name === 'expressions') return { doc: jest.fn(() => ({ collection: mockItemsCollection })) };
      throw new Error(`unexpected collection: ${name}`);
    }),
    batch: jest.fn(() => ({ set: mockWriteBatchSet, commit: mockWriteBatchCommit })),
  });

  return { mockWriteBatchSet, mockWriteBatchCommit };
}

describe('pollExpressionBatchJobsHandler', () => {
  it('SUCCEEDED 상태면 결과를 Firestore에 쓰고 job을 succeeded로 갱신한다', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc('job1', { language: 'es', geminiBatchJobName: 'batches/abc' }, mockUpdate);
    const { mockWriteBatchSet, mockWriteBatchCommit } = mockFirestoreWithJobs([jobDoc]);

    mockGetBatch.mockResolvedValueOnce({
      state: 'BATCH_STATE_SUCCEEDED',
      output: {
        inlinedResponses: [
          {
            response: {
              candidates: [
                { content: { parts: [{ text: JSON.stringify({ expressions: [{ text: 'break the ice', register: 'casual', meanings: {} }] }) }] } },
              ],
            },
          },
        ],
      },
    });

    await pollExpressionBatchJobsHandler();

    expect(mockWriteBatchSet).toHaveBeenCalledTimes(1);
    expect(mockWriteBatchCommit).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', completedAt: 'SERVER_TS' }),
    );
  });

  it('FAILED 상태면 job을 failed로 갱신하고 Firestore에 결과를 쓰지 않는다', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc('job1', { language: 'es', geminiBatchJobName: 'batches/abc' }, mockUpdate);
    const { mockWriteBatchSet } = mockFirestoreWithJobs([jobDoc]);

    mockGetBatch.mockResolvedValueOnce({ state: 'BATCH_STATE_FAILED' });

    await pollExpressionBatchJobsHandler();

    expect(mockWriteBatchSet).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'BATCH_STATE_FAILED' }),
    );
  });

  it('아직 RUNNING이면 status만 running으로 갱신한다', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const jobDoc = makeJobDoc('job1', { language: 'es', geminiBatchJobName: 'batches/abc' }, mockUpdate);
    mockFirestoreWithJobs([jobDoc]);

    mockGetBatch.mockResolvedValueOnce({ state: 'BATCH_STATE_RUNNING' });

    await pollExpressionBatchJobsHandler();

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'running' });
  });

  it('개별 job 조회가 실패해도 나머지 job 처리를 계속한다', async () => {
    const mockUpdate1 = jest.fn().mockResolvedValue(undefined);
    const mockUpdate2 = jest.fn().mockResolvedValue(undefined);
    const jobDoc1 = makeJobDoc('job1', { language: 'es', geminiBatchJobName: 'batches/bad' }, mockUpdate1);
    const jobDoc2 = makeJobDoc('job2', { language: 'ja', geminiBatchJobName: 'batches/good' }, mockUpdate2);
    mockFirestoreWithJobs([jobDoc1, jobDoc2]);

    mockGetBatch.mockRejectedValueOnce(new Error('network error'));
    mockGetBatch.mockResolvedValueOnce({ state: 'BATCH_STATE_RUNNING' });

    await pollExpressionBatchJobsHandler();

    expect(mockUpdate1).not.toHaveBeenCalled();
    expect(mockUpdate2).toHaveBeenCalledWith({ status: 'running' });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm --prefix functions test -- expressionBatchPoller.test.ts`
Expected: FAIL with "Cannot find module './expressionBatchPoller'"

- [ ] **Step 3: 구현**

`functions/src/expressionBatchPoller.ts`:
```ts
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { geminiApiKey } from './secrets';
import { getBatch } from './geminiBatchClient';

const TERMINAL_FAILURE_STATES = ['BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED'];

export async function pollExpressionBatchJobsHandler(): Promise<void> {
  const db = getFirestore();
  const jobsSnap = await db.collection('expressionBatchJobs').where('status', 'in', ['pending', 'running']).get();

  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();
    try {
      const batch = await getBatch(job.geminiBatchJobName, geminiApiKey.value());

      if (batch.state === 'BATCH_STATE_SUCCEEDED') {
        const inlined = batch.output?.inlinedResponses ?? [];
        const text = inlined[0]?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!text) throw new Error('EMPTY_BATCH_RESPONSE');

        const parsed = JSON.parse(text) as { expressions: any[] };
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
        await writeBatch.commit();
        await jobDoc.ref.update({ status: 'succeeded', completedAt: FieldValue.serverTimestamp() });
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

`functions/src/index.ts:12`의 아래 줄:
```ts
export { generateExpressionPool, updateExpression, deleteExpression } from './expressionPool';
```
을 아래로 교체:
```ts
export { adminSubmitExpressionBatch } from './expressionPool';
export { topUpExpressionPools } from './expressionPoolTopUp';
export { pollExpressionBatchJobs } from './expressionBatchPoller';
```

`firestore.rules`의 `expressions` 컬렉션 규칙 블록(주석 포함)을 아래로 교체:
```
    // 관리자가 미리 큐레이션한 표현 풀 — word_cache/stories와 동일하게 공개 read,
    // 쓰기는 admin 전용 경로(Cloud Function 배치 처리 또는 word-bank-web의 Admin SDK)만
    // 가능. "allow write: if false"는 클라이언트 SDK 쓰기만 차단한다는 뜻.
    match /expressions/{language}/items/{itemId} {
      allow read: if true;
      allow write: if false;
    }

    // 언어별 표현 풀 목표 크기 설정 — word-bank-web 관리자 화면에서 Admin SDK로만 읽고 쓴다.
    match /expressionPoolConfig/{language} {
      allow read, write: if false;
    }

    // Gemini Batch API로 표현 풀을 생성하는 작업 현황 — Cloud Function(제출/폴링)과
    // word-bank-web 관리자 화면(조회)만 Admin SDK로 접근한다.
    match /expressionBatchJobs/{jobId} {
      allow read, write: if false;
    }
```

`firestore.indexes.json`의 `"indexes"` 배열 마지막에 아래 두 항목 추가 (닫는 `]` 앞, `word_fix_reports` 항목 뒤에 콤마 추가 후):
```json
    {
      "collectionGroup": "expressionBatchJobs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "language", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "expressionBatchJobs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "language", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm --prefix functions test`
Expected: PASS (전체 스위트 — `expressionPool.test.ts`, `expressionPoolTopUp.test.ts`, `expressionBatchPoller.test.ts`, `adminSecret.test.ts`, `geminiBatchClient.test.ts` 포함)

- [ ] **Step 5: 빌드 확인**

Run: `npm --prefix functions run build`
Expected: 타입 에러 없이 성공

- [ ] **Step 6: 커밋**

```bash
git add functions/src/expressionBatchPoller.ts functions/src/expressionBatchPoller.test.ts functions/src/index.ts firestore.rules firestore.indexes.json
git commit -m "feat: poll Gemini batch jobs and wire up expression pool functions"
```

---

## Part B — word-bank-web (관리자 대시보드)

### Task 6: 언어 상수

**Files:**
- Create: `lib/constants/languages.ts`

- [ ] **Step 1: 구현**

`lib/constants/languages.ts`:
```ts
// word-bank/functions/src/langNames.ts와 동기화 유지 (word-bank는 별도 레포라 공유 패키지가 없음)
export const LANG_NAMES: Record<string, string> = {
  en: "English", ko: "Korean", ja: "Japanese", zh: "Chinese",
  fr: "French", de: "German", es: "Spanish", it: "Italian",
  pt: "Portuguese", ar: "Arabic", la: "Latin",
  hi: "Hindi", bn: "Bengali", ru: "Russian", id: "Indonesian",
};

// word-bank/functions/src/expressionPool.ts의 MEANING_LANGUAGE_CODES와 동기화 유지.
// LANG_NAMES와 달리 'it'(이탈리아어)이 빠져 있다 — 뜻 번역이 지원되는 14개 언어만 포함.
export const MEANING_LANGUAGE_CODES = ["ko", "en", "ja", "zh", "de", "fr", "es", "pt", "ar", "la", "hi", "bn", "ru", "id"];
```

이 태스크는 상수 정의뿐이라 별도 테스트 없이 다음 태스크(Task 7)에서 실제 사용을 통해 검증한다.

- [ ] **Step 2: 커밋**

```bash
git add lib/constants/languages.ts
git commit -m "feat: add shared language constants for expression pool admin"
```

---

### Task 7: 표현 풀 데이터 조회 계층

**Files:**
- Create: `lib/data/expressions.ts`
- Create: `lib/data/expressions.test.ts`

**Interfaces:**
- Consumes: `getAdminFirestore()` (`lib/firebase/admin.ts`)
- Produces: types `Expression`, `ExpressionsPage`, `ExpressionPoolConfigRow`, `ExpressionBatchJob`; functions `listExpressions(language, cursor?)`, `listExpressionPoolConfigs(languages)`, `listExpressionBatchJobs(language?)`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/data/expressions.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { listExpressions, listExpressionPoolConfigs, listExpressionBatchJobs } from './expressions';
import { getAdminFirestore } from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('listExpressions', () => {
  it('페이지 크기보다 많으면 nextCursor를 채운다', async () => {
    const docs = Array.from({ length: 51 }, (_, i) => ({
      id: `e${i}`,
      data: () => ({
        text: `expr${i}`, register: 'casual', meanings: {}, similarExpressions: [],
        createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
      }),
    }));
    const mockGet = vi.fn().mockResolvedValueOnce({ docs });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockItemsCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressions('en');

    expect(mockCollection).toHaveBeenCalledWith('expressions');
    expect(mockLangDoc).toHaveBeenCalledWith('en');
    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('e49');
  });

  it('결과가 페이지 크기 이하이면 nextCursor는 null이다', async () => {
    const docs = [{
      id: 'e0',
      data: () => ({
        text: 'break the ice', register: 'casual', meanings: {}, similarExpressions: [],
        createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
      }),
    }];
    const mockGet = vi.fn().mockResolvedValueOnce({ docs });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockItemsCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressions('en');

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });
});

describe('listExpressionPoolConfigs', () => {
  it('언어별 targetSize와 현재 count를 함께 반환한다', async () => {
    const mockConfigGet = vi.fn().mockResolvedValue({ exists: true, data: () => ({ targetSize: 50 }) });
    const mockCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 30 }) });
    const mockCount = vi.fn(() => ({ get: mockCountGet }));
    const mockItemsCollection = vi.fn(() => ({ count: mockCount }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection, get: mockConfigGet }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressionPoolConfigs(['en']);

    expect(result).toEqual([{ language: 'en', targetSize: 50, currentCount: 30 }]);
  });

  it('설정 문서가 없으면 targetSize는 0이다', async () => {
    const mockConfigGet = vi.fn().mockResolvedValue({ exists: false });
    const mockCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) });
    const mockCount = vi.fn(() => ({ get: mockCountGet }));
    const mockItemsCollection = vi.fn(() => ({ count: mockCount }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection, get: mockConfigGet }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressionPoolConfigs(['it']);

    expect(result).toEqual([{ language: 'it', targetSize: 0, currentCount: 0 }]);
  });
});

describe('listExpressionBatchJobs', () => {
  it('언어 필터 없이 최근 작업 목록을 반환한다', async () => {
    const docs = [{
      id: 'job1',
      data: () => ({
        language: 'en', count: 10, status: 'succeeded', requestedBy: 'manual',
        createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
        completedAt: makeTimestamp('2026-08-05T01:00:00.000Z'),
        error: null,
      }),
    }];
    const mockGet = vi.fn().mockResolvedValueOnce({ docs });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressionBatchJobs();

    expect(result).toEqual([{
      id: 'job1', language: 'en', count: 10, status: 'succeeded', requestedBy: 'manual',
      createdAt: '2026-08-05T00:00:00.000Z', completedAt: '2026-08-05T01:00:00.000Z', error: null,
    }]);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test -- lib/data/expressions.test.ts`
Expected: FAIL with "Cannot find module './expressions'"

- [ ] **Step 3: 구현**

`lib/data/expressions.ts`:
```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type Expression = {
  id: string;
  text: string;
  register: "casual" | "formal";
  meanings: Record<string, { definition: string; example: { sentence: string; translation: string } }>;
  similarExpressions: string[];
  createdAt: string;
};

export type ExpressionsPage = {
  items: Expression[];
  nextCursor: string | null;
};

export type ExpressionPoolConfigRow = {
  language: string;
  targetSize: number;
  currentCount: number;
};

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

const EXPRESSIONS_PAGE_SIZE = 50;
const BATCH_JOBS_LIMIT = 30;

export async function listExpressions(language: string, cursor?: string): Promise<ExpressionsPage> {
  const db = getAdminFirestore();
  const itemsRef = db.collection("expressions").doc(language).collection("items");
  let query = itemsRef.orderBy("createdAt", "desc");

  if (cursor) {
    const cursorDoc = await itemsRef.doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.limit(EXPRESSIONS_PAGE_SIZE + 1).get();
  const hasMore = snapshot.docs.length > EXPRESSIONS_PAGE_SIZE;
  const pageDocs = hasMore ? snapshot.docs.slice(0, EXPRESSIONS_PAGE_SIZE) : snapshot.docs;

  const items = pageDocs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      text: data.text,
      register: data.register,
      meanings: data.meanings ?? {},
      similarExpressions: Array.isArray(data.similarExpressions) ? data.similarExpressions : [],
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });

  return {
    items,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : null,
  };
}

export async function listExpressionPoolConfigs(languages: string[]): Promise<ExpressionPoolConfigRow[]> {
  const db = getAdminFirestore();

  return Promise.all(
    languages.map(async (language) => {
      const [configDoc, countSnap] = await Promise.all([
        db.collection("expressionPoolConfig").doc(language).get(),
        db.collection("expressions").doc(language).collection("items").count().get(),
      ]);
      const targetSize = configDoc.exists ? (configDoc.data()?.targetSize ?? 0) : 0;
      return { language, targetSize, currentCount: countSnap.data().count };
    }),
  );
}

export async function listExpressionBatchJobs(language?: string): Promise<ExpressionBatchJob[]> {
  const db = getAdminFirestore();
  const base = language
    ? db.collection("expressionBatchJobs").where("language", "==", language)
    : db.collection("expressionBatchJobs");
  const snapshot = await base.orderBy("createdAt", "desc").limit(BATCH_JOBS_LIMIT).get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
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
  });
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm run test -- lib/data/expressions.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/data/expressions.ts lib/data/expressions.test.ts
git commit -m "feat: add expression pool data access layer"
```

---

### Task 8: word-bank Cloud Function HTTP 래퍼

**Files:**
- Create: `lib/admin-functions/expressionPool.ts`
- Create: `lib/admin-functions/expressionPool.test.ts`

**Interfaces:**
- Produces: `submitExpressionBatch(language: string, count: number): Promise<{ jobId: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/admin-functions/expressionPool.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('submitExpressionBatch', () => {
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

  it('jobId를 응답으로 받으면 그대로 반환한다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job1' }),
    });

    const { submitExpressionBatch } = await import('./expressionPool');
    const result = await submitExpressionBatch('es', 10);

    expect(result).toEqual({ jobId: 'job1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://us-central1-wordbank-6284f.cloudfunctions.net/adminSubmitExpressionBatch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-admin-api-key': 'test-secret' }),
        body: JSON.stringify({ language: 'es', count: 10 }),
      }),
    );
  });

  it('응답이 실패하면 에러 메시지를 던진다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'language와 count(1-50)가 필요합니다' }),
    });

    const { submitExpressionBatch } = await import('./expressionPool');

    await expect(submitExpressionBatch('es', 0)).rejects.toThrow('language와 count(1-50)가 필요합니다');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test -- lib/admin-functions/expressionPool.test.ts`
Expected: FAIL with "Cannot find module './expressionPool'"

- [ ] **Step 3: 구현**

`lib/admin-functions/expressionPool.ts`:
```ts
import "server-only";

const BASE_URL = process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL;
const SHARED_SECRET = process.env.ADMIN_API_SHARED_SECRET;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다`);
  return value;
}

export async function submitExpressionBatch(language: string, count: number): Promise<{ jobId: string }> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminSubmitExpressionBatch`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ language, count }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `표현 풀 생성 요청 실패 (${response.status})`);
  }
  return response.json();
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm run test -- lib/admin-functions/expressionPool.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/admin-functions/expressionPool.ts lib/admin-functions/expressionPool.test.ts
git commit -m "feat: add HTTP wrapper for expression batch submission"
```

---

### Task 9: Server Actions

**Files:**
- Create: `lib/actions/expressionActions.ts`
- Create: `lib/actions/expressionActions.test.ts`

**Interfaces:**
- Consumes: `getAdminSession()`, `getAdminFirestore()`, `submitExpressionBatch` (Task 8), types from `lib/data/expressions.ts` (Task 7)
- Produces: `updateExpressionAction`, `deleteExpressionAction`, `updateExpressionPoolConfigAction`, `submitExpressionBatchAction`, `fetchMoreExpressionsAction`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/actions/expressionActions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/firebase/admin');
vi.mock('@/lib/auth/session');
vi.mock('next/cache');
vi.mock('@/lib/admin-functions/expressionPool');
vi.mock('@/lib/data/expressions', () => ({ listExpressions: vi.fn() }));

import {
  updateExpressionAction,
  deleteExpressionAction,
  updateExpressionPoolConfigAction,
  submitExpressionBatchAction,
  fetchMoreExpressionsAction,
} from './expressionActions';
import * as adminModule from '@/lib/firebase/admin';
import * as sessionModule from '@/lib/auth/session';
import * as cacheModule from 'next/cache';
import * as expressionPoolModule from '@/lib/admin-functions/expressionPool';
import * as expressionsDataModule from '@/lib/data/expressions';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);
const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockRevalidatePath = vi.mocked(cacheModule.revalidatePath);
const mockSubmitExpressionBatch = vi.mocked(expressionPoolModule.submitExpressionBatch);
const mockListExpressions = vi.mocked(expressionsDataModule.listExpressions);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminSession.mockResolvedValue({ uid: 'admin1' });
});

describe('updateExpressionAction', () => {
  it('허용되지 않은 필드가 있으면 Firestore를 건드리지 않고 에러를 반환한다', async () => {
    const mockUpdate = vi.fn();
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockItemsCollection = vi.fn(() => ({ doc: mockDoc }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockLangDoc })) } as unknown as Firestore);

    const result = await updateExpressionAction('en', 'e1', { text: 'ok', createdAt: 'hack' } as never);

    expect(result.error).toBeDefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('허용된 필드만 있으면 Firestore를 업데이트하고 페이지를 재검증한다', async () => {
    const mockUpdate = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockItemsCollection = vi.fn(() => ({ doc: mockDoc }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockLangDoc })) } as unknown as Firestore);

    const result = await updateExpressionAction('en', 'e1', { text: 'break the ice' });

    expect(mockUpdate).toHaveBeenCalledWith({ text: 'break the ice' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({});
  });

  it('관리자 세션이 없으면 에러를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await updateExpressionAction('en', 'e1', { text: 'x' });

    expect(result).toEqual({ error: '관리자 로그인이 필요합니다' });
  });
});

describe('deleteExpressionAction', () => {
  it('Firestore 문서를 삭제하고 페이지를 재검증한다', async () => {
    const mockDelete = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ delete: mockDelete }));
    const mockItemsCollection = vi.fn(() => ({ doc: mockDoc }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockLangDoc })) } as unknown as Firestore);

    const result = await deleteExpressionAction('en', 'e1');

    expect(mockDelete).toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({});
  });
});

describe('updateExpressionPoolConfigAction', () => {
  it('targetSize가 양의 정수가 아니면 에러를 반환한다', async () => {
    const result = await updateExpressionPoolConfigAction('en', -1);

    expect(result.error).toBeDefined();
  });

  it('유효하면 expressionPoolConfig 문서를 merge로 저장한다', async () => {
    const mockSet = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ set: mockSet }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as unknown as Firestore);

    const result = await updateExpressionPoolConfigAction('en', 100);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ targetSize: 100 }),
      { merge: true },
    );
    expect(result).toEqual({});
  });
});

describe('submitExpressionBatchAction', () => {
  it('성공하면 jobId를 반환하고 페이지를 재검증한다', async () => {
    mockSubmitExpressionBatch.mockResolvedValueOnce({ jobId: 'job1' });

    const result = await submitExpressionBatchAction('en', 10);

    expect(mockSubmitExpressionBatch).toHaveBeenCalledWith('en', 10);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({ jobId: 'job1' });
  });

  it('실패하면 에러 메시지를 반환한다', async () => {
    mockSubmitExpressionBatch.mockRejectedValueOnce(new Error('Gemini batch submit error'));

    const result = await submitExpressionBatchAction('en', 10);

    expect(result).toEqual({ error: 'Gemini batch submit error' });
  });
});

describe('fetchMoreExpressionsAction', () => {
  it('관리자 세션이 없으면 에러를 반환하고 listExpressions를 호출하지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await fetchMoreExpressionsAction('en', 'cursor1');

    expect(result).toEqual({ error: '관리자 로그인이 필요합니다' });
    expect(mockListExpressions).not.toHaveBeenCalled();
  });

  it('listExpressions에 위임한다', async () => {
    mockListExpressions.mockResolvedValueOnce({ items: [], nextCursor: null });

    const result = await fetchMoreExpressionsAction('en', 'cursor1');

    expect(mockListExpressions).toHaveBeenCalledWith('en', 'cursor1');
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test -- lib/actions/expressionActions.test.ts`
Expected: FAIL with "Cannot find module './expressionActions'"

- [ ] **Step 3: 구현**

`lib/actions/expressionActions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { submitExpressionBatch } from "@/lib/admin-functions/expressionPool";
import { listExpressions, type Expression, type ExpressionsPage } from "@/lib/data/expressions";

const UPDATE_ALLOWED_KEYS = ["text", "register", "meanings", "similarExpressions"] as const;
type ExpressionUpdate = Partial<Pick<Expression, "text" | "register" | "meanings" | "similarExpressions">>;

export async function updateExpressionAction(
  language: string,
  id: string,
  updates: ExpressionUpdate,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  const invalidKey = Object.keys(updates).find(
    (key) => !UPDATE_ALLOWED_KEYS.includes(key as (typeof UPDATE_ALLOWED_KEYS)[number]),
  );
  if (invalidKey) return { error: `허용되지 않은 필드입니다: ${invalidKey}` };

  try {
    await getAdminFirestore()
      .collection("expressions")
      .doc(language)
      .collection("items")
      .doc(id)
      .update(updates);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "수정 실패" };
  }
  revalidatePath("/admin/expressions");
  return {};
}

export async function deleteExpressionAction(language: string, id: string): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await getAdminFirestore().collection("expressions").doc(language).collection("items").doc(id).delete();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "삭제 실패" };
  }
  revalidatePath("/admin/expressions");
  return {};
}

export async function updateExpressionPoolConfigAction(
  language: string,
  targetSize: number,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  if (!Number.isInteger(targetSize) || targetSize < 0) {
    return { error: "목표 풀 크기는 0 이상의 정수여야 합니다" };
  }

  try {
    await getAdminFirestore()
      .collection("expressionPoolConfig")
      .doc(language)
      .set({ targetSize, updatedAt: new Date() }, { merge: true });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "설정 저장 실패" };
  }
  revalidatePath("/admin/expressions");
  return {};
}

export async function submitExpressionBatchAction(
  language: string,
  count: number,
): Promise<{ jobId?: string; error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    const result = await submitExpressionBatch(language, count);
    revalidatePath("/admin/expressions");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "생성 요청 실패" };
  }
}

export async function fetchMoreExpressionsAction(
  language: string,
  cursor: string,
): Promise<ExpressionsPage | { error: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  return listExpressions(language, cursor);
}
```

`fetchMoreExpressionsAction`도 다른 액션들과 동일하게 `getAdminSession()`을 재확인한다 — Server Action은 `(dashboard)` 레이아웃의 인증 게이트를 우회해 직접 호출될 수 있으므로, 표현 목록처럼 관리자 전용 데이터를 반환하는 조회 액션도 예외가 아니다(`lib/actions/adminStoryActions.ts`의 `fetchMorePublishedStoriesAction`과 동일한 `FetchMorePublishedStoriesResult`류 패턴 — 성공 시 `ExpressionsPage`, 실패 시 `{error}`).

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm run test -- lib/actions/expressionActions.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/actions/expressionActions.ts lib/actions/expressionActions.test.ts
git commit -m "feat: add expression pool server actions"
```

---

### Task 10: 페이지 + 네비게이션

**Files:**
- Modify: `app/admin/(dashboard)/layout.tsx:7-13` (NAV_ITEMS)
- Create: `app/admin/(dashboard)/expressions/page.tsx`
- Create: `app/admin/(dashboard)/expressions/loading.tsx`

**Interfaces:**
- Consumes: `LANG_NAMES` (Task 6), `listExpressions`/`listExpressionPoolConfigs`/`listExpressionBatchJobs` (Task 7)
- Produces: `/admin/expressions` 라우트. `ExpressionPoolManager`(Task 14)에 넘길 props 계약: `configs: ExpressionPoolConfigRow[]`, `initialLanguage: string`, `initialExpressionsPage: ExpressionsPage`, `initialJobs: ExpressionBatchJob[]`

- [ ] **Step 1: `layout.tsx`의 `NAV_ITEMS` 배열 수정**

`app/admin/(dashboard)/layout.tsx:7-13`을 아래로 교체:
```ts
const NAV_ITEMS = [
  { href: "/admin", label: "홈" },
  { href: "/admin/generation", label: "생성 진행상황" },
  { href: "/admin/review", label: "검토/게시" },
  { href: "/admin/quality", label: "품질 리포트" },
  { href: "/admin/word-cache", label: "단어캐시 현황" },
  { href: "/admin/expressions", label: "표현 풀 관리" },
];
```

- [ ] **Step 2: 페이지 구현**

`app/admin/(dashboard)/expressions/page.tsx`:
```tsx
import { LANG_NAMES } from "@/lib/constants/languages";
import { listExpressionPoolConfigs, listExpressions, listExpressionBatchJobs } from "@/lib/data/expressions";
import { ExpressionPoolManager } from "@/components/admin/ExpressionPoolManager";

const DEFAULT_LANGUAGE = "en";

export default async function ExpressionPoolPage() {
  const languages = Object.keys(LANG_NAMES);
  const [configs, initialExpressionsPage, initialJobs] = await Promise.all([
    listExpressionPoolConfigs(languages),
    listExpressions(DEFAULT_LANGUAGE),
    listExpressionBatchJobs(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">표현 풀 관리</h1>
        <p className="text-sm text-muted-foreground">
          언어별 표현 추천 풀을 조회·수정하고, 목표 풀 크기와 생성 작업 현황을 확인하세요.
        </p>
      </div>
      <ExpressionPoolManager
        configs={configs}
        initialLanguage={DEFAULT_LANGUAGE}
        initialExpressionsPage={initialExpressionsPage}
        initialJobs={initialJobs}
      />
    </div>
  );
}
```

`app/admin/(dashboard)/expressions/loading.tsx`:
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

이 태스크는 페이지 배선이라 Task 14(`ExpressionPoolManager` 완성) 이후에 통합 확인한다. 지금은 `ExpressionPoolManager`가 아직 없어 빌드가 실패하는 게 정상이다 — Task 14에서 해소된다.

- [ ] **Step 3: 커밋**

```bash
git add "app/admin/(dashboard)/layout.tsx" "app/admin/(dashboard)/expressions/page.tsx" "app/admin/(dashboard)/expressions/loading.tsx"
git commit -m "feat: add expression pool admin page scaffold"
```

---

### Task 11: 표현 수정 패널 (14개 언어 탭)

**Files:**
- Create: `components/admin/ExpressionEditPanel.tsx`

**Interfaces:**
- Consumes: `Expression` (Task 7), `MEANING_LANGUAGE_CODES`/`LANG_NAMES` (Task 6), `updateExpressionAction` (Task 9)
- Produces: `ExpressionEditPanel` — props `{ expression: Expression; language: string; onClose: () => void; onSaved: (updated: Expression) => void }`

- [ ] **Step 1: 구현**

`components/admin/ExpressionEditPanel.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import type { Expression } from "@/lib/data/expressions";
import { LANG_NAMES, MEANING_LANGUAGE_CODES } from "@/lib/constants/languages";
import { updateExpressionAction } from "@/lib/actions/expressionActions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InlineError } from "@/components/admin/InlineError";

export function ExpressionEditPanel({
  expression,
  language,
  onClose,
  onSaved,
}: {
  expression: Expression;
  language: string;
  onClose: () => void;
  onSaved: (updated: Expression) => void;
}) {
  const [text, setText] = useState(expression.text);
  const [register, setRegister] = useState(expression.register);
  const [similarExpressions, setSimilarExpressions] = useState(expression.similarExpressions.join(", "));
  const [meanings, setMeanings] = useState(expression.meanings);
  const [activeTab, setActiveTab] = useState(MEANING_LANGUAGE_CODES[0]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateMeaning(code: string, field: "definition" | "sentence" | "translation", value: string) {
    setMeanings((prev) => {
      const current = prev[code] ?? { definition: "", example: { sentence: "", translation: "" } };
      if (field === "definition") {
        return { ...prev, [code]: { ...current, definition: value } };
      }
      return { ...prev, [code]: { ...current, example: { ...current.example, [field]: value } } };
    });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const updates = {
        text,
        register,
        meanings,
        similarExpressions: similarExpressions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const result = await updateExpressionAction(language, expression.id, updates);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved({ ...expression, ...updates });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold">표현 수정</h2>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            표현 원형
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            register
            <select
              value={register}
              onChange={(e) => setRegister(e.target.value as Expression["register"])}
              className="w-fit rounded-md border border-input bg-background px-3 py-1.5"
            >
              <option value="casual">casual</option>
              <option value="formal">formal</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            비슷한 표현 (콤마로 구분)
            <input
              type="text"
              value={similarExpressions}
              onChange={(e) => setSimilarExpressions(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5"
            />
          </label>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as string)}>
          <TabsList className="flex-wrap">
            {MEANING_LANGUAGE_CODES.map((code) => (
              <TabsTrigger key={code} value={code}>
                {LANG_NAMES[code] ?? code}
              </TabsTrigger>
            ))}
          </TabsList>
          {MEANING_LANGUAGE_CODES.map((code) => {
            const meaning = meanings[code] ?? { definition: "", example: { sentence: "", translation: "" } };
            return (
              <TabsContent key={code} value={code}>
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    definition
                    <textarea
                      value={meaning.definition}
                      onChange={(e) => updateMeaning(code, "definition", e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-1.5"
                      rows={2}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    example.sentence
                    <textarea
                      value={meaning.example.sentence}
                      onChange={(e) => updateMeaning(code, "sentence", e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-1.5"
                      rows={2}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    example.translation
                    <textarea
                      value={meaning.example.translation}
                      onChange={(e) => updateMeaning(code, "translation", e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-1.5"
                      rows={2}
                    />
                  </label>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>

        {error && <InlineError message={error} />}

        <div className="mt-auto flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            취소
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add components/admin/ExpressionEditPanel.tsx
git commit -m "feat: add expression edit panel with per-language tabs"
```

---

### Task 12: 표현 목록 테이블

**Files:**
- Create: `components/admin/ExpressionsTable.tsx`

**Interfaces:**
- Consumes: `Expression`, `ExpressionsPage` (Task 7), `fetchMoreExpressionsAction`/`deleteExpressionAction` (Task 9), `ExpressionEditPanel` (Task 11)
- Produces: `ExpressionsTable` — props `{ language: string; initialPage: ExpressionsPage }`

이 컴포넌트는 목록·검색·삭제뿐 아니라 "수정" 패널의 표시 여부와 저장 결과 반영까지 스스로 책임진다(부모인 `ExpressionPoolManager`는 언어 전환 시에만 `initialPage`를 새로 내려주고, 개별 항목 수정 결과는 알 필요가 없다) — 그래야 언어 전환용 리셋 로직이 항목 수정 때마다 오발동해 "더 보기"로 불러온 추가 페이지가 날아가는 문제를 피할 수 있다.

- [ ] **Step 1: 구현**

`components/admin/ExpressionsTable.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import type { Expression, ExpressionsPage } from "@/lib/data/expressions";
import { fetchMoreExpressionsAction, deleteExpressionAction } from "@/lib/actions/expressionActions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { InlineError } from "@/components/admin/InlineError";
import { ExpressionEditPanel } from "@/components/admin/ExpressionEditPanel";

export function ExpressionsTable({
  language,
  initialPage,
}: {
  language: string;
  initialPage: ExpressionsPage;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Expression | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [prevInitialPage, setPrevInitialPage] = useState(initialPage);

  // 언어를 바꾸면 부모가 새 initialPage를 내려준다 — 렌더 중 상태 조정으로 로컬 상태를 그 언어
  // 기준으로 리셋한다(PublishedStoriesTable.tsx와 동일한 패턴 — useEffect가 아니라 렌더 본문에서
  // 직접 setState하는 이유는 CLAUDE.md에 문서화된 이 코드베이스의 관례이자, react-hooks의
  // set-state-in-effect 린트 규칙이 정확히 이 이유로 금지하는 패턴이기 때문이다).
  // 항목 수정/삭제는 이 컴포넌트 내부 상태만 바꾸고 initialPage를 건드리지 않으므로,
  // 이 조정은 진짜 언어 전환 때만 발동한다(수정 저장 후 재실행되지 않음).
  if (prevInitialPage !== initialPage) {
    setPrevInitialPage(initialPage);
    setItems(initialPage.items);
    setCursor(initialPage.nextCursor);
    setSearch("");
    setEditing(null);
    setError(null);
  }

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      try {
        const page = await fetchMoreExpressionsAction(language, cursor);
        if ("error" in page) {
          setError(page.error);
          return;
        }
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "목록을 더 불러오지 못했습니다");
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteExpressionAction(language, id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    });
  }

  const visible = items.filter((item) => item.text.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="표현 검색..."
        className="w-64 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>표현</TableHead>
            <TableHead>register</TableHead>
            <TableHead>비슷한 표현</TableHead>
            <TableHead>한국어 뜻</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.text}</TableCell>
              <TableCell>{item.register}</TableCell>
              <TableCell>{item.similarExpressions.length}개</TableCell>
              <TableCell className="max-w-xs truncate">{item.meanings.ko?.definition ?? "-"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(item)}>
                    수정
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleDelete(item.id)}
                  >
                    삭제
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && <EmptyTableRow colSpan={5} message="표현이 없습니다." />}
        </TableBody>
      </Table>
      {error && <InlineError message={error} />}
      {cursor && (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={isPending} onClick={handleLoadMore}>
          {isPending ? "불러오는 중..." : "더 보기"}
        </Button>
      )}
      {editing && (
        <ExpressionEditPanel
          expression={editing}
          language={language}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
```

이 컴포넌트는 `ExpressionEditPanel`(Task 11)을 직접 참조하므로 Task 11 이후에 만든다. Task 14에서 `ExpressionPoolManager`에 연결한 뒤 실제 화면에서 동작을 확인한다(개별 렌더 테스트 인프라 없음 — CLAUDE.md 정책).

- [ ] **Step 2: 커밋**

```bash
git add components/admin/ExpressionsTable.tsx
git commit -m "feat: add expression list table with search and delete"
```

---

### Task 13: 배치 작업 현황 테이블

**Files:**
- Create: `components/admin/ExpressionBatchJobsTable.tsx`

**Interfaces:**
- Consumes: `ExpressionBatchJob` (Task 7)
- Produces: `ExpressionBatchJobsTable` — props `{ jobs: ExpressionBatchJob[] }`

- [ ] **Step 1: 구현**

`components/admin/ExpressionBatchJobsTable.tsx`:
```tsx
import type { ExpressionBatchJob } from "@/lib/data/expressions";
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

export function ExpressionBatchJobsTable({ jobs }: { jobs: ExpressionBatchJob[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>상태</TableHead>
          <TableHead>언어</TableHead>
          <TableHead>개수</TableHead>
          <TableHead>요청</TableHead>
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
            <TableCell className="text-muted-foreground">{new Date(job.createdAt).toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-muted-foreground">
              {job.completedAt ? new Date(job.completedAt).toLocaleString("ko-KR") : "-"}
            </TableCell>
            <TableCell className="max-w-xs truncate text-destructive">{job.error ?? "-"}</TableCell>
          </TableRow>
        ))}
        {jobs.length === 0 && <EmptyTableRow colSpan={7} message="생성 작업 이력이 없습니다." />}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add components/admin/ExpressionBatchJobsTable.tsx
git commit -m "feat: add expression batch job status table"
```

---

### Task 14: 오케스트레이터 컴포넌트 (언어 선택 · 목표 풀 크기 · 수동 생성)

**Files:**
- Create: `components/admin/ExpressionPoolManager.tsx`

**Interfaces:**
- Consumes: `ExpressionPoolConfigRow`, `ExpressionsPage`, `ExpressionBatchJob` (Task 7); `updateExpressionPoolConfigAction`, `submitExpressionBatchAction` (Task 9); `LANG_NAMES` (Task 6); `ExpressionsTable` (Task 12, 내부에서 `ExpressionEditPanel`을 스스로 소유); `ExpressionBatchJobsTable` (Task 13)
- Produces: `ExpressionPoolManager` — props `{ configs: ExpressionPoolConfigRow[]; initialLanguage: string; initialExpressionsPage: ExpressionsPage; initialJobs: ExpressionBatchJob[] }` (Task 10의 `page.tsx`가 넘기는 계약과 동일)

- [ ] **Step 1: 구현**

`components/admin/ExpressionPoolManager.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import type { ExpressionPoolConfigRow, ExpressionsPage, ExpressionBatchJob } from "@/lib/data/expressions";
import { LANG_NAMES } from "@/lib/constants/languages";
import { fetchMoreExpressionsAction, updateExpressionPoolConfigAction, submitExpressionBatchAction } from "@/lib/actions/expressionActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineError } from "@/components/admin/InlineError";
import { ExpressionsTable } from "@/components/admin/ExpressionsTable";
import { ExpressionBatchJobsTable } from "@/components/admin/ExpressionBatchJobsTable";

export function ExpressionPoolManager({
  configs,
  initialLanguage,
  initialExpressionsPage,
  initialJobs,
}: {
  configs: ExpressionPoolConfigRow[];
  initialLanguage: string;
  initialExpressionsPage: ExpressionsPage;
  initialJobs: ExpressionBatchJob[];
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const [expressionsPage, setExpressionsPage] = useState(initialExpressionsPage);
  const [jobs] = useState(initialJobs);
  const [targetSizeInput, setTargetSizeInput] = useState(
    String(configs.find((c) => c.language === initialLanguage)?.targetSize ?? 0),
  );
  const [overrideCount, setOverrideCount] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentConfig = configs.find((c) => c.language === language);

  function handleLanguageChange(next: string) {
    setLanguage(next);
    setTargetSizeInput(String(configs.find((c) => c.language === next)?.targetSize ?? 0));
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const page = await fetchMoreExpressionsAction(next, "");
      if ("error" in page) {
        setError(page.error);
        return;
      }
      setExpressionsPage(page);
    });
  }

  function handleSaveTargetSize() {
    const targetSize = Number(targetSizeInput);
    setError(null);
    startTransition(async () => {
      const result = await updateExpressionPoolConfigAction(language, targetSize);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice("목표 풀 크기를 저장했습니다.");
    });
  }

  function handleSubmitOverride() {
    const count = Number(overrideCount);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await submitExpressionBatchAction(language, count);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(`생성 작업을 제출했습니다 (jobId: ${result.jobId}). 완료되면 자동으로 풀에 반영됩니다.`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          언어
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="w-fit rounded-md border border-input bg-background px-3 py-1.5"
          >
            {Object.entries(LANG_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          현재 풀 크기
          <span className="px-1 py-1.5 font-medium">{currentConfig?.currentCount ?? 0}개</span>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          목표 풀 크기
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={targetSizeInput}
              onChange={(e) => setTargetSizeInput(e.target.value)}
              className="w-24 rounded-md border border-input bg-background px-3 py-1.5"
            />
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleSaveTargetSize}>
              저장
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          지금 바로 생성
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={50}
              value={overrideCount}
              onChange={(e) => setOverrideCount(e.target.value)}
              className="w-20 rounded-md border border-input bg-background px-3 py-1.5"
            />
            <Button type="button" size="sm" disabled={isPending} onClick={handleSubmitOverride}>
              생성
            </Button>
          </div>
        </label>
      </div>

      {error && <InlineError message={error} />}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <Card>
        <CardContent>
          <ExpressionsTable language={language} initialPage={expressionsPage} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">생성 작업 현황</h2>
        <Card>
          <CardContent>
            <ExpressionBatchJobsTable jobs={jobs.filter((j) => j.language === language)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

`ExpressionsTable`이 수정 패널을 스스로 소유하므로(Task 12), 여기서는 개별 항목 수정 결과를 알 필요가 없다 — `expressionsPage` state는 오직 언어 전환 시에만 바뀐다.

`fetchMoreExpressionsAction(next, "")`로 언어 전환 시 첫 페이지를 다시 불러오는 부분은, `lib/actions/expressionActions.ts`의 `fetchMoreExpressionsAction`이 내부적으로 `listExpressions(language, cursor)`를 호출하고 `listExpressions`는 `cursor`가 빈 문자열이면 falsy로 처리되어 첫 페이지를 반환한다(Task 7의 `if (cursor)` 분기 참고) — 별도 액션을 추가하지 않고 기존 함수를 재사용한다.

- [ ] **Step 2: 개발 서버로 수동 확인**

Run: `npm run dev`

브라우저에서 `/admin/expressions` 접속 후 확인:
- 언어를 바꾸면 표현 목록과 목표 풀 크기 입력값이 그 언어 것으로 바뀌는지
- "수정" 클릭 시 우측 패널이 뜨고 14개 언어 탭이 전환되는지, 저장 시 목록에 반영되는지
- "삭제" 클릭 시 목록에서 즉시 사라지는지
- 목표 풀 크기 저장, "지금 바로 생성" 제출이 에러 없이 동작하는지(실제 Gemini 호출은 스테이징에서 별도 검증 — Task 15)

- [ ] **Step 3: 커밋**

```bash
git add components/admin/ExpressionPoolManager.tsx
git commit -m "feat: wire up expression pool admin screen"
```

---

### Task 15: 전체 검증

**Files:** 없음(검증만)

- [ ] **Step 1: word-bank 전체 검증**

Run:
```bash
npm --prefix functions test
npm --prefix functions run build
```
Expected: 둘 다 성공

- [ ] **Step 2: word-bank-web 전체 검증**

Run:
```bash
npm run lint
npm run test
npm run build
```
Expected: 셋 다 성공

- [ ] **Step 3: 수동 검증 체크리스트 (스테이징/로컬 Firebase 프로젝트, 실제 Gemini API 키 필요)**

- [ ] `expressionPoolConfig/{언어}` 문서를 하나 만들고 `targetSize`를 현재 풀 크기보다 크게 설정한 뒤 `topUpExpressionPools`를 수동 트리거해 `expressionBatchJobs`에 `pending` job이 생기는지 확인
- [ ] `pollExpressionBatchJobs`를 수동 트리거해(또는 30분 대기) job이 `succeeded`로 바뀌고 `expressions/{언어}/items`에 새 문서가 쌓이는지 확인 — 이 시점에 Gemini Batch API 응답의 실제 필드 경로(`output.inlinedResponses[0].response...`)가 Task 5에서 작성한 코드와 일치하는지 반드시 확인하고, 다르면 `expressionBatchPoller.ts`의 파싱 로직을 실제 응답에 맞게 수정
- [ ] `/admin/expressions`에서 "지금 바로 생성" 오버라이드가 `adminSubmitExpressionBatch`를 호출해 새 job을 만드는지 확인
- [ ] `/admin/expressions`에서 표현 수정/삭제/목표 풀 크기 저장이 실제 Firestore에 반영되는지 확인
- [ ] 목표 풀 크기를 현재 크기 이하로 낮추면 `topUpExpressionPools`가 아무 것도 제출하지 않는지 확인

- [ ] **Step 4: 커밋 (검증 중 발견한 수정사항이 있었다면)**

수동 검증에서 Gemini Batch API 응답 파싱 경로를 수정했다면:
```bash
git add functions/src/expressionBatchPoller.ts functions/src/expressionBatchPoller.test.ts
git commit -m "fix: correct Gemini batch response field paths per live API"
```
