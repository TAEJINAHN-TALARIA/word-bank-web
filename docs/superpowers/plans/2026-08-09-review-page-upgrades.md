# 검토/게시 화면 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/review`에 (1) 게시된 소설의 전문보기+다운로드, (2) 마스터 원고/번역 묶어보기, (3) 검토 대기 항목 일괄 게시를 추가한다.

**Architecture:** `ReviewTabs.tsx`를 탭 전환만 담당하는 얇은 셸로 유지하고, 그룹핑 렌더링·선택 상태·일괄 게시는 새 `PendingReviewsTable.tsx`/`PublishedStoriesTable.tsx`로 분리한다. 두 컴포넌트는 그룹핑 순수 함수(`lib/reviewGrouping.ts`)와 일괄 게시 액션바(`BulkPublishBar.tsx`)를 공유한다. 게시된 콘텐츠 본문은 word-bank-web이 이미 접근 가능한 `storyContent` Firestore 컬렉션을 직접 읽어서 보여주며, 새 Cloud Function은 만들지 않는다.

**Tech Stack:** Next.js 16(App Router, RSC, Server Actions, Route Handlers), Firestore(firebase-admin), Vitest.

## 전제

이 플랜은 `docs/superpowers/plans/2026-08-09-admin-dashboard-polish.md`의 **Task 7(발행됨 탭 페이지네이션)과 Task 12(게이트 경고 리스트화)까지 구현이 끝난 상태**를 전제로 한다. 아래 태스크들이 다루는 `ReviewTabs.tsx`/`lib/data/stories.ts`/`lib/actions/adminStoryActions.ts`의 "기존 코드"는 폴리시 플랜 실행 후의 최종 상태를 가리킨다. 폴리시 플랜이 아직 실행되지 않았다면 이 플랜보다 먼저 실행해야 한다.

## Global Constraints

- 게시됨 탭 항목만 전문보기/다운로드 지원 — 대기중 탭은 본문이 `storyContent`에 없어(파이프라인 내부 레이어 산출물에만 존재) 이번 범위에서 제외한다.
- Firestore 스키마(`stories`, `storyContent`), Cloud Functions, 인증 로직은 변경하지 않는다 — 읽기 전용 조회(`storyContent`)와 UI만 추가한다.
- 그룹 키는 `item.sessionId || fallbackId(item)`다 — `sessionId`가 없거나 빈 문자열인 옛날 데이터가 서로 잘못 뭉치지 않도록, 항상 항목 고유의 fallback id(게시됨 탭은 문서 id, 대기중 탭은 `sessionId_target`)를 쓴다.
- 그룹 크기가 1이면 그룹 헤더 없이 지금과 동일한 평범한 행으로 렌더링한다 — 옛날 단일 언어 데이터가 어색해 보이지 않게.
- 일괄 게시는 부분 실패를 허용한다 — 한 건의 실패가 나머지 게시를 막지 않으며, 성공한 항목만 목록에서 제거하고 실패한 항목은 에러 메시지와 함께 남긴다.
- 다운로드 Route Handler(`app/admin/(dashboard)/review/[docId]/download/route.ts`)는 `(dashboard)` 레이아웃 밖이라 **자체적으로 `getAdminSession()`을 호출해 인증을 확인**해야 한다 — 레이아웃의 인증 게이트가 자동으로 적용되지 않는다.
- 검증 명령: `npm run lint`, `npm run build`, `npm run test`(vitest).

---

## Task 1: 세션 그룹핑 유틸

**Files:**
- Create: `lib/reviewGrouping.ts`
- Test: `lib/reviewGrouping.test.ts`

