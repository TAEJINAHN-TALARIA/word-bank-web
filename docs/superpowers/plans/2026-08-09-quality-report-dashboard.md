# Quality Report Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new admin dashboard page (`/admin/quality`) that reads the weekly word-quality analysis data already being produced by `word-bank`'s `analyzeWordFixReports` scheduled Cloud Function, and lets an admin restore words that were auto-hidden by user misreports.

**Architecture:** Everything lives in `word-bank-web` — no changes to `word-bank`. All data access goes through `getAdminFirestore()` (the project's existing direct Firebase Admin SDK connection to `wordbank-6284f`, already used by `lib/data/stories.ts` and `lib/data/pipelineSessions.ts`), reading three collections `word-bank`'s Cloud Functions already populate: `prompt_analysis_reports` (weekly AI analysis, read-only), `word_fix_reports` (raw user feedback, read-only), and `word_cache` (read for the auto-hidden queue, written by a new admin Server Action to reset `reportCount`). No new Cloud Function is needed — the "restore" write goes straight through the Admin SDK inside a Next.js Server Action gated by `getAdminSession()`, mirroring the existing `lib/actions/adminStoryActions.ts` pattern (not the `adminPublishStory` pattern from the spec, which is a different Firebase project authenticated by a shared HTTP secret — that pattern doesn't apply here).

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React 19, TypeScript, Tailwind + shadcn/ui primitives (`Card`, `Table`, `Tabs`, `Badge`, `Button`), `firebase-admin` (already installed). New dependencies added by this plan: **Vitest** (no test framework exists in this repo yet), **recharts** (line/bar charts — no chart library exists yet), **react-markdown** (renders the AI analysis text — no markdown renderer exists yet).

## Global Constraints

- No change to `word-bank` (the other repo) — everything here is additive, inside `word-bank-web`.
- Restore is a Server Action using direct Admin SDK writes, NOT a new Cloud Function — this deviates from `docs/superpowers/specs/2026-08-08-quality-report-dashboard-design.md`'s "복구 액션" section, which incorrectly modeled it on `adminPublishStory` (a different Firebase project, shared-secret HTTP auth). The correct reference pattern is `lib/actions/adminStoryActions.ts` (Server Action + `getAdminSession()` + direct write).
- Admin gating already happens once at `app/admin/(dashboard)/layout.tsx` (redirects to login if `getAdminSession()` returns null) — new pages under that route group inherit it for free. The Server Action still re-checks `getAdminSession()` itself (Server Actions can be invoked directly, not only via the gated page), matching `adminStoryActions.ts`'s existing pattern.
- Firestore access in tests is mocked at the `getAdminFirestore()` boundary (matching `word-bank/functions/src/*.test.ts`'s established mocking style) — no Firestore emulator is stood up for this plan. Component rendering tests are out of scope (no `@testing-library/react` installed, not requested) — Vitest tests cover the `lib/data/*` and `lib/actions/*` business logic only.
- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- No i18n layer for these admin pages — existing admin components (`ReviewTabs.tsx`, `app/admin/(dashboard)/page.tsx`) hardcode Korean strings directly rather than using `next-intl`; follow that convention.
- `prompt_analysis_reports` doc shape (from `word-bank/functions/src/analyzeReports.ts:176-185`, verified against current source): `{ periodStart: Timestamp, periodEnd: Timestamp, reportCount: number, fieldBreakdown: Record<string, number>, languageBreakdown: Record<string, number>, feedbackCount: number, analysis: string, createdAt: Timestamp }`.
- `word_fix_reports` doc shape (from `word-bank/functions/src/analyzeReports.ts:21-29`): `{ word: string, wordLanguage: string, meaningLanguage: string, flaggedFields: string[], userFeedback: string | null, before: object, after: object, createdAt: Timestamp }`.
- `word_cache` doc fields relevant here (from `word-bank/functions/src/index.ts`'s `cacheWordResult`): `word`, `wordLanguage`, `meaningLanguage`, `reportCount: number`, `updatedAt: Timestamp`. Doc ID is the cache key (`buildCacheKey`-derived string), not a random ID.

---

### Task 1: Install and configure Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script, add `vitest` devDependency)
- Create: `lib/smokeTest.test.ts` (throwaway proof the runner works — this file is deleted at the end of this task once Task 2 has a real test to prove it instead)

**Interfaces:**
- Produces: `npm test` runs Vitest once (CI-friendly, no watch mode).

- [ ] **Step 1: Install Vitest**

Run: `cd "C:\Users\TAEJIN\Documents\word-bank-web" && npm install --save-dev vitest`

- [ ] **Step 2: Add the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:
```json
    "test": "vitest run",
```

- [ ] **Step 4: Write a smoke test, verify it fails, then passes**

Create `lib/smokeTest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: PASS, 1/1 test (this one can't meaningfully "fail first" — it's infrastructure proof, not a behavior spec; the real RED/GREEN cycle starts in Task 2).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json lib/smokeTest.test.ts
git commit -m "chore: add Vitest test runner"
```

---

### Task 2: `lib/data/promptAnalysisReports.ts` — weekly AI analysis queries

**Files:**
- Create: `lib/data/promptAnalysisReports.ts`
- Create: `lib/data/promptAnalysisReports.test.ts`
- Delete: `lib/smokeTest.test.ts` (superseded by this task's real tests)

**Interfaces:**
- Produces:
  ```ts
  export interface PromptAnalysisReport {
    id: string;
    periodStart: string;   // ISO string
    periodEnd: string;     // ISO string
    reportCount: number;
    fieldBreakdown: Record<string, number>;
    languageBreakdown: Record<string, number>;
    feedbackCount: number;
    analysis: string;
    createdAt: string;     // ISO string
  }
  export async function listPromptAnalysisReports(): Promise<PromptAnalysisReport[]>;
  ```
  Ordered oldest-first (ascending `periodStart`) — the trend chart (Task 6) wants chronological order; the latest report is `list[list.length - 1]`. Used by Task 6 (trend chart), Task 7 (breakdown charts), Task 8 (analysis viewer), and Task 11 (the page that composes them).

- [ ] **Step 1: Delete the smoke test, write the failing test**

Delete `lib/smokeTest.test.ts`.

Create `lib/data/promptAnalysisReports.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockOrderBy = vi.fn(() => ({ get: mockGet }));
const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockGetAdminFirestore = vi.fn(() => ({ collection: mockCollection }));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

import { listPromptAnalysisReports } from './promptAnalysisReports';

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('listPromptAnalysisReports', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockOrderBy.mockClear();
    mockCollection.mockClear();
  });

  it('prompt_analysis_reports를 periodStart 오름차순으로 조회한다', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'r1',
          data: () => ({
            periodStart: makeTimestamp('2026-08-01T00:00:00.000Z'),
            periodEnd: makeTimestamp('2026-08-08T00:00:00.000Z'),
            reportCount: 5,
            fieldBreakdown: { meanings: 3, phonetic: 2 },
            languageBreakdown: { en: 4, ko: 1 },
            feedbackCount: 2,
            analysis: '## Key Patterns\n...',
            createdAt: makeTimestamp('2026-08-08T00:05:00.000Z'),
          }),
        },
      ],
    });

    const result = await listPromptAnalysisReports();

    expect(mockCollection).toHaveBeenCalledWith('prompt_analysis_reports');
    expect(mockOrderBy).toHaveBeenCalledWith('periodStart', 'asc');
    expect(result).toEqual([
      {
        id: 'r1',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-08T00:00:00.000Z',
        reportCount: 5,
        fieldBreakdown: { meanings: 3, phonetic: 2 },
        languageBreakdown: { en: 4, ko: 1 },
        feedbackCount: 2,
        analysis: '## Key Patterns\n...',
        createdAt: '2026-08-08T00:05:00.000Z',
      },
    ]);
  });

  it('리포트가 하나도 없으면 빈 배열을 반환한다', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });

    const result = await listPromptAnalysisReports();

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- promptAnalysisReports`
Expected: FAIL — `lib/data/promptAnalysisReports.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/data/promptAnalysisReports.ts`:
```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export interface PromptAnalysisReport {
  id: string;
  periodStart: string;
  periodEnd: string;
  reportCount: number;
  fieldBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  feedbackCount: number;
  analysis: string;
  createdAt: string;
}

export async function listPromptAnalysisReports(): Promise<PromptAnalysisReport[]> {
  const db = getAdminFirestore();
  const snapshot = await db.collection("prompt_analysis_reports").orderBy("periodStart", "asc").get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      periodStart: data.periodStart.toDate().toISOString(),
      periodEnd: data.periodEnd.toDate().toISOString(),
      reportCount: data.reportCount,
      fieldBreakdown: data.fieldBreakdown ?? {},
      languageBreakdown: data.languageBreakdown ?? {},
      feedbackCount: data.feedbackCount,
      analysis: data.analysis,
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- promptAnalysisReports`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/promptAnalysisReports.ts lib/data/promptAnalysisReports.test.ts
git rm lib/smokeTest.test.ts
git commit -m "feat: add listPromptAnalysisReports data query"
```

---

### Task 3: `lib/data/wordFixReports.ts` — user feedback list, paginated

**Files:**
- Create: `lib/data/wordFixReports.ts`
- Create: `lib/data/wordFixReports.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WordFixFeedbackItem {
    id: string;
    word: string;
    wordLanguage: string;
    meaningLanguage: string;
    userFeedback: string;
    createdAt: string; // ISO string
  }
  export interface WordFixFeedbackPage {
    items: WordFixFeedbackItem[];
    nextCursor: string | null; // pass back into the next call's `cursor` param; null = no more pages
  }
  export async function listUserFeedback(cursor?: string, pageSize?: number): Promise<WordFixFeedbackPage>;
  ```
  Default `pageSize` is 20. Ordered newest-first (descending `createdAt`), filtered to `userFeedback != null`. `nextCursor` is the last item's Firestore doc ID in the page (used with `startAfter` via a doc reference lookup) — used by Task 9 (feedback list UI) and Task 11.

- [ ] **Step 1: Write the failing tests**

Create `lib/data/wordFixReports.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockLimit = vi.fn(() => ({ get: mockGet }));
const mockStartAfter = vi.fn(() => ({ limit: mockLimit }));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit, startAfter: mockStartAfter }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockDocGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockDocGet }));
const mockCollection = vi.fn(() => ({ where: mockWhere, doc: mockDoc }));
const mockGetAdminFirestore = vi.fn(() => ({ collection: mockCollection }));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

import { listUserFeedback } from './wordFixReports';

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

function makeDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      word: 'run', wordLanguage: 'en', meaningLanguage: 'ko',
      userFeedback: '뜻이 이상해요', createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
      ...overrides,
    }),
  };
}

