# 단어캐시 현황 대시보드 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `word-bank-web` admin dashboard screen (`/admin/word-cache`) that the spec `docs/superpowers/specs/2026-08-08-word-cache-dashboard-design.md` describes: language-pair search-volume ranking, per-pair top-word lists, cache load by language, nonsense-search failure rate, and locale distribution. The `word-bank` side instrumentation this screen reads (`word_search_failures` counter, `word_cache.locale`) already shipped (`word-bank` commit `88ae574`, 2026-08-08) — this plan only touches the read/display side.

**Architecture:** Every panel is computed at request time straight from Firestore via the Admin SDK (`lib/firebase/admin.ts`'s `getAdminFirestore()`), matching the existing `lib/data/*.ts` pattern (`wordCacheQueue.ts`, `promptAnalysisReports.ts`) — no batch job, no new Firestore collection. `word_cache` has no field enumerating which language pairs actually have data, and Firestore has no "distinct values" query, so pair discovery is done by probing the app's known static language-code list (mirrored from `word-bank`'s `functions/src/langNames.ts`) with cheap `count()`/`sum()` aggregation queries rather than reading full documents — this keeps the "actual existing combos only" property the spec asks for (§Architecture, spec line 50) without a document-read fan-out. The one query that can't be an aggregate — "top words for a language pair" — needs its own Firestore composite index and is fetched on demand (not for all pairs at once) through a client-side language-pair picker backed by a server action, matching the existing `fetchNextFeedbackPageAction` pattern in `lib/actions/wordFixReportActions.ts`.

**Tech Stack:** Next.js 16 App Router server components, `firebase-admin` Firestore Admin SDK (aggregation queries: `Query.count()`, `Query.aggregate({ ...: AggregateField.sum(...) })`), `recharts` (already used by `QualityBreakdownCharts.tsx`), Vitest (`lib/data`, `lib/actions` only — this repo has no React component test setup, so components are verified via lint/build/manual browser check, matching how `components/admin/*` are verified elsewhere in this repo).

## Global Constraints

- `word_cache` document shape (from `word-bank`'s `functions/src/index.ts:230-260`): `{ word, wordLanguage, meaningLanguage, wordExists, lemma, phonetic, partOfSpeech, synonyms, antonyms, hitCount, reportCount, locale?, createdAt, updatedAt }`. `locale` is only present on docs cached since 2026-08-08 (instrumentation start).
- `word_search_failures` document shape (from `word-bank`'s `functions/src/index.ts:207-225`): doc id `{wordLanguage}_{meaningLanguage}`, fields `{ wordLanguage, meaningLanguage, failCount, updatedAt }`. Only readable by admins (`firestore.rules:70-73` in `word-bank`).
- All new server-side data functions live under `lib/data/`, import `"server-only"` at the top, and call `getAdminFirestore()` from `@/lib/firebase/admin` — follow `lib/data/wordCacheQueue.ts` exactly.
- All new Vitest test files mock `@/lib/firebase/admin` via `vi.mock('@/lib/firebase/admin')` (no factory, to avoid TDZ) and `server-only` via `vi.mock('server-only', () => ({}))` — follow `lib/data/wordFixReports.test.ts:1-12` exactly.
- Server actions live under `lib/actions/`, start with `"use server"`, and must call `getAdminSession()` from `@/lib/auth/session` and short-circuit to an empty/safe result if there's no session — follow `lib/actions/wordFixReportActions.ts` exactly (a prior fix, commit `020ad8d`, added this admin-session check after it was initially missing — don't repeat that omission).
- Admin UI pages/components are plain Korean text, not run through `next-intl` — the `/admin` tree is separate from the `[locale]` marketing site tree and is not localized (see `app/admin/(dashboard)/quality/page.tsx` for the convention).
- Run `npm run test`, `npm run lint`, and `npm run build` before every commit that touches `word-bank-web` source.
- This Next.js version renamed `middleware.ts` → `proxy.ts` and has other breaking changes from training-data Next.js — irrelevant to this plan (no proxy/middleware changes), noted per `AGENTS.md` only as a standing reminder to check `node_modules/next/dist/docs/` if something behaves unexpectedly.

---

## Phase A — Firestore composite index (`word-bank` repo)

### Task 1: Add the `wordLanguage`+`meaningLanguage`+`hitCount` composite index

**Files:**
- Create: `C:\Users\TAEJIN\Documents\word-bank\firestore.indexes.json` (does not exist yet)
- Modify: `C:\Users\TAEJIN\Documents\word-bank\firebase.json` (add `firestore.indexes` key — currently only has `firestore.rules`)

**Interfaces:**
- Produces: a deployed composite index that Task 4's `getTopWordsForPair()` query (`where('wordLanguage','==',...).where('meaningLanguage','==',...).orderBy('hitCount','desc')`) requires — without it, that query throws `FAILED_PRECONDITION` at runtime.

- [ ] **Step 1: Create the indexes file**

Create `C:\Users\TAEJIN\Documents\word-bank\firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "word_cache",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "wordLanguage", "order": "ASCENDING" },
        { "fieldPath": "meaningLanguage", "order": "ASCENDING" },
        { "fieldPath": "hitCount", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 2: Wire it into `firebase.json`**

In `C:\Users\TAEJIN\Documents\word-bank\firebase.json`, change:
```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
```
to:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
```

- [ ] **Step 3: Validate and deploy**

Run: `cd "C:\Users\TAEJIN\Documents\word-bank" && firebase deploy --only firestore:indexes`
Expected: deploy succeeds; Firebase console shows the new composite index building (can take a few minutes to go from "Building" to "Enabled" — Task 4's query will fail until it's enabled). Confirm with the user before running this — it's a real deploy to shared infrastructure, not a dry run.

- [ ] **Step 4: Commit**

```bash
git add firestore.indexes.json firebase.json
git commit -m "feat: add composite index for word_cache top-words-per-pair query"
```

---

## Phase B — Data layer (`word-bank-web`, TDD with Vitest)

### Task 2: `LANGUAGE_CODES` + `getCacheLoadByLanguage()`

**Files:**
- Create: `lib/data/wordCacheStats.ts`
- Create: `lib/data/wordCacheStats.test.ts`

**Interfaces:**
- Produces: `export const LANGUAGE_CODES: readonly string[]`, `export interface LanguageCacheLoad { wordLanguage: string; count: number }`, `export async function getCacheLoadByLanguage(): Promise<LanguageCacheLoad[]>` (sorted by `count` desc, zero-count languages excluded). Consumed by Task 3 (as the discovery input) and Task 11 (cache-load panel).

- [ ] **Step 1: Write the failing tests**

Create `lib/data/wordCacheStats.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { getCacheLoadByLanguage } from './wordCacheStats';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

describe('getCacheLoadByLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('언어별 count()를 조회해 0보다 큰 것만 count 내림차순으로 반환한다', async () => {
    const mockWhere = vi.fn((_field: string, _op: string, value: string) => ({
      count: () => ({
        get: () =>
          Promise.resolve({
            data: () => ({ count: value === 'en' ? 10 : value === 'ko' ? 30 : 0 }),
          }),
      }),
    }));
    const mockCollection = vi.fn(() => ({ where: mockWhere }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getCacheLoadByLanguage();

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(result).toEqual([
      { wordLanguage: 'ko', count: 30 },
      { wordLanguage: 'en', count: 10 },
    ]);
  });

  it('모든 언어의 count가 0이면 빈 배열을 반환한다', async () => {
    const mockWhere = vi.fn(() => ({
      count: () => ({ get: () => Promise.resolve({ data: () => ({ count: 0 }) }) }),
    }));
    const mockCollection = vi.fn(() => ({ where: mockWhere }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getCacheLoadByLanguage();

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: FAIL — `lib/data/wordCacheStats.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/data/wordCacheStats.ts`:

```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

// word-bank 앱이 지원하는 언어 코드 목록. word_cache에 실제로 어떤 wordLanguage 값이
// 존재하는지 Firestore에는 distinct 쿼리가 없어 직접 물어볼 수 없으므로, 이 알려진
// 후보 목록을 count()/sum() 집계 쿼리로 하나씩 훑어 "실제 존재하는 값"만 골라낸다.
// word-bank 저장소 functions/src/langNames.ts와 동기화 상태를 유지해야 한다.
export const LANGUAGE_CODES = [
  "en", "ko", "ja", "zh", "fr", "de", "es", "it",
  "pt", "ar", "la", "hi", "bn", "ru", "id",
] as const;

export interface LanguageCacheLoad {
  wordLanguage: string;
  count: number;
}

export async function getCacheLoadByLanguage(): Promise<LanguageCacheLoad[]> {
  const collection = getAdminFirestore().collection("word_cache");

  const results = await Promise.all(
    LANGUAGE_CODES.map(async (wordLanguage) => {
      const snapshot = await collection.where("wordLanguage", "==", wordLanguage).count().get();
      return { wordLanguage, count: snapshot.data().count };
    }),
  );

  return results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/wordCacheStats.ts lib/data/wordCacheStats.test.ts
git commit -m "feat: add getCacheLoadByLanguage for the word-cache dashboard"
```

---

### Task 3: `getSearchVolumeByLanguagePair()`

**Files:**
- Modify: `lib/data/wordCacheStats.ts`
- Modify: `lib/data/wordCacheStats.test.ts`

**Interfaces:**
- Consumes: `LanguageCacheLoad[]` (Task 2's `getCacheLoadByLanguage()` result) as the discovery input — only probes `meaningLanguage` combos for `wordLanguage`s already known to have data.
- Produces: `export interface LanguagePairVolume { wordLanguage: string; meaningLanguage: string; hitCount: number }`, `export async function getSearchVolumeByLanguagePair(discovered: LanguageCacheLoad[]): Promise<LanguagePairVolume[]>` (sorted by `hitCount` desc, zero excluded). Consumed by Task 5 (failure-rate join) and Task 11 (volume-ranking panel + top-words picker's pair list).

- [ ] **Step 1: Write the failing test**

Append to `lib/data/wordCacheStats.test.ts`:

```ts
import { getSearchVolumeByLanguagePair } from './wordCacheStats';

describe('getSearchVolumeByLanguagePair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovered wordLanguage들에 대해서만 언어쌍 조합의 hitCount 합계를 조회한다', async () => {
    const mockWhere2 = vi.fn((_field: string, _op: string, meaningLanguage: string) => ({
      aggregate: () => ({
        get: () =>
          Promise.resolve({
            data: () => ({ total: meaningLanguage === 'ko' ? 42 : 0 }),
          }),
      }),
    }));
    const mockWhere1 = vi.fn(() => ({ where: mockWhere2 }));
    const mockCollection = vi.fn(() => ({ where: mockWhere1 }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchVolumeByLanguagePair([{ wordLanguage: 'en', count: 10 }]);

    expect(mockWhere1).toHaveBeenCalledWith('wordLanguage', '==', 'en');
    expect(result).toEqual([{ wordLanguage: 'en', meaningLanguage: 'ko', hitCount: 42 }]);
  });

  it('discovered가 비어있으면 쿼리 없이 빈 배열을 반환한다', async () => {
    const mockCollection = vi.fn();
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchVolumeByLanguagePair([]);

    expect(result).toEqual([]);
    expect(mockCollection).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: the 2 new tests FAIL; the 2 `getCacheLoadByLanguage` tests still PASS.

- [ ] **Step 3: Implement**

In `lib/data/wordCacheStats.ts`, add the `AggregateField` import and the new function:

```ts
import { AggregateField } from "firebase-admin/firestore";
```

```ts
export interface LanguagePairVolume {
  wordLanguage: string;
  meaningLanguage: string;
  hitCount: number;
}

export async function getSearchVolumeByLanguagePair(
  discovered: LanguageCacheLoad[],
): Promise<LanguagePairVolume[]> {
  if (discovered.length === 0) return [];

  const collection = getAdminFirestore().collection("word_cache");
  const candidates = discovered.flatMap(({ wordLanguage }) =>
    LANGUAGE_CODES.map((meaningLanguage) => ({ wordLanguage, meaningLanguage })),
  );

  const results = await Promise.all(
    candidates.map(async ({ wordLanguage, meaningLanguage }) => {
      const snapshot = await collection
        .where("wordLanguage", "==", wordLanguage)
        .where("meaningLanguage", "==", meaningLanguage)
        .aggregate({ total: AggregateField.sum("hitCount") })
        .get();
      return { wordLanguage, meaningLanguage, hitCount: snapshot.data().total };
    }),
  );

  return results.filter((r) => r.hitCount > 0).sort((a, b) => b.hitCount - a.hitCount);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/wordCacheStats.ts lib/data/wordCacheStats.test.ts
git commit -m "feat: add getSearchVolumeByLanguagePair for the word-cache dashboard"
```

---

### Task 4: `getTopWordsForPair()`

**Files:**
- Modify: `lib/data/wordCacheStats.ts`
- Modify: `lib/data/wordCacheStats.test.ts`

**Interfaces:**
- Produces: `export interface TopWord { word: string; hitCount: number }`, `export async function getTopWordsForPair(wordLanguage: string, meaningLanguage: string, limitCount?: number): Promise<TopWord[]>` (default `limitCount` = 10). Consumed by Task 7's server action.
- Requires Task 1's composite index to be deployed and `Enabled` before this query works against real Firestore (tests here mock Firestore, so they pass regardless — this is a production/manual-verification concern, called out again in Task 11).

- [ ] **Step 1: Write the failing test**

Append to `lib/data/wordCacheStats.test.ts`:

```ts
import { getTopWordsForPair } from './wordCacheStats';

describe('getTopWordsForPair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('언어쌍으로 필터링하고 hitCount 내림차순 limit개를 조회한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      docs: [
        { data: () => ({ word: 'run', hitCount: 50 }) },
        { data: () => ({ word: 'walk', hitCount: 20 }) },
      ],
    });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockWhere2 = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockWhere1 = vi.fn(() => ({ where: mockWhere2 }));
    const mockCollection = vi.fn(() => ({ where: mockWhere1 }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getTopWordsForPair('en', 'ko', 5);

    expect(mockWhere1).toHaveBeenCalledWith('wordLanguage', '==', 'en');
    expect(mockWhere2).toHaveBeenCalledWith('meaningLanguage', '==', 'ko');
    expect(mockOrderBy).toHaveBeenCalledWith('hitCount', 'desc');
    expect(mockLimit).toHaveBeenCalledWith(5);
    expect(result).toEqual([
      { word: 'run', hitCount: 50 },
      { word: 'walk', hitCount: 20 },
    ]);
  });

  it('limitCount 생략 시 기본값 10을 사용한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({ docs: [] });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockWhere2 = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockWhere1 = vi.fn(() => ({ where: mockWhere2 }));
    const mockCollection = vi.fn(() => ({ where: mockWhere1 }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    await getTopWordsForPair('en', 'ko');

    expect(mockLimit).toHaveBeenCalledWith(10);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: the 2 new tests FAIL; the earlier 4 still PASS.

- [ ] **Step 3: Implement**

In `lib/data/wordCacheStats.ts`, add:

```ts
export interface TopWord {
  word: string;
  hitCount: number;
}

export async function getTopWordsForPair(
  wordLanguage: string,
  meaningLanguage: string,
  limitCount = 10,
): Promise<TopWord[]> {
  const snapshot = await getAdminFirestore()
    .collection("word_cache")
    .where("wordLanguage", "==", wordLanguage)
    .where("meaningLanguage", "==", meaningLanguage)
    .orderBy("hitCount", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { word: data.word, hitCount: data.hitCount };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/wordCacheStats.ts lib/data/wordCacheStats.test.ts
git commit -m "feat: add getTopWordsForPair for the word-cache dashboard"
```

---

### Task 5: `getSearchFailureRates()`

**Files:**
- Modify: `lib/data/wordCacheStats.ts`
- Modify: `lib/data/wordCacheStats.test.ts`

**Interfaces:**
- Consumes: `LanguagePairVolume[]` (Task 3's result) to join `hitCount` onto each failure-count doc.
- Produces: `export interface SearchFailureRate { wordLanguage: string; meaningLanguage: string; failCount: number; hitCount: number; failureRatio: number }`, `export async function getSearchFailureRates(pairVolumes: LanguagePairVolume[]): Promise<SearchFailureRate[]>` (sorted by `failureRatio` desc; `failureRatio = failCount / (failCount + hitCount)`, `0` when both are `0`). Consumed by Task 11.

- [ ] **Step 1: Write the failing test**

Append to `lib/data/wordCacheStats.test.ts`:

```ts
import { getSearchFailureRates } from './wordCacheStats';

describe('getSearchFailureRates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('word_search_failures를 읽어 대응하는 hitCount와 합쳐 실패 비율을 계산한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      docs: [
        { id: 'en_ko', data: () => ({ wordLanguage: 'en', meaningLanguage: 'ko', failCount: 10 }) },
        { id: 'ja_en', data: () => ({ wordLanguage: 'ja', meaningLanguage: 'en', failCount: 5 }) },
      ],
    });
    const mockCollection = vi.fn(() => ({ get: mockGet }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchFailureRates([
      { wordLanguage: 'en', meaningLanguage: 'ko', hitCount: 90 },
    ]);

    expect(mockCollection).toHaveBeenCalledWith('word_search_failures');
    expect(result).toEqual([
      { wordLanguage: 'ja', meaningLanguage: 'en', failCount: 5, hitCount: 0, failureRatio: 1 },
      { wordLanguage: 'en', meaningLanguage: 'ko', failCount: 10, hitCount: 90, failureRatio: 0.1 },
    ]);
  });

  it('word_search_failures가 비어있으면 빈 배열을 반환한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({ docs: [] });
    const mockCollection = vi.fn(() => ({ get: mockGet }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchFailureRates([]);

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: the 2 new tests FAIL; the earlier 6 still PASS.

- [ ] **Step 3: Implement**

In `lib/data/wordCacheStats.ts`, add:

```ts
export interface SearchFailureRate {
  wordLanguage: string;
  meaningLanguage: string;
  failCount: number;
  hitCount: number;
  failureRatio: number;
}

export async function getSearchFailureRates(
  pairVolumes: LanguagePairVolume[],
): Promise<SearchFailureRate[]> {
  const snapshot = await getAdminFirestore().collection("word_search_failures").get();

  const hitCountByPairKey = new Map(
    pairVolumes.map((p) => [`${p.wordLanguage}_${p.meaningLanguage}`, p.hitCount]),
  );

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      const failCount: number = data.failCount ?? 0;
      const hitCount = hitCountByPairKey.get(doc.id) ?? 0;
      const total = failCount + hitCount;
      return {
        wordLanguage: data.wordLanguage,
        meaningLanguage: data.meaningLanguage,
        failCount,
        hitCount,
        failureRatio: total > 0 ? failCount / total : 0,
      };
    })
    .sort((a, b) => b.failureRatio - a.failureRatio);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: PASS, 8/8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/data/wordCacheStats.ts lib/data/wordCacheStats.test.ts
git commit -m "feat: add getSearchFailureRates for the word-cache dashboard"
```

---

### Task 6: `getLocaleDistribution()`

**Files:**
- Modify: `lib/data/wordCacheStats.ts`
- Modify: `lib/data/wordCacheStats.test.ts`

**Interfaces:**
- Produces: `export interface LocaleDistribution { locale: string; count: number }`, `export async function getLocaleDistribution(): Promise<LocaleDistribution[]>` (sorted by `count` desc). Consumed by Task 11.
- This one deliberately samples instead of aggregating: `locale` values are free-form BCP-47 strings (`ko-KR`, `en-US`, ...), not a small known set like `LANGUAGE_CODES`, so there's no cheap way to discover them via aggregate probing. It reads the most recent `LOCALE_SAMPLE_SIZE` docs' `locale` field only (via `.select()`) and counts in memory — a real per-request Firestore read cost, but bounded and it favors recent (i.e. post-instrumentation) data, which is what this panel is about per the spec's "열린 리스크" note that locale data only exists from 2026-08-08 onward.

- [ ] **Step 1: Write the failing test**

Append to `lib/data/wordCacheStats.test.ts`:

```ts
import { getLocaleDistribution } from './wordCacheStats';

describe('getLocaleDistribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('최근 문서의 locale 필드를 세어 내림차순으로 반환하고, locale이 없으면 "알 수 없음"으로 묶는다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      docs: [
        { data: () => ({ locale: 'ko-KR' }) },
        { data: () => ({ locale: 'ko-KR' }) },
        { data: () => ({ locale: 'en-US' }) },
        { data: () => ({}) },
      ],
    });
    const mockSelect = vi.fn(() => ({ get: mockGet }));
    const mockLimit = vi.fn(() => ({ select: mockSelect }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getLocaleDistribution();

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockSelect).toHaveBeenCalledWith('locale');
    expect(result).toEqual([
      { locale: 'ko-KR', count: 2 },
      { locale: 'en-US', count: 1 },
      { locale: '알 수 없음', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: the new test FAILs; the earlier 8 still PASS.

- [ ] **Step 3: Implement**

In `lib/data/wordCacheStats.ts`, add:

```ts
const LOCALE_SAMPLE_SIZE = 2000;
const UNKNOWN_LOCALE_LABEL = "알 수 없음";

export interface LocaleDistribution {
  locale: string;
  count: number;
}

export async function getLocaleDistribution(): Promise<LocaleDistribution[]> {
  const snapshot = await getAdminFirestore()
    .collection("word_cache")
    .orderBy("createdAt", "desc")
    .limit(LOCALE_SAMPLE_SIZE)
    .select("locale")
    .get();

  const counts = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const locale = (doc.data().locale as string | undefined) ?? UNKNOWN_LOCALE_LABEL;
    counts.set(locale, (counts.get(locale) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([locale, count]) => ({ locale, count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/data/wordCacheStats.test.ts`
Expected: PASS, 9/9 tests.

- [ ] **Step 5: Type-check and lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/data/wordCacheStats.ts lib/data/wordCacheStats.test.ts
git commit -m "feat: add getLocaleDistribution for the word-cache dashboard"
```

---

### Task 7: `fetchTopWordsAction` server action

**Files:**
- Create: `lib/actions/wordCacheStatsActions.ts`
- Create: `lib/actions/wordCacheStatsActions.test.ts`

**Interfaces:**
- Consumes: `getTopWordsForPair` (Task 4) and `getAdminSession` (`@/lib/auth/session`).
- Produces: `export async function fetchTopWordsAction(wordLanguage: string, meaningLanguage: string): Promise<TopWord[]>`. Consumed by Task 10's client component.

- [ ] **Step 1: Write the failing tests**

Create `lib/actions/wordCacheStatsActions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session');
vi.mock('@/lib/data/wordCacheStats');

import { fetchTopWordsAction } from './wordCacheStatsActions';
import * as sessionModule from '@/lib/auth/session';
import * as statsModule from '@/lib/data/wordCacheStats';

const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockGetTopWordsForPair = vi.mocked(statsModule.getTopWordsForPair);

describe('fetchTopWordsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관리자 세션이 없으면 빈 배열을 반환하고 getTopWordsForPair를 호출하지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await fetchTopWordsAction('en', 'ko');

    expect(result).toEqual([]);
    expect(mockGetTopWordsForPair).not.toHaveBeenCalled();
  });

  it('관리자 세션이 있으면 getTopWordsForPair를 호출하고 그 결과를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    mockGetTopWordsForPair.mockResolvedValueOnce([{ word: 'run', hitCount: 50 }]);

    const result = await fetchTopWordsAction('en', 'ko');

    expect(mockGetTopWordsForPair).toHaveBeenCalledWith('en', 'ko');
    expect(result).toEqual([{ word: 'run', hitCount: 50 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- lib/actions/wordCacheStatsActions.test.ts`
Expected: FAIL — `lib/actions/wordCacheStatsActions.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/actions/wordCacheStatsActions.ts`:

```ts
"use server";

import { getAdminSession } from "@/lib/auth/session";
import { getTopWordsForPair } from "@/lib/data/wordCacheStats";
import type { TopWord } from "@/lib/data/wordCacheStats";

export async function fetchTopWordsAction(
  wordLanguage: string,
  meaningLanguage: string,
): Promise<TopWord[]> {
  const session = await getAdminSession();
  if (!session) return [];

  return getTopWordsForPair(wordLanguage, meaningLanguage);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/actions/wordCacheStatsActions.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Full test suite, lint, type-check**

Run: `npm run test && npm run lint`
Expected: all pass, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/wordCacheStatsActions.ts lib/actions/wordCacheStatsActions.test.ts
git commit -m "feat: add fetchTopWordsAction for the word-cache dashboard"
```

---

## Phase C — UI (verified via lint/build/manual browser check — no React component test setup exists in this repo)

### Task 8: Static table components — volume ranking, cache load, failure rate

**Files:**
- Create: `components/admin/WordCacheVolumeTable.tsx`
- Create: `components/admin/CacheLoadByLanguageTable.tsx`
- Create: `components/admin/SearchFailureRateTable.tsx`

**Interfaces:**
- Consumes: `LanguagePairVolume[]`, `LanguageCacheLoad[]`, `SearchFailureRate[]` (Tasks 2, 3, 5).
- Produces: three server components (no `"use client"` — pure presentational, no interactivity), each taking its data as a prop. Consumed by Task 11's page.

- [ ] **Step 1: Create `WordCacheVolumeTable.tsx`**

```tsx
import type { LanguagePairVolume } from "@/lib/data/wordCacheStats";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function WordCacheVolumeTable({ volumes }: { volumes: LanguagePairVolume[] }) {
  if (volumes.length === 0) {
    return <p className="text-sm text-muted-foreground">검색 데이터가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>언어쌍</TableHead>
          <TableHead className="text-right">검색량 (hitCount 합계)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {volumes.map((v) => (
          <TableRow key={`${v.wordLanguage}_${v.meaningLanguage}`}>
            <TableCell className="font-medium">{v.wordLanguage} → {v.meaningLanguage}</TableCell>
            <TableCell className="text-right">{v.hitCount.toLocaleString("ko-KR")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create `CacheLoadByLanguageTable.tsx`**

```tsx
import type { LanguageCacheLoad } from "@/lib/data/wordCacheStats";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function CacheLoadByLanguageTable({ loads }: { loads: LanguageCacheLoad[] }) {
  if (loads.length === 0) {
    return <p className="text-sm text-muted-foreground">캐시된 단어가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>언어</TableHead>
          <TableHead className="text-right">캐시 문서 수</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loads.map((l) => (
          <TableRow key={l.wordLanguage}>
            <TableCell className="font-medium">{l.wordLanguage}</TableCell>
            <TableCell className="text-right">{l.count.toLocaleString("ko-KR")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 3: Create `SearchFailureRateTable.tsx`**

```tsx
import type { SearchFailureRate } from "@/lib/data/wordCacheStats";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function SearchFailureRateTable({ rates }: { rates: SearchFailureRate[] }) {
  if (rates.length === 0) {
    return <p className="text-sm text-muted-foreground">무의미 검색 데이터가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>언어쌍</TableHead>
          <TableHead className="text-right">무의미 검색</TableHead>
          <TableHead className="text-right">성공 검색</TableHead>
          <TableHead className="text-right">무의미 비율</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rates.map((r) => (
          <TableRow key={`${r.wordLanguage}_${r.meaningLanguage}`}>
            <TableCell className="font-medium">{r.wordLanguage} → {r.meaningLanguage}</TableCell>
            <TableCell className="text-right">{r.failCount.toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-right">{r.hitCount.toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-right">{(r.failureRatio * 100).toFixed(1)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Lint the new files**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/WordCacheVolumeTable.tsx components/admin/CacheLoadByLanguageTable.tsx components/admin/SearchFailureRateTable.tsx
git commit -m "feat: add word-cache dashboard static table components"
```

---

### Task 9: `LocaleDistributionChart` (recharts bar chart)

**Files:**
- Create: `components/admin/LocaleDistributionChart.tsx`

**Interfaces:**
- Consumes: `LocaleDistribution[]` (Task 6).
- Produces: a client component (`"use client"`, follows `components/admin/QualityBreakdownCharts.tsx`'s `BreakdownBarChart` pattern exactly). Consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { LocaleDistribution } from "@/lib/data/wordCacheStats";

export function LocaleDistributionChart({ distribution }: { distribution: LocaleDistribution[] }) {
  if (distribution.length === 0) {
    return <p className="text-sm text-muted-foreground">locale 데이터 없음</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, distribution.length * 32)}>
      <BarChart data={distribution} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis type="number" allowDecimals={false} fontSize={12} />
        <YAxis type="category" dataKey="locale" fontSize={12} width={100} />
        <Tooltip />
        <Bar dataKey="count" fill="currentColor" className="text-primary" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/LocaleDistributionChart.tsx
git commit -m "feat: add LocaleDistributionChart for the word-cache dashboard"
```

---

### Task 10: `TopWordsPanel` (interactive language-pair picker)

**Files:**
- Create: `components/admin/TopWordsPanel.tsx`

**Interfaces:**
- Consumes: `LanguagePairVolume[]` (Task 3, as the list of selectable pairs) and `fetchTopWordsAction` (Task 7).
- Produces: a client component. Consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { LanguagePairVolume, TopWord } from "@/lib/data/wordCacheStats";
import { fetchTopWordsAction } from "@/lib/actions/wordCacheStatsActions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function pairKey(wordLanguage: string, meaningLanguage: string) {
  return `${wordLanguage}_${meaningLanguage}`;
}

export function TopWordsPanel({
  pairs,
  initialWords,
}: {
  pairs: LanguagePairVolume[];
  initialWords: TopWord[];
}) {
  const [selectedKey, setSelectedKey] = useState(
    pairs.length > 0 ? pairKey(pairs[0].wordLanguage, pairs[0].meaningLanguage) : "",
  );
  const [words, setWords] = useState(initialWords);
  const [isPending, startTransition] = useTransition();

  if (pairs.length === 0) {
    return <p className="text-sm text-muted-foreground">검색 데이터가 없습니다.</p>;
  }

  function handleChange(key: string) {
    setSelectedKey(key);
    const [wordLanguage, meaningLanguage] = key.split("_");
    startTransition(async () => {
      setWords(await fetchTopWordsAction(wordLanguage, meaningLanguage));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <select
        value={selectedKey}
        onChange={(e) => handleChange(e.target.value)}
        className="w-fit rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      >
        {pairs.map((p) => {
          const key = pairKey(p.wordLanguage, p.meaningLanguage);
          return (
            <option key={key} value={key}>
              {p.wordLanguage} → {p.meaningLanguage}
            </option>
          );
        })}
      </select>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>단어</TableHead>
            <TableHead className="text-right">hitCount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {words.map((w) => (
            <TableRow key={w.word}>
              <TableCell className="font-medium">{w.word}</TableCell>
              <TableCell className="text-right">{w.hitCount.toLocaleString("ko-KR")}</TableCell>
            </TableRow>
          ))}
          {words.length === 0 && !isPending && (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground">
                데이터가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/TopWordsPanel.tsx
git commit -m "feat: add TopWordsPanel for the word-cache dashboard"
```

---

### Task 11: Page assembly, nav entry, manual verification

**Files:**
- Create: `app/admin/(dashboard)/word-cache/page.tsx`
- Modify: `app/admin/(dashboard)/layout.tsx:7-12` (`NAV_ITEMS`)

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 4 (as `fetchTopWordsAction`'s initial call), 5, 6, and the components from Tasks 8-10.

- [ ] **Step 1: Add the nav entry**

In `app/admin/(dashboard)/layout.tsx`, change:
```ts
const NAV_ITEMS = [
  { href: "/admin", label: "홈" },
  { href: "/admin/generation", label: "생성 진행상황" },
  { href: "/admin/review", label: "검토/게시" },
  { href: "/admin/quality", label: "품질 리포트" },
];
```
to:
```ts
const NAV_ITEMS = [
  { href: "/admin", label: "홈" },
  { href: "/admin/generation", label: "생성 진행상황" },
  { href: "/admin/review", label: "검토/게시" },
  { href: "/admin/quality", label: "품질 리포트" },
  { href: "/admin/word-cache", label: "단어캐시 현황" },
];
```

- [ ] **Step 2: Create the page**

Create `app/admin/(dashboard)/word-cache/page.tsx`:

```tsx
import {
  getCacheLoadByLanguage,
  getSearchVolumeByLanguagePair,
  getSearchFailureRates,
  getLocaleDistribution,
  getTopWordsForPair,
} from "@/lib/data/wordCacheStats";
import { WordCacheVolumeTable } from "@/components/admin/WordCacheVolumeTable";
import { CacheLoadByLanguageTable } from "@/components/admin/CacheLoadByLanguageTable";
import { SearchFailureRateTable } from "@/components/admin/SearchFailureRateTable";
import { LocaleDistributionChart } from "@/components/admin/LocaleDistributionChart";
import { TopWordsPanel } from "@/components/admin/TopWordsPanel";
import { Card, CardContent } from "@/components/ui/card";

// word_search_failures 카운터와 word_cache.locale 계측이 배포된 날짜.
// 이 날짜 이전에 캐시된 문서는 locale이 없고, 이 날짜 이전 무의미 검색은 집계되지 않았다.
const INSTRUMENTATION_START_DATE = "2026-08-08";

export default async function WordCacheStatsPage() {
  const cacheLoad = await getCacheLoadByLanguage().catch(() => []);
  const volumes = await getSearchVolumeByLanguagePair(cacheLoad).catch(() => []);
  const [failureRates, localeDistribution, initialTopWords] = await Promise.all([
    getSearchFailureRates(volumes).catch(() => []),
    getLocaleDistribution().catch(() => []),
    volumes.length > 0
      ? getTopWordsForPair(volumes[0].wordLanguage, volumes[0].meaningLanguage).catch(() => [])
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">단어캐시 현황</h1>
        <p className="text-sm text-muted-foreground">
          언어쌍별 검색 트렌드와 캐시 적재 현황을 확인하세요. 무의미 검색 비율과 locale 분포는{" "}
          {INSTRUMENTATION_START_DATE} 계측 시작 이후 데이터부터 반영됩니다.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어쌍별 검색량 랭킹</h2>
        <Card>
          <CardContent>
            <WordCacheVolumeTable volumes={volumes} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어쌍별 인기 단어</h2>
        <Card>
          <CardContent>
            <TopWordsPanel pairs={volumes} initialWords={initialTopWords} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어별 캐시 적재량</h2>
        <Card>
          <CardContent>
            <CacheLoadByLanguageTable loads={cacheLoad} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">무의미 검색 비율</h2>
        <Card>
          <CardContent>
            <SearchFailureRateTable rates={failureRates} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">locale 분포 (최근 검색 기준)</h2>
        <Card>
          <CardContent>
            <LocaleDistributionChart distribution={localeDistribution} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Full test suite, lint, build**

Run: `npm run test && npm run lint && npm run build`
Expected: all pass; build succeeds with the new `/admin/word-cache` route listed in the output.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, then sign in as an admin and open `http://localhost:3000/admin/word-cache`.
Check:
- The new "단어캐시 현황" nav link appears and navigates correctly.
- All five sections render without error (they may show "데이터가 없습니다" / "locale 데이터 없음" messages if Firestore has no `word_cache`/`word_search_failures` data yet — that's expected, not a bug).
- If there is `word_cache` data: the language-pair `<select>` in "언어쌍별 인기 단어" switches the table's contents when changed (confirms Task 1's composite index is deployed and `Enabled` — if it's still `Building` or missing, this table will error instead of showing rows; check the Firebase console and the server logs if so).
- Un-authenticated access to `/admin/word-cache` redirects to `/admin/login` (inherited from `app/admin/(dashboard)/layout.tsx`'s existing session check — not new behavior, just confirm it isn't accidentally bypassed).

- [ ] **Step 5: Commit**

```bash
git add app/admin/\(dashboard\)/word-cache/page.tsx app/admin/\(dashboard\)/layout.tsx
git commit -m "feat: add /admin/word-cache dashboard page"
```

---

## Out of Scope

- Any further changes to `word-bank`'s Cloud Functions or Firestore rules — that instrumentation already shipped (`word-bank` commit `88ae574`). Task 1 only adds a composite index, which is a read-side concern for this dashboard, not instrumentation.
- Historical backfill of `locale`/`word_search_failures` for cache entries created before 2026-08-08 — not possible (the data was never captured) and not requested by the spec, which explicitly expects sparse data at first (spec "열린 리스크").
- Auto-refresh / polling on the dashboard page — it's a manually-navigated admin page like `/admin/quality`; no live-update requirement in the spec.
- Pagination on any of the five panels — `LANGUAGE_CODES` is a small fixed list (15 codes), so volume/cache-load panels are naturally bounded; `getTopWordsForPair`'s `limitCount` default (10) and `getLocaleDistribution`'s sample cap (2000) are the only necessary bounds.