**Interfaces:**
- Produces: `groupBySession<T extends { sessionId?: string }>(items: T[], fallbackId: (item: T) => string): { key: string; items: T[] }[]`, `getGroupLabel<T extends { target: string; lang: string; level: string; title: string | null }>(group: T[]): { title: string; level: string; languageCount: number }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/reviewGrouping.test.ts
import { describe, it, expect } from "vitest";
import { groupBySession, getGroupLabel } from "./reviewGrouping";

describe("groupBySession", () => {
  it("같은 sessionId를 가진 항목들을 하나의 그룹으로 묶는다", () => {
    const items = [
      { sessionId: "s1", target: "master" },
      { sessionId: "s1", target: "en" },
      { sessionId: "s2", target: "master" },
    ];

    const groups = groupBySession(items, () => "unused");

    expect(groups).toEqual([
      { key: "s1", items: [items[0], items[1]] },
      { key: "s2", items: [items[2]] },
    ]);
  });

  it("sessionId가 없으면 fallback id로 각각 독립된 그룹이 된다", () => {
    const items = [
      { sessionId: undefined, id: "doc1" },
      { sessionId: undefined, id: "doc2" },
    ];

    const groups = groupBySession(items, (item) => item.id);

    expect(groups).toEqual([
      { key: "doc1", items: [items[0]] },
      { key: "doc2", items: [items[1]] },
    ]);
  });

  it("sessionId가 빈 문자열이어도 fallback id를 쓴다(빈 문자열끼리 잘못 뭉치지 않는다)", () => {
    const items = [
      { sessionId: "", id: "doc1" },
      { sessionId: "", id: "doc2" },
    ];

    const groups = groupBySession(items, (item) => item.id);

    expect(groups).toEqual([
      { key: "doc1", items: [items[0]] },
      { key: "doc2", items: [items[1]] },
    ]);
  });

  it("그룹이 처음 등장한 위치 순서를 유지한다", () => {
    const items = [{ sessionId: "s1" }, { sessionId: "s2" }, { sessionId: "s1" }];

    const groups = groupBySession(items, () => "unused");

    expect(groups.map((g) => g.key)).toEqual(["s1", "s2"]);
  });
});

describe("getGroupLabel", () => {
  it("target이 master인 항목의 title/level을 우선 쓴다", () => {
    const group = [
      { target: "en", lang: "en", level: "Lv6", title: "English Title" },
      { target: "master", lang: "ko", level: "Lv6", title: "한국어 제목" },
    ];

    expect(getGroupLabel(group)).toEqual({ title: "한국어 제목", level: "Lv6", languageCount: 2 });
  });

  it("master가 없으면 첫 항목을 쓴다", () => {
    const group = [
      { target: "en", lang: "en", level: "Lv6", title: "English Title" },
      { target: "ja", lang: "ja", level: "Lv6", title: "日本語タイトル" },
    ];

    expect(getGroupLabel(group)).toEqual({ title: "English Title", level: "Lv6", languageCount: 2 });
  });

  it("title이 null이면 기본 문구를 쓴다", () => {
    const group = [{ target: "master", lang: "ko", level: "Lv6", title: null }];

    expect(getGroupLabel(group)).toEqual({ title: "(제목 없음)", level: "Lv6", languageCount: 1 });
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run lib/reviewGrouping.test.ts`
Expected: FAIL — `Cannot find module './reviewGrouping'`

- [ ] **Step 3: `lib/reviewGrouping.ts` 작성**

```ts
// lib/reviewGrouping.ts
export function groupBySession<T extends { sessionId?: string }>(
  items: T[],
  fallbackId: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const item of items) {
    const key = item.sessionId || fallbackId(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }

  return order.map((key) => ({ key, items: groups.get(key)! }));
}

export function getGroupLabel<
  T extends { target: string; lang: string; level: string; title: string | null },
>(group: T[]): { title: string; level: string; languageCount: number } {
  const master = group.find((item) => item.target === "master" || item.lang === "ko");
  const primary = master ?? group[0];
  return {
    title: primary.title ?? "(제목 없음)",
    level: primary.level,
    languageCount: group.length,
  };
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

Run: `npx vitest run lib/reviewGrouping.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reviewGrouping.ts lib/reviewGrouping.test.ts
git commit -m "feat(admin): add session-based grouping utility for review page"
```

---

## Task 2: 게시된 소설 본문 조회

**Files:**
- Create: `lib/data/storyContent.ts`
- Test: `lib/data/storyContent.test.ts`
- Modify: `lib/data/stories.ts` (단일 문서 메타 조회 `getPublishedStory` 추가)

**Interfaces:**
- Produces: `StoryChapterContent = { num: number; title: string | null; paragraphs: string[] }`, `getStoryContent(docId: string): Promise<StoryChapterContent[] | null>` (`@/lib/data/storyContent`); `PublishedStoryDetail = { id: string; lang: string; level: string; title: string | null; sessionId: string; target: string }`, `getPublishedStory(docId: string): Promise<PublishedStoryDetail | null>` (`@/lib/data/stories`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/data/storyContent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { getStoryContent } from './storyContent';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

describe('getStoryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('문서를 챕터 배열로 매핑한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        chapters: [
          { num: 1, title: '1장', paragraphs: ['첫 문단', '둘째 문단'] },
          { num: 2, title: null, paragraphs: [] },
        ],
      }),
    });
    const mockDoc = vi.fn(() => ({ get: mockGet }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getStoryContent('session1_en');

    expect(mockCollection).toHaveBeenCalledWith('storyContent');
    expect(mockDoc).toHaveBeenCalledWith('session1_en');
    expect(result).toEqual([
      { num: 1, title: '1장', paragraphs: ['첫 문단', '둘째 문단'] },
      { num: 2, title: null, paragraphs: [] },
    ]);
  });

  it('문서가 없으면 null을 반환한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({ exists: false });
    const mockDoc = vi.fn(() => ({ get: mockGet }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getStoryContent('missing');

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run lib/data/storyContent.test.ts`
Expected: FAIL — `Cannot find module './storyContent'`