describe('listUserFeedback', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDocGet.mockReset();
    mockLimit.mockClear();
    mockStartAfter.mockClear();
    mockOrderBy.mockClear();
    mockWhere.mockClear();
    mockCollection.mockClear();
  });

  it('userFeedback != null 조건으로 최신순 페이지를 가져오고, 다음 페이지가 있으면 nextCursor를 채운다', async () => {
    // pageSize=1 요청 시 pageSize+1개를 가져와 "더 있는지" 판단한다
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('f1'), makeDoc('f2')] });

    const result = await listUserFeedback(undefined, 1);

    expect(mockWhere).toHaveBeenCalledWith('userFeedback', '!=', null);
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockLimit).toHaveBeenCalledWith(2); // pageSize + 1
    expect(result.items).toEqual([
      { id: 'f1', word: 'run', wordLanguage: 'en', meaningLanguage: 'ko', userFeedback: '뜻이 이상해요', createdAt: '2026-08-05T00:00:00.000Z' },
    ]);
    expect(result.nextCursor).toBe('f1');
  });

  it('남은 항목이 pageSize 이하이면 nextCursor는 null이다', async () => {
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('f1')] });

    const result = await listUserFeedback(undefined, 1);

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('cursor가 주어지면 해당 문서 이후부터 조회한다', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: true, id: 'f1' });
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('f2')] });

    await listUserFeedback('f1', 20);

    expect(mockDoc).toHaveBeenCalledWith('f1');
    expect(mockStartAfter).toHaveBeenCalled();
  });

  it('결과가 없으면 빈 items와 null cursor를 반환한다', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });

    const result = await listUserFeedback();

    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- wordFixReports`
Expected: FAIL — `lib/data/wordFixReports.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/data/wordFixReports.ts`:
```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export interface WordFixFeedbackItem {
  id: string;
  word: string;
  wordLanguage: string;
  meaningLanguage: string;
  userFeedback: string;
  createdAt: string;
}