- [ ] **Step 3: `lib/data/storyContent.ts` 작성**

```ts
// lib/data/storyContent.ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type StoryChapterContent = {
  num: number;
  title: string | null;
  paragraphs: string[];
};

export async function getStoryContent(docId: string): Promise<StoryChapterContent[] | null> {
  const doc = await getAdminFirestore().collection("storyContent").doc(docId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  const chapters = (data.chapters ?? []) as StoryChapterContent[];
  return chapters.map((chapter) => ({
    num: chapter.num,
    title: chapter.title ?? null,
    paragraphs: chapter.paragraphs ?? [],
  }));
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

Run: `npx vitest run lib/data/storyContent.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: `lib/data/stories.ts`에 단일 문서 메타 조회 추가**

파일 끝에 추가:

```ts
export type PublishedStoryDetail = {
  id: string;
  lang: string;
  level: string;
  title: string | null;
  sessionId: string;
  target: string;
};

export async function getPublishedStory(docId: string): Promise<PublishedStoryDetail | null> {
  const doc = await getAdminFirestore().collection("stories").doc(docId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  return {
    id: doc.id,
    lang: data.lang,
    level: data.level,
    title: data.title ?? null,
    sessionId: data.sessionId,
    target: data.target,
  };
}
```

- [ ] **Step 6: 빌드 및 테스트 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 통과.

- [ ] **Step 7: Commit**

```bash
git add lib/data/storyContent.ts lib/data/storyContent.test.ts lib/data/stories.ts
git commit -m "feat(admin): add story content and single-story metadata lookups"
```

---

## Task 3: 전문보기 페이지 + 다운로드 Route Handler

**Files:**
- Create: `app/admin/(dashboard)/review/[docId]/page.tsx`
- Create: `app/admin/(dashboard)/review/[docId]/download/route.ts`

**Interfaces:**
- Consumes: `getPublishedStory`, `getStoryContent`(Task 2), `getAdminSession`(`@/lib/auth/session`), `buttonVariants`(`@/components/ui/button`).

- [ ] **Step 1: 전문보기 페이지 작성**

```tsx
// app/admin/(dashboard)/review/[docId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublishedStory } from "@/lib/data/stories";
import { getStoryContent } from "@/lib/data/storyContent";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function StoryContentPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const [story, chapters] = await Promise.all([
    getPublishedStory(docId),
    getStoryContent(docId),
  ]);

  if (!story || !chapters) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{story.title ?? "(제목 없음)"}</h1>
          <p className="text-sm text-muted-foreground">
            {story.lang} · {story.level}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/admin/review/${docId}/download`}
            download
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            다운로드
          </a>
          <Link href="/admin/review" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            목록으로
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {chapters.map((chapter) => (
          <div key={chapter.num} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {chapter.num}챕. {chapter.title ?? "(제목 없음)"}
            </h2>
            <div className="flex flex-col gap-3 text-sm leading-relaxed">
              {chapter.paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>
        ))}
        {chapters.length === 0 && (
          <p className="text-sm text-muted-foreground">챕터 내용이 없습니다.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 다운로드 Route Handler 작성**

```ts
// app/admin/(dashboard)/review/[docId]/download/route.ts
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";
import { getPublishedStory } from "@/lib/data/stories";
import { getStoryContent, type StoryChapterContent } from "@/lib/data/storyContent";

function buildTextFile(
  story: { title: string | null; lang: string },
  chapters: StoryChapterContent[],
): string {
  const lines = [`${story.title ?? "(제목 없음)"} (${story.lang})`, ""];
  for (const chapter of chapters) {
    lines.push(`${chapter.num}챕. ${chapter.title ?? "(제목 없음)"}`, "");
    for (const paragraph of chapter.paragraphs) {
      lines.push(paragraph, "");
    }
  }
  return lines.join("\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "관리자 로그인이 필요합니다" }, { status: 401 });
  }

  const { docId } = await params;

  try {
    const [story, chapters] = await Promise.all([
      getPublishedStory(docId),
      getStoryContent(docId),
    ]);

    if (!story || !chapters) {
      return NextResponse.json({ error: "콘텐츠를 찾을 수 없습니다" }, { status: 404 });
    }

    const text = buildTextFile(story, chapters);
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${docId}.txt"`,
      },
    });
  } catch (err) {
    console.error("[review-download]", err);
    return NextResponse.json({ error: "콘텐츠 조회 실패" }, { status: 500 });
  }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 4: 수동 확인**

`npm run dev`로 로그인 후 실제 게시된 문서 id로 `/admin/review/{docId}`에 접속해 챕터 본문이 순서대로 보이는지, "다운로드" 클릭 시 `.txt` 파일이 받아지는지 확인. 로그아웃 상태에서 `/admin/review/{docId}/download`를 직접 curl로 호출하면 `401`이 오는지 확인:
```bash
curl -i https://<dev-host>/admin/review/<docId>/download
```

- [ ] **Step 5: Commit**

```bash
git add "app/admin/(dashboard)/review/[docId]"
git commit -m "feat(admin): add story full-text view page and text download route"
```

---

## Task 4: 일괄 게시 액션 + 액션바

**Files:**
- Modify: `lib/actions/adminStoryActions.ts` (`publishStoriesAction` 추가)
- Test: `lib/actions/adminStoryActions.test.ts`
- Create: `components/admin/BulkPublishBar.tsx`