export interface WordFixFeedbackPage {
  items: WordFixFeedbackItem[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;

export async function listUserFeedback(
  cursor?: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<WordFixFeedbackPage> {
  const db = getAdminFirestore();
  let query = db
    .collection("word_fix_reports")
    .where("userFeedback", "!=", null)
    .orderBy("createdAt", "desc");

  if (cursor) {
    const cursorDoc = await db.collection("word_fix_reports").doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.limit(pageSize + 1).get();
  const hasMore = snapshot.docs.length > pageSize;
  const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

  const items = pageDocs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      word: data.word,
      wordLanguage: data.wordLanguage,
      meaningLanguage: data.meaningLanguage,
      userFeedback: data.userFeedback,
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });

  return {
    items,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- wordFixReports`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/wordFixReports.ts lib/data/wordFixReports.test.ts
git commit -m "feat: add listUserFeedback paginated data query"
```

---

### Task 4: `lib/data/wordCacheQueue.ts` — auto-hidden word queue

**Files:**
- Create: `lib/data/wordCacheQueue.ts`
- Create: `lib/data/wordCacheQueue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AutoHiddenWord {
    cacheKey: string;
    word: string;
    wordLanguage: string;
    meaningLanguage: string;
    reportCount: number;
    updatedAt: string; // ISO string
  }
  export async function listAutoHiddenWords(): Promise<AutoHiddenWord[]>;
  ```
  Used by Task 10 (auto-hidden queue UI) and Task 11.

- [ ] **Step 1: Write the failing tests**

Create `lib/data/wordCacheQueue.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockOrderBy = vi.fn(() => ({ get: mockGet }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockCollection = vi.fn(() => ({ where: mockWhere }));
const mockGetAdminFirestore = vi.fn(() => ({ collection: mockCollection }));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

import { listAutoHiddenWords } from './wordCacheQueue';

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('listAutoHiddenWords', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockOrderBy.mockClear();
    mockWhere.mockClear();
    mockCollection.mockClear();
  });

  it('reportCount >= 3인 word_cache 문서를 최근 갱신순으로 조회한다', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'run_en_ko',
          data: () => ({
            word: 'run', wordLanguage: 'en', meaningLanguage: 'ko',
            reportCount: 4, updatedAt: makeTimestamp('2026-08-07T00:00:00.000Z'),
          }),
        },
      ],
    });

    const result = await listAutoHiddenWords();

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(mockWhere).toHaveBeenCalledWith('reportCount', '>=', 3);
    expect(mockOrderBy).toHaveBeenCalledWith('updatedAt', 'desc');
    expect(result).toEqual([
      { cacheKey: 'run_en_ko', word: 'run', wordLanguage: 'en', meaningLanguage: 'ko', reportCount: 4, updatedAt: '2026-08-07T00:00:00.000Z' },
    ]);
  });

  it('대기열이 비어있으면 빈 배열을 반환한다', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });

    const result = await listAutoHiddenWords();

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- wordCacheQueue`
Expected: FAIL — `lib/data/wordCacheQueue.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/data/wordCacheQueue.ts`:
```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export interface AutoHiddenWord {
  cacheKey: string;
  word: string;
  wordLanguage: string;
  meaningLanguage: string;
  reportCount: number;
  updatedAt: string;
}

export async function listAutoHiddenWords(): Promise<AutoHiddenWord[]> {
  const db = getAdminFirestore();
  const snapshot = await db
    .collection("word_cache")
    .where("reportCount", ">=", 3)
    .orderBy("updatedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      cacheKey: doc.id,
      word: data.word,
      wordLanguage: data.wordLanguage,
      meaningLanguage: data.meaningLanguage,
      reportCount: data.reportCount,
      updatedAt: data.updatedAt.toDate().toISOString(),
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- wordCacheQueue`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/wordCacheQueue.ts lib/data/wordCacheQueue.test.ts
git commit -m "feat: add listAutoHiddenWords data query"
```

---

### Task 5: `lib/actions/wordCacheActions.ts` — restore Server Action

**Files:**
- Create: `lib/actions/wordCacheActions.ts`
- Create: `lib/actions/wordCacheActions.test.ts`

**Interfaces:**
- Produces: `export async function restoreWordCacheEntryAction(cacheKey: string): Promise<{ error?: string }>` — mirrors `adminStoryActions.ts`'s `{ error?: string }` return contract exactly (empty object = success). Used by Task 10.

- [ ] **Step 1: Write the failing tests**

Create `lib/actions/wordCacheActions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn();
const mockDoc = vi.fn(() => ({ update: mockUpdate }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
const mockGetAdminFirestore = vi.fn(() => ({ collection: mockCollection }));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

const mockGetAdminSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getAdminSession: mockGetAdminSession,
}));

const mockRevalidatePath = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

import { restoreWordCacheEntryAction } from './wordCacheActions';

describe('restoreWordCacheEntryAction', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockDoc.mockClear();
    mockCollection.mockClear();
    mockGetAdminSession.mockReset();
    mockRevalidatePath.mockClear();
  });

  it('관리자 세션이 없으면 에러를 반환하고 Firestore를 건드리지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await restoreWordCacheEntryAction('run_en_ko');

    expect(result).toEqual({ error: '관리자 로그인이 필요합니다' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('관리자 세션이 있으면 reportCount를 0으로 리셋하고 페이지를 재검증한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    mockUpdate.mockResolvedValueOnce(undefined);

    const result = await restoreWordCacheEntryAction('run_en_ko');

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(mockDoc).toHaveBeenCalledWith('run_en_ko');
    expect(mockUpdate).toHaveBeenCalledWith({ reportCount: 0 });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/quality');
    expect(result).toEqual({});
  });

  it('Firestore 쓰기가 실패하면 에러 메시지를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    mockUpdate.mockRejectedValueOnce(new Error('문서를 찾을 수 없습니다'));

    const result = await restoreWordCacheEntryAction('nonexistent_en_ko');

    expect(result).toEqual({ error: '문서를 찾을 수 없습니다' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- wordCacheActions`
Expected: FAIL — `lib/actions/wordCacheActions.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/actions/wordCacheActions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";

export async function restoreWordCacheEntryAction(
  cacheKey: string,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await getAdminFirestore().collection("word_cache").doc(cacheKey).update({ reportCount: 0 });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "복구 실패" };
  }
  revalidatePath("/admin/quality");
  return {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- wordCacheActions`
Expected: PASS, 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/wordCacheActions.ts lib/actions/wordCacheActions.test.ts
git commit -m "feat: add restoreWordCacheEntryAction server action"
```

---

### Task 6: Install chart/markdown deps + `QualityTrendChart` component

**Files:**
- Modify: `package.json` (add `recharts`, `react-markdown`)
- Create: `components/admin/QualityTrendChart.tsx`

**Interfaces:**
- Consumes: `PromptAnalysisReport[]` from Task 2.
- Produces: `export function QualityTrendChart({ reports }: { reports: PromptAnalysisReport[] }): JSX.Element` — a `"use client"` component (recharts needs the browser). Used by Task 11.

No test for this task — it's a thin recharts wrapper with no business logic to unit test, and this plan's testing scope (per Global Constraints) excludes component rendering. Both new dependencies are installed here since Task 6-8 all need one or the other and this is the first task that needs either.

- [ ] **Step 1: Install the dependencies**

Run: `cd "C:\Users\TAEJIN\Documents\word-bank-web" && npm install recharts react-markdown`

- [ ] **Step 2: Build the component**

Create `components/admin/QualityTrendChart.tsx`:
```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { PromptAnalysisReport } from "@/lib/data/promptAnalysisReports";

export function QualityTrendChart({ reports }: { reports: PromptAnalysisReport[] }) {
  const data = reports.map((r) => ({
    period: new Date(r.periodStart).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
    reportCount: r.reportCount,
  }));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">아직 주간 리포트가 없습니다.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="period" fontSize={12} />
        <YAxis allowDecimals={false} fontSize={12} />
        <Tooltip />
        <Line type="monotone" dataKey="reportCount" name="신고 건수" stroke="currentColor" className="text-primary" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/admin/QualityTrendChart.tsx
git commit -m "feat: add recharts/react-markdown deps and QualityTrendChart"
```

---

### Task 7: `QualityBreakdownCharts` component (field + language bar charts)

**Files:**
- Create: `components/admin/QualityBreakdownCharts.tsx`

**Interfaces:**
- Consumes: a single `PromptAnalysisReport` (the latest one) from Task 2's return type.
- Produces: `export function QualityBreakdownCharts({ report }: { report: PromptAnalysisReport | undefined }): JSX.Element`. Used by Task 11.

- [ ] **Step 1: Build the component**

Create `components/admin/QualityBreakdownCharts.tsx`:
```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { PromptAnalysisReport } from "@/lib/data/promptAnalysisReports";

function toChartData(breakdown: Record<string, number>) {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function BreakdownBarChart({ data, emptyLabel }: { data: { name: string; count: number }[]; emptyLabel: string }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis type="number" allowDecimals={false} fontSize={12} />
        <YAxis type="category" dataKey="name" fontSize={12} width={100} />
        <Tooltip />
        <Bar dataKey="count" fill="currentColor" className="text-primary" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function QualityBreakdownCharts({ report }: { report: PromptAnalysisReport | undefined }) {
  if (!report) {
    return <p className="text-sm text-muted-foreground">이번 주 신고 없음.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">필드별</h3>
        <BreakdownBarChart data={toChartData(report.fieldBreakdown)} emptyLabel="필드별 데이터 없음" />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">언어별</h3>
        <BreakdownBarChart data={toChartData(report.languageBreakdown)} emptyLabel="언어별 데이터 없음" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/QualityBreakdownCharts.tsx
git commit -m "feat: add QualityBreakdownCharts component"
```

---

### Task 8: `AnalysisViewer` component (markdown + past-report dropdown)

**Files:**
- Create: `components/admin/AnalysisViewer.tsx`

**Interfaces:**
- Consumes: `PromptAnalysisReport[]` from Task 2 (same list Task 6 gets — pass the whole array, this component picks which one to show).
- Produces: `export function AnalysisViewer({ reports }: { reports: PromptAnalysisReport[] }): JSX.Element`. Used by Task 11.

- [ ] **Step 1: Build the component**

Create `components/admin/AnalysisViewer.tsx`:
```tsx
"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { PromptAnalysisReport } from "@/lib/data/promptAnalysisReports";

export function AnalysisViewer({ reports }: { reports: PromptAnalysisReport[] }) {
  const sorted = [...reports].reverse(); // newest first for the dropdown
  const [selectedId, setSelectedId] = useState(sorted[0]?.id ?? "");
  const selected = sorted.find((r) => r.id === selectedId);

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">이번 주 신고 없음.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-fit rounded-md border border-border bg-background px-3 py-1.5 text-sm"
      >
        {sorted.map((r) => (
          <option key={r.id} value={r.id}>
            {new Date(r.periodStart).toLocaleDateString("ko-KR")} ~ {new Date(r.periodEnd).toLocaleDateString("ko-KR")}
          </option>
        ))}
      </select>
      {selected && (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{selected.analysis}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AnalysisViewer.tsx
git commit -m "feat: add AnalysisViewer component"
```

**Note for the implementer:** `<article className="prose ...">` uses Tailwind Typography classes. Check whether `@tailwindcss/typography` is already configured (search `tailwind.config.*` / `app/globals.css` for `@plugin` or a `prose` reference). If it isn't installed, the `prose` classes will no-op (markdown still renders, just unstyled — headings/lists won't get spacing/weight treatment). That's a visual nice-to-have, not a functional break, so don't block this task on it — but note in your report whether you found the plugin configured, so a follow-up can add it if not.

---

### Task 9: `UserFeedbackList` component (paginated table)

**Files:**
- Create: `components/admin/UserFeedbackList.tsx`

**Interfaces:**
- Consumes: `WordFixFeedbackPage` (Task 3's return shape) as the initial page, plus needs a client-callable way to fetch more — pass `listUserFeedback` is a server-only function and can't be called from a client component directly, so this component needs a thin Server Action wrapper.
- Produces: `export function UserFeedbackList({ initialPage }: { initialPage: WordFixFeedbackPage }): JSX.Element`. Used by Task 11.

**Files (continued):**
- Create: `lib/actions/wordFixReportActions.ts` (a one-function Server Action wrapper so the client component can request the next page — `listUserFeedback` itself has `"server-only"` and can't be imported into a `"use client"` file)

- [ ] **Step 1: Add the thin Server Action wrapper**

Create `lib/actions/wordFixReportActions.ts`:
```ts
"use server";

import { listUserFeedback } from "@/lib/data/wordFixReports";
import type { WordFixFeedbackPage } from "@/lib/data/wordFixReports";

export async function fetchNextFeedbackPageAction(cursor: string): Promise<WordFixFeedbackPage> {
  return listUserFeedback(cursor);
}
```

No dedicated test — it's a one-line passthrough with no branching logic; Task 3's tests already cover `listUserFeedback`'s behavior.

- [ ] **Step 2: Build the component**

Create `components/admin/UserFeedbackList.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import type { WordFixFeedbackPage } from "@/lib/data/wordFixReports";
import { fetchNextFeedbackPageAction } from "@/lib/actions/wordFixReportActions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function UserFeedbackList({ initialPage }: { initialPage: WordFixFeedbackPage }) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [isPending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const next = await fetchNextFeedbackPageAction(cursor);
      setItems((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>단어</TableHead>
            <TableHead>언어쌍</TableHead>
            <TableHead>피드백</TableHead>
            <TableHead>신고 시각</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.word}</TableCell>
              <TableCell>{item.wordLanguage} → {item.meaningLanguage}</TableCell>
              <TableCell className="whitespace-normal">{item.userFeedback}</TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(item.createdAt).toLocaleString("ko-KR")}
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                피드백이 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {cursor && (
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={loadMore} className="w-fit">
          더보기
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/wordFixReportActions.ts components/admin/UserFeedbackList.tsx
git commit -m "feat: add UserFeedbackList component with load-more pagination"
```

---

### Task 10: `AutoHiddenQueue` component (restore table)

**Files:**
- Create: `components/admin/AutoHiddenQueue.tsx`

**Interfaces:**
- Consumes: `AutoHiddenWord[]` from Task 4, `restoreWordCacheEntryAction` from Task 5.
- Produces: `export function AutoHiddenQueue({ words }: { words: AutoHiddenWord[] }): JSX.Element`. Used by Task 11.

- [ ] **Step 1: Build the component**

Create `components/admin/AutoHiddenQueue.tsx`, mirroring `components/admin/ReviewTabs.tsx`'s error-banner + `useTransition` pattern:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { AutoHiddenWord } from "@/lib/data/wordCacheQueue";
import { restoreWordCacheEntryAction } from "@/lib/actions/wordCacheActions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AutoHiddenQueue({ words }: { words: AutoHiddenWord[] }) {
  const [restored, setRestored] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRestore(cacheKey: string) {
    setError(null);
    startTransition(async () => {
      const result = await restoreWordCacheEntryAction(cacheKey);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRestored((prev) => new Set(prev).add(cacheKey));
    });
  }

  const visible = words.filter((w) => !restored.has(w.cacheKey));

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>단어</TableHead>
            <TableHead>언어쌍</TableHead>
            <TableHead>신고 수</TableHead>
            <TableHead>마지막 갱신</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((w) => (
            <TableRow key={w.cacheKey}>
              <TableCell className="font-medium">{w.word}</TableCell>
              <TableCell>{w.wordLanguage} → {w.meaningLanguage}</TableCell>
              <TableCell>{w.reportCount}</TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(w.updatedAt).toLocaleString("ko-KR")}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRestore(w.cacheKey)}
                >
                  복구
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                자동 숨김 대기 중인 단어가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

Note: restored rows are hidden client-side immediately (optimistic-ish, but only after the action actually confirms success) rather than waiting for the server-side `revalidatePath` + full page re-fetch — this keeps the admin's perceived action instant. The next full page load will reflect the real, revalidated list either way.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AutoHiddenQueue.tsx
git commit -m "feat: add AutoHiddenQueue component with restore action"
```

---

### Task 11: `/admin/quality` page + nav entry

**Files:**
- Create: `app/admin/(dashboard)/quality/page.tsx`
- Modify: `app/admin/(dashboard)/layout.tsx` (add nav item)

**Interfaces:**
- Consumes: `listPromptAnalysisReports` (Task 2), `listUserFeedback` (Task 3), `listAutoHiddenWords` (Task 4), `QualityTrendChart` (Task 6), `QualityBreakdownCharts` (Task 7), `AnalysisViewer` (Task 8), `UserFeedbackList` (Task 9), `AutoHiddenQueue` (Task 10).

- [ ] **Step 1: Build the page**

Create `app/admin/(dashboard)/quality/page.tsx`:
```tsx
import { listPromptAnalysisReports } from "@/lib/data/promptAnalysisReports";
import { listUserFeedback } from "@/lib/data/wordFixReports";
import { listAutoHiddenWords } from "@/lib/data/wordCacheQueue";
import { QualityTrendChart } from "@/components/admin/QualityTrendChart";
import { QualityBreakdownCharts } from "@/components/admin/QualityBreakdownCharts";
import { AnalysisViewer } from "@/components/admin/AnalysisViewer";
import { UserFeedbackList } from "@/components/admin/UserFeedbackList";
import { AutoHiddenQueue } from "@/components/admin/AutoHiddenQueue";
import { Card, CardContent } from "@/components/ui/card";

export default async function QualityReportPage() {
  const [reports, feedbackPage, autoHidden] = await Promise.all([
    listPromptAnalysisReports(),
    listUserFeedback(),
    listAutoHiddenWords(),
  ]);
  const latestReport = reports[reports.length - 1];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">품질 리포트</h1>
        <p className="text-sm text-muted-foreground">
          사용자 신고 추이와 AI 분석 결과를 확인하고, 오신고로 숨겨진 단어를 복구하세요.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">주간 신고 추이</h2>
        <Card>
          <CardContent>
            <QualityTrendChart reports={reports} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">이번 주 breakdown</h2>
        <Card>
          <CardContent>
            <QualityBreakdownCharts report={latestReport} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">AI 분석 결과</h2>
        <Card>
          <CardContent>
            <AnalysisViewer reports={reports} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">사용자 피드백 원문</h2>
        <UserFeedbackList initialPage={feedbackPage} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">자동 숨김 대기열</h2>
        <AutoHiddenQueue words={autoHidden} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav entry**

In `app/admin/(dashboard)/layout.tsx`, change:
```ts
const NAV_ITEMS = [
  { href: "/admin", label: "홈" },
  { href: "/admin/generation", label: "생성 진행상황" },
  { href: "/admin/review", label: "검토/게시" },
];
```
to:
```ts
const NAV_ITEMS = [
  { href: "/admin", label: "홈" },
  { href: "/admin/generation", label: "생성 진행상황" },
  { href: "/admin/review", label: "검토/게시" },
  { href: "/admin/quality", label: "품질 리포트" },
];
```

- [ ] **Step 3: Type-check and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all Vitest suites from Tasks 2-5 still pass.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, sign in as an admin, navigate to `/admin/quality`. Confirm:
- Page loads without error even if `prompt_analysis_reports` is empty (should show "이번 주 신고 없음" states, not crash).
- If there's at least one report, the trend chart, breakdown charts, and analysis text render.
- The feedback list and auto-hidden queue render (empty-state messages if no data).
- If there's a row in the auto-hidden queue, clicking "복구" removes it from the list and doesn't show an error banner.

Report what you observed (especially whether any collection was empty during this check, since that only proves the empty-state path, not the populated one) — this plan does not include component rendering tests (see Global Constraints), so this manual pass is the only verification of the composed UI.

- [ ] **Step 5: Commit**

```bash
git add "app/admin/(dashboard)/quality/page.tsx" "app/admin/(dashboard)/layout.tsx"
git commit -m "feat: add /admin/quality dashboard page"
```

---

## Out of Scope (tracked in the spec, not this plan)

- Manual "지금 분석 실행" trigger for `analyzeWordFixReports` — spec explicitly excludes this (weekly automatic batch is sufficient).
- Firestore composite indexes: `word_fix_reports` needs one for `(userFeedback !=, createdAt desc)` and `word_cache` needs one for `(reportCount >=, updatedAt desc)` — Firestore will throw a runtime error on first query with a console link to auto-create it. Note in the final task's manual verification whether either query throws, and if so, follow the link (or add `firestore.indexes.json` entries in the `word-bank` repo, which is where that file lives) before considering this done.
- `@tailwindcss/typography` plugin installation if not already present (see Task 8's note) — cosmetic only.