**Interfaces:**
- Produces: `publishStoriesAction(items: { sessionId: string; target: string }[]): Promise<{ sessionId: string; target: string; error?: string }[]>` (`@/lib/actions/adminStoryActions`); `BulkPublishBar({ selectedCount, disabled, onPublishSelected, result }: {...})` (`@/components/admin/BulkPublishBar`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/actions/adminStoryActions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session');
vi.mock('@/lib/admin-functions/storyGenerator');
vi.mock('next/cache');

import { publishStoriesAction } from './adminStoryActions';
import * as sessionModule from '@/lib/auth/session';
import * as storyGeneratorModule from '@/lib/admin-functions/storyGenerator';
import * as cacheModule from 'next/cache';

const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockPublishStory = vi.mocked(storyGeneratorModule.publishStory);
const mockRevalidatePath = vi.mocked(cacheModule.revalidatePath);

describe('publishStoriesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관리자 세션이 없으면 모든 항목에 에러를 채워 반환하고 publishStory를 호출하지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await publishStoriesAction([{ sessionId: 's1', target: 'en' }]);

    expect(result).toEqual([
      { sessionId: 's1', target: 'en', error: '관리자 로그인이 필요합니다' },
    ]);
    expect(mockPublishStory).not.toHaveBeenCalled();
  });

  it('일부만 실패해도 각 건의 성공/실패를 모두 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    mockPublishStory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('타임아웃'));

    const result = await publishStoriesAction([
      { sessionId: 's1', target: 'en' },
      { sessionId: 's1', target: 'ja' },
    ]);

    expect(result).toEqual([
      { sessionId: 's1', target: 'en' },
      { sessionId: 's1', target: 'ja', error: '타임아웃' },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/review');
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run lib/actions/adminStoryActions.test.ts`
Expected: FAIL — `publishStoriesAction`이 정의돼 있지 않음.

- [ ] **Step 3: `publishStoriesAction` 추가**

`lib/actions/adminStoryActions.ts` 끝에 추가:

```ts
export async function publishStoriesAction(
  items: { sessionId: string; target: string }[],
): Promise<{ sessionId: string; target: string; error?: string }[]> {
  const session = await getAdminSession();
  if (!session) {
    return items.map((item) => ({ ...item, error: "관리자 로그인이 필요합니다" }));
  }

  const results = await Promise.allSettled(
    items.map((item) => callPublishStory(item.sessionId, item.target)),
  );

  const mapped = results.map((result, i) => {
    const item = items[i];
    if (result.status === "fulfilled") return { ...item };
    return {
      ...item,
      error: result.reason instanceof Error ? result.reason.message : "게시 실패",
    };
  });

  revalidatePath("/admin/review");
  return mapped;
}
```

- [ ] **Step 4: 테스트 실행하여 통과 확인**

Run: `npx vitest run lib/actions/adminStoryActions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: `BulkPublishBar` 작성**

```tsx
// components/admin/BulkPublishBar.tsx
import { Button } from "@/components/ui/button";

export function BulkPublishBar({
  selectedCount,
  disabled,
  onPublishSelected,
  result,
}: {
  selectedCount: number;
  disabled: boolean;
  onPublishSelected: () => void;
  result: {
    successCount: number;
    failures: { sessionId: string; target: string; error: string }[];
  } | null;
}) {
  if (selectedCount === 0 && !result) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{selectedCount}건 선택됨</span>
        <Button
          type="button"
          size="sm"
          disabled={disabled || selectedCount === 0}
          onClick={onPublishSelected}
        >
          선택 게시
        </Button>
      </div>
      {result && (
        <p className="text-sm text-muted-foreground">
          {result.successCount + result.failures.length}건 중 {result.successCount}건 게시 완료
          {result.failures.length > 0 && `, ${result.failures.length}건 실패`}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 빌드 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 통과.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/adminStoryActions.ts lib/actions/adminStoryActions.test.ts components/admin/BulkPublishBar.tsx
git commit -m "feat(admin): add bulk publish server action and action bar"
```

---

## Task 5: 게시됨 탭 테이블 (그룹핑 + 다운로드 링크)

**Files:**
- Create: `components/admin/PublishedStoriesTable.tsx`

**Interfaces:**
- Consumes: `groupBySession`, `getGroupLabel`(Task 1), `EmptyTableRow`, `InlineError`, `fetchMorePublishedStoriesAction`, `recallStoryAction`(이미 존재), `buttonVariants`.
- Produces: `PublishedStoriesTable({ initialStories, initialCursor, onCountChange }: { initialStories: PublishedStory[]; initialCursor: string | null; onCountChange: (count: number) => void })`.

- [ ] **Step 1: `PublishedStoriesTable` 작성**

```tsx
// components/admin/PublishedStoriesTable.tsx
"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { PublishedStory } from "@/lib/data/stories";
import { fetchMorePublishedStoriesAction, recallStoryAction } from "@/lib/actions/adminStoryActions";
import { groupBySession, getGroupLabel } from "@/lib/reviewGrouping";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { InlineError } from "@/components/admin/InlineError";
import { cn } from "@/lib/utils";

export function PublishedStoriesTable({
  initialStories,
  initialCursor,
  onCountChange,
}: {
  initialStories: PublishedStory[];
  initialCursor: string | null;
  onCountChange: (count: number) => void;
}) {
  const [stories, setStories] = useState(initialStories);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const [recallError, setRecallError] = useState<string | null>(null);
  const [isRecalling, startRecallTransition] = useTransition();

  useEffect(() => {
    onCountChange(stories.length);
  }, [stories.length, onCountChange]);

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreError(null);
    startLoadMoreTransition(async () => {
      try {
        const page = await fetchMorePublishedStoriesAction(cursor);
        setStories((prev) => [...prev, ...page.stories]);
        setCursor(page.nextCursor);
      } catch (err) {
        setLoadMoreError(err instanceof Error ? err.message : "목록을 더 불러오지 못했습니다");
      }
    });
  }

  function handleRecall(sessionId: string, target: string) {
    setRecallError(null);
    startRecallTransition(async () => {
      const result = await recallStoryAction(sessionId, target);
      if (result.error) {
        setRecallError(result.error);
        return;
      }
      setStories((prev) => prev.filter((s) => !(s.sessionId === sessionId && s.target === target)));
    });
  }

  const groups = groupBySession(stories, (story) => story.id);

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>콘텐츠</TableHead>
            <TableHead>언어 / 레벨</TableHead>
            <TableHead>챕터</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ key, items }) => {
            const label = items.length > 1 ? getGroupLabel(items) : null;
            return (
              <Fragment key={key}>
                {label && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={4} className="font-medium">
                      {label.title} ({label.level}) · {label.languageCount}개 언어
                    </TableCell>
                  </TableRow>
                )}
                {items.map((story) => (
                  <TableRow key={story.id}>
                    <TableCell className={cn("whitespace-normal font-medium", label && "pl-6")}>
                      <Link href={`/admin/review/${story.id}`} className="underline-offset-4 hover:underline">
                        {story.title ?? "(제목 없음)"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {story.lang} / {story.level}
                    </TableCell>
                    <TableCell>{story.chapterCount}개</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <a
                          href={`/admin/review/${story.id}/download`}
                          download
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        >
                          다운로드
                        </a>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isRecalling}
                          onClick={() => handleRecall(story.sessionId, story.target)}
                        >
                          게시 철회
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
          {stories.length === 0 && <EmptyTableRow colSpan={4} message="게시된 콘텐츠가 없습니다." />}
        </TableBody>
      </Table>
      {recallError && <InlineError message={recallError} />}
      {loadMoreError && <InlineError message={loadMoreError} />}
      {cursor && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={isLoadingMore}
          onClick={handleLoadMore}
        >
          {isLoadingMore ? "불러오는 중..." : "더 보기"}
        </Button>
      )}
    </div>
  );
}
```

`groupBySession`은 매 렌더마다 현재까지 로드된 전체 `stories` 배열을 다시 그룹핑하므로, "더 보기"로 나중에 로드된 항목이 이미 화면에 있던 같은 세션 그룹에 정확히 합쳐진다(그룹 자체를 별도로 유지/병합할 필요 없음).

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과. (이 시점엔 아직 `ReviewTabs.tsx`가 이 컴포넌트를 렌더링하지 않아 화면에서 직접 확인은 안 되지만, 타입/린트/빌드는 독립적으로 통과해야 함 — 실제 연결은 Task 7)

- [ ] **Step 3: Commit**

```bash
git add components/admin/PublishedStoriesTable.tsx
git commit -m "feat(admin): add grouped published stories table with download links"
```

---

## Task 6: 대기중 탭 테이블 (그룹핑 + 선택 + 일괄 게시)

**Files:**
- Create: `components/admin/PendingReviewsTable.tsx`

**Interfaces:**
- Consumes: `groupBySession`, `getGroupLabel`(Task 1), `publishStoriesAction`, `BulkPublishBar`(Task 4), `publishStoryAction`(이미 존재), `statusBadgeVariant`, `LabeledList`, `EmptyTableRow`, `InlineError`.
- Produces: `PendingReviewsTable({ initialItems, onCountChange }: { initialItems: PendingReviewItem[]; onCountChange: (count: number) => void })`.

- [ ] **Step 1: `PendingReviewsTable` 작성**

```tsx
// components/admin/PendingReviewsTable.tsx
"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import { publishStoryAction, publishStoriesAction } from "@/lib/actions/adminStoryActions";
import { groupBySession, getGroupLabel } from "@/lib/reviewGrouping";
import { statusBadgeVariant } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { InlineError } from "@/components/admin/InlineError";
import { LabeledList } from "@/components/admin/LabeledList";
import { BulkPublishBar } from "@/components/admin/BulkPublishBar";

function itemKey(item: { sessionId: string; target: string }) {
  return `${item.sessionId}_${item.target}`;
}

export function PendingReviewsTable({
  initialItems,
  onCountChange,
}: {
  initialItems: PendingReviewItem[];
  onCountChange: (count: number) => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [singleError, setSingleError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    successCount: number;
    failures: { sessionId: string; target: string; error: string }[];
  } | null>(null);

  useEffect(() => {
    onCountChange(items.length);
  }, [items.length, onCountChange]);

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handlePublish(sessionId: string, target: string) {
    setSingleError(null);
    startTransition(async () => {
      const result = await publishStoryAction(sessionId, target);
      if (result.error) {
        setSingleError(result.error);
        return;
      }
      setItems((prev) => prev.filter((i) => !(i.sessionId === sessionId && i.target === target)));
    });
  }

  function handleBulkPublish(targets: { sessionId: string; target: string }[]) {
    if (targets.length === 0) return;
    setBulkResult(null);
    startTransition(async () => {
      const results = await publishStoriesAction(targets);
      const failures = results.filter(
        (r): r is { sessionId: string; target: string; error: string } => Boolean(r.error),
      );
      const succeededKeys = new Set(results.filter((r) => !r.error).map((r) => itemKey(r)));
      setItems((prev) => prev.filter((i) => !succeededKeys.has(itemKey(i))));
      setSelected((prev) => {
        const next = new Set(prev);
        succeededKeys.forEach((k) => next.delete(k));
        return next;
      });
      setBulkResult({ successCount: results.length - failures.length, failures });
    });
  }

  const groups = groupBySession(items, itemKey);
  const failureByKey = new Map(bulkResult?.failures.map((f) => [itemKey(f), f.error]) ?? []);

  return (
    <div className="flex flex-col gap-3">
      <BulkPublishBar
        selectedCount={selected.size}
        disabled={isPending}
        onPublishSelected={() =>
          handleBulkPublish(
            items
              .filter((i) => selected.has(itemKey(i)))
              .map((i) => ({ sessionId: i.sessionId, target: i.target })),
          )
        }
        result={bulkResult}
      />
      {singleError && <InlineError message={singleError} />}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>콘텐츠</TableHead>
            <TableHead>언어 / 레벨</TableHead>
            <TableHead>게이트</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ key, items: groupItems }) => {
            const label = groupItems.length > 1 ? getGroupLabel(groupItems) : null;
            return (
              <Fragment key={key}>
                {label && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={4} className="font-medium">
                      {label.title} ({label.level}) · {label.languageCount}개 언어
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          handleBulkPublish(
                            groupItems.map((i) => ({ sessionId: i.sessionId, target: i.target })),
                          )
                        }
                      >
                        이 세션 전체 게시
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                {groupItems.map((item) => {
                  const key2 = itemKey(item);
                  return (
                    <TableRow key={key2}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={selected.has(key2)}
                          onChange={() => toggleSelected(key2)}
                          aria-label={`${item.title ?? item.target} 선택`}
                        />
                      </TableCell>
                      <TableCell className={label ? "whitespace-normal pl-6" : "whitespace-normal"}>
                        <div className="font-medium">{item.title ?? "(제목 없음)"}</div>
                        <LabeledList
                          label="경고"
                          items={item.ruleBaseWarnings}
                          className="mt-1 text-xs text-amber-700 dark:text-amber-500"
                        />
                      </TableCell>
                      <TableCell>
                        {item.lang} / {item.level}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={statusBadgeVariant(item.gateStatus)}>{item.gateStatus}</Badge>
                          {failureByKey.has(key2) && (
                            <InlineError message={`게시 실패: ${failureByKey.get(key2)}`} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handlePublish(item.sessionId, item.target)}
                        >
                          게시
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            );
          })}
          {items.length === 0 && <EmptyTableRow colSpan={5} message="검토 대기 중인 콘텐츠가 없습니다." />}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add components/admin/PendingReviewsTable.tsx
git commit -m "feat(admin): add grouped pending reviews table with bulk publish"
```

---

## Task 7: `ReviewTabs.tsx`를 얇은 셸로 재작성

**Files:**
- Modify: `components/admin/ReviewTabs.tsx`

**Interfaces:**
- Consumes: `PendingReviewsTable`(Task 6), `PublishedStoriesTable`(Task 5).
- Produces: `ReviewTabs({ pending, initialPublished, initialPublishedCursor }: {...})` — props 시그니처는 admin-dashboard-polish 플랜의 것과 동일하게 유지(`review/page.tsx`는 수정 불필요).

- [ ] **Step 1: `ReviewTabs.tsx` 전체 교체**

```tsx
// components/admin/ReviewTabs.tsx
"use client";

import { useState } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import type { PublishedStory } from "@/lib/data/stories";
import { PendingReviewsTable } from "@/components/admin/PendingReviewsTable";
import { PublishedStoriesTable } from "@/components/admin/PublishedStoriesTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ReviewTabs({
  pending,
  initialPublished,
  initialPublishedCursor,
}: {
  pending: PendingReviewItem[];
  initialPublished: PublishedStory[];
  initialPublishedCursor: string | null;
}) {
  const [tab, setTab] = useState<"pending" | "published">("pending");
  const [pendingCount, setPendingCount] = useState(pending.length);
  const [publishedCount, setPublishedCount] = useState(initialPublished.length);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "pending" | "published")}
      className="flex flex-col gap-4"
    >
      <TabsList variant="line" className="border-b border-border">
        <TabsTrigger value="pending">대기중 ({pendingCount})</TabsTrigger>
        <TabsTrigger value="published">게시됨 ({publishedCount})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending">
        <PendingReviewsTable initialItems={pending} onCountChange={setPendingCount} />
      </TabsContent>

      <TabsContent value="published">
        <PublishedStoriesTable
          initialStories={initialPublished}
          initialCursor={initialPublishedCursor}
          onCountChange={setPublishedCount}
        />
      </TabsContent>
    </Tabs>
  );
}
```

`pendingCount`/`publishedCount`는 각 테이블 컴포넌트의 `useEffect`(Task 5/6에서 이미 작성)가 `onCountChange`로 올려보내므로, 게시/일괄게시/더보기 이후에도 탭 라벨의 숫자가 실시간으로 맞다.

- [ ] **Step 2: 빌드 및 테스트 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 통과. `review/page.tsx`는 이 플랜에서 수정하지 않으므로(props 시그니처 불변) 별도 변경 없이 그대로 동작해야 함.

- [ ] **Step 3: Commit**

```bash
git add components/admin/ReviewTabs.tsx
git commit -m "refactor(admin): reduce ReviewTabs to a thin tab shell"
```

---

## Task 8: 최종 검증

**Files:** 없음 (검증 전용).

- [ ] **Step 1: 전체 린트/빌드/테스트**

Run: `npm run lint && npm run build && npm run test`
Expected: 모두 통과.

- [ ] **Step 2: 수동 전체 흐름 확인**

`npm run dev`로 로그인 후 `/admin/review`에서:
- **게시됨 탭**: 마스터+번역이 있는 최근 세션은 그룹 헤더(제목·레벨·언어 수) 아래 언어별 행으로 묶여 보이는지. 옛날/단일 언어 항목은 그룹 헤더 없이 평범한 행으로 보이는지. 행을 클릭해 전문 페이지로 이동, 챕터 본문이 순서대로 보이는지, 다운로드 버튼(페이지 안 + 테이블 행 아이콘 둘 다)으로 `.txt`가 받아지는지.
- **대기중 탭**: 체크박스로 여러 건 선택 후 "선택 게시" → 성공한 건은 목록에서 사라지고, 실패를 재현할 수 있다면(예: 네트워크를 끊고 시도) 실패 건은 남아 게이트 배지 옆에 에러가 보이는지. 그룹이 있는 세션에서 "이 세션 전체 게시" 버튼으로 한 번에 게시되는지. 탭 라벨의 건수가 게시 후 즉시 줄어드는지.
- 두 탭 모두 "더 보기"가 그룹핑과 함께 자연스럽게 동작하는지(나중에 로드된 항목이 기존 그룹에 올바르게 합쳐지는지).

- [ ] **Step 3: git status 확인**

Run: `git status`
Expected: 이 플랜에서 다룬 파일들만 변경 목록에 있어야 함.

- [ ] **Step 4: (선택) 브랜치 정리**

모든 태스크 커밋이 끝났으면 `superpowers:finishing-a-development-branch` 스킬로 넘어가 PR 생성 여부를 사용자와 논의한다.
