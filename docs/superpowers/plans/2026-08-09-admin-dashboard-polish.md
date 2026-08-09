# 관리자 대시보드 UI 다듬기 + 로딩 속도 최적화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin`, `/admin/generation`, `/admin/generation/[sessionId]`, `/admin/review` 4개 화면의 체감 속도(로딩 스켈레톤, 병렬 fetch, 페이지네이션)와 시각적 완성도(인디고 액센트, 상태 배지 버그 수정, 공유 컴포넌트 정리)를 개선한다.

**Architecture:** 기존 RSC + Admin SDK 구조를 그대로 유지한 채, (1) `loading.tsx` 4개로 Suspense 스트리밍을 켜고, (2) `getPipelineSessionDetail()`의 순차 Firestore 호출을 `Promise.all`로 병렬화하고, (3) 목록 조회 함수에 `startAfter()` 커서 페이지네이션을 추가하며, (4) 상태 배지·빈 상태 행·에러 박스 로직을 `lib/status.ts` / `components/admin/*` 공유 모듈로 뽑아내고, (5) `app/globals.css`의 neutral 팔레트를 인디고 액센트로 교체한다.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), Tailwind CSS v4 (oklch 색상 변수), shadcn/ui(`base-nova`), firebase-admin (Firestore), Vitest.

## Global Constraints

- 액센트 컬러는 인디고/블루(`#4f46e5` 계열, oklch로는 `oklch(0.511 0.262 276.966)` = Tailwind indigo-600)로 통일한다.
- 성공/경고/실패 상태 배지(뱃지)는 액센트 컬러와 무관하게 **항상** 초록(success)/노랑(warning)/빨강(destructive)으로 고정한다 — 브랜드색과 상태색을 섞지 않는다.
- 차트/추이 그래프 라이브러리(recharts 등)는 이번 범위에서 **추가하지 않는다** — 카드+테이블 개선까지만.
- Firestore 스키마, Cloud Functions, 인증 로직은 변경하지 않는다 — UI 레이어와 클라이언트 쿼리 방식만 변경.
- `getPipelineSessionDetail()`의 반환 타입(`PipelineSessionDetail`) shape는 그대로 유지한다 — 병렬화는 내부 구현만 바꾼다.
- `fetchPendingReviews()`(story-generator의 외부 Cloud Function)는 응답 캡이 없는 **알려진 제약**으로 남긴다 — word-bank-web만으로는 못 고치므로 페이지네이션 대상에서 제외한다.
- 페이지네이션은 전체 count가 필요 없는 Firestore `startAfter()` 커서 기반 "더 보기" 버튼 방식으로 구현한다.
- "더 보기" 버튼 실패 시 버튼 옆에 인라인 에러 메시지를 표시하고, 이미 로드된 목록은 그대로 유지한다(비우지 않는다).
- 테스트는 스펙이 명시한 두 곳만 유닛 테스트로 작성한다: (a) `getPipelineSessionDetail()`이 두 Firestore 호출을 실제로 병렬로 실행하는지, (b) `lib/status.ts`의 pass/fail/warn → variant 매핑. 그 외 시각적 변경은 수동 확인으로 검증한다(스토리북/비주얼 테스트 인프라 신규 구축 없음).
- 검증 명령: `npm run lint`, `npm run build`, `npm run test`(vitest — 이미 설치되어 있고 `lib/actions/*.test.ts`, `lib/data/*.test.ts` 관례가 있음. `CLAUDE.md`의 "테스트 러너 없음" 문구는 구식이므로 무시하고 실제 vitest 설정을 따른다).
- `getAdminSession()`(`lib/auth/session.ts`)은 모든 `/admin/*` 네비게이션마다 `verifySessionCookie(cookie, true)`로 revocation 체크 네트워크 왕복을 하고 있고, 이 레이아웃은 `cookies()`를 쓰는 uncached 데이터라 `loading.tsx`로 가려지지 않는다(Next.js 공식 문서 caveat). 이번 코드베이스엔 `revokeRefreshTokens()`를 호출하는 기능이 전혀 없으므로(로그아웃은 쿠키 삭제로만 처리) revocation 체크의 실제 방어 대상은 "관리자가 Firebase 콘솔 등에서 직접 revoke하는 인시던트 대응" 정도뿐이다 — 짧은 TTL(60초) 인메모리 캐시로 완화해도 감내 가능한 트레이드오프로 판단한다(Task 9).
- `fetchPendingReviews()`(`lib/admin-functions/storyGenerator.ts`)는 story-generator 레포의 외부 Cloud Function을 `cache: "no-store"`로 매번 호출해 콜드스타트 지연을 그대로 노출한다. Cloud Function 자체의 콜드스타트 해소(예: min instances)는 story-generator 레포 쪽 작업이라 이번 범위 밖이지만, word-bank-web 쪽에서 Next.js `fetch` Data Cache로 짧은 시간(15초) 캐싱해 반복 네비게이션 시 중복 호출을 줄이는 완화책은 이번 범위에 포함한다(Task 10). `revalidatePath("/admin/review")`(게시/철회 액션)는 Next.js 공식 문서상 해당 경로에서 쓰인 fetch 캐시도 함께 무효화하므로 게시/철회 직후 최신 데이터가 즉시 반영된다.
- `gate.ruleBaseWarnings`/`gate.llmEvalReasons`(`getPipelineSessionDetail`)와 `item.ruleBaseWarnings`(`fetchPendingReviews`)는 현재 `.join(", ")`로 한 줄에 이어붙여 렌더링돼, 각 경고 문구 자체에 챕터별 퍼센트가 또 쉼표로 나열되는 항목과 겹쳐 실제 화면에서 거의 읽기 힘든 한 덩어리 텍스트가 된다(2026-08-09 스크린샷으로 확인). story-generator 쪽 응답 배열 구조 자체는 그대로 두고, word-bank-web에서 배열 원소를 리스트(`<ul><li>`)로 렌더링만 바꾼다(Task 12) — 각 배열 원소 내부의 추가 쉼표 구조까지 파싱해서 재구성하지는 않는다(외부 서비스가 보내는 자유 형식 문자열을 정규식 등으로 파싱하는 건 형식이 조금만 바뀌어도 깨지기 쉬워 이번 범위에서 제외).
- `components/ui/table.tsx`의 `TableRow`에는 이미 `hover:bg-muted/50`이 기본 적용돼 있다 — 스펙 5번 항목의 "테이블 행 호버 배경 추가"는 **이미 충족된 상태**이므로 별도 코드 변경 불필요(Task 8에서 육안 확인만 한다).

---

## Task 1: 로딩 스켈레톤

**Files:**
- Create: `components/ui/skeleton.tsx`
- Create: `app/admin/(dashboard)/loading.tsx`
- Create: `app/admin/(dashboard)/generation/loading.tsx`
- Create: `app/admin/(dashboard)/generation/[sessionId]/loading.tsx`
- Create: `app/admin/(dashboard)/review/loading.tsx`

**Interfaces:**
- Produces: `Skeleton` component (`@/components/ui/skeleton`), props `React.ComponentProps<"div">`, renders `<div className="animate-pulse rounded-md bg-muted" />`.

- [ ] **Step 1: `Skeleton` 프리미티브 작성**

```tsx
// components/ui/skeleton.tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
```

- [ ] **Step 2: 홈(`/admin`) 로딩 스켈레톤**

```tsx
// app/admin/(dashboard)/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardHomeLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:max-w-xl sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-4 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 생성 목록(`/admin/generation`) 로딩 스켈레톤**

```tsx
// app/admin/(dashboard)/generation/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLUMN_COUNT = 6;
const ROW_COUNT = 8;

export default function GenerationLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: COLUMN_COUNT }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full max-w-24" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: 생성 상세(`/admin/generation/[sessionId]`) 로딩 스켈레톤**

```tsx
// app/admin/(dashboard)/generation/[sessionId]/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function GenerationDetailLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-5 w-20" />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-md">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </dl>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-md">
          {Array.from({ length: 16 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 검토/게시(`/admin/review`) 로딩 스켈레톤**

```tsx
// app/admin/(dashboard)/review/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLUMN_COUNT = 4;
const ROW_COUNT = 8;

export default function ReviewLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-4 border-b border-border pb-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: COLUMN_COUNT }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full max-w-24" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 통과. `.next` 빌드 출력에 4개 경로 모두 정상 컴파일됨을 확인.

- [ ] **Step 7: Commit**

```bash
git add components/ui/skeleton.tsx "app/admin/(dashboard)/loading.tsx" "app/admin/(dashboard)/generation/loading.tsx" "app/admin/(dashboard)/generation/[sessionId]/loading.tsx" "app/admin/(dashboard)/review/loading.tsx"
git commit -m "feat(admin): add loading skeletons for dashboard routes"
```

---

## Task 2: `getPipelineSessionDetail()` 병렬화

**Files:**
- Modify: `lib/data/pipelineSessions.ts:72-107`
- Test: `lib/data/pipelineSessions.test.ts`

**Interfaces:**
- Consumes: 없음 (기존 `PipelineSessionDetail`, `LayerGateResult` 타입 그대로 사용)
- Produces: `getPipelineSessionDetail(sessionId: string): Promise<PipelineSessionDetail | null>` — 시그니처/반환 타입 불변, 내부 구현만 `Promise.all` 병렬화.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/data/pipelineSessions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { getPipelineSessionDetail } from './pipelineSessions';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('getPipelineSessionDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('세션 문서 조회와 layer6Gates 서브컬렉션 조회를 병렬로 실행한다', async () => {
    let resolveDoc!: (value: unknown) => void;
    let resolveGates!: (value: unknown) => void;
    const docPromise = new Promise((resolve) => {
      resolveDoc = resolve;
    });
    const gatesPromise = new Promise((resolve) => {
      resolveGates = resolve;
    });

    const mockDocGet = vi.fn(() => docPromise);
    const mockGatesGet = vi.fn(() => gatesPromise);
    const mockGatesCollection = vi.fn(() => ({ get: mockGatesGet }));
    const mockDoc = vi.fn(() => ({ get: mockDocGet, collection: mockGatesCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const resultPromise = getPipelineSessionDetail('session_1');

    // 두 호출 모두 첫 await 이전에 동기적으로 나가야 한다. 순차 구현이라면
    // 이 시점에 mockGatesGet은 아직 호출되지 않았을 것이다.
    expect(mockDoc).toHaveBeenCalledTimes(1);
    expect(mockDocGet).toHaveBeenCalledTimes(1);
    expect(mockGatesGet).toHaveBeenCalledTimes(1);

    resolveDoc({
      exists: true,
      data: () => ({
        status: 'in_progress',
        runId: 'run_1',
        targetLevel: 'A1',
        combo: {},
        targetLanguages: ['en'],
        createdAt: makeTimestamp('2026-08-08T00:00:00.000Z'),
      }),
    });
    resolveGates({
      docs: [
        {
          id: 'ko',
          data: () => ({
            latestStatus: 'pass',
            ruleBaseWarnings: [],
            llmEvalReasons: [],
            retryCount: 0,
          }),
        },
      ],
    });

    const result = await resultPromise;
    expect(result?.id).toBe('session_1');
    expect(result?.layer6Gates).toEqual([
      { target: 'ko', latestStatus: 'pass', ruleBaseWarnings: [], llmEvalReasons: [], retryCount: 0 },
    ]);
  });

  it('세션 문서가 없으면 null을 반환한다', async () => {
    const mockDocGet = vi.fn().mockResolvedValue({ exists: false });
    const mockGatesGet = vi.fn().mockResolvedValue({ docs: [] });
    const mockGatesCollection = vi.fn(() => ({ get: mockGatesGet }));
    const mockDoc = vi.fn(() => ({ get: mockDocGet, collection: mockGatesCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const result = await getPipelineSessionDetail('missing');

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run lib/data/pipelineSessions.test.ts`
Expected: FAIL — 첫 번째 테스트에서 `mockGatesGet`이 아직 호출되지 않아 `toHaveBeenCalledTimes(1)`이 실패(현재 구현은 `doc.get()`을 먼저 `await`하고 나서야 `collection("layer6Gates").get()`을 호출하므로, `resolveDoc`을 부르기 전 시점엔 `mockGatesGet`이 0회 호출).

- [ ] **Step 3: `getPipelineSessionDetail()` 병렬화**

`lib/data/pipelineSessions.ts:72-107`을 다음으로 교체:

```ts
export async function getPipelineSessionDetail(
  sessionId: string,
): Promise<PipelineSessionDetail | null> {
  const db = getAdminFirestore();
  const sessionRef = db.collection("pipelineSessions").doc(sessionId);

  const [doc, gatesSnapshot] = await Promise.all([
    sessionRef.get(),
    sessionRef.collection("layer6Gates").get(),
  ]);

  if (!doc.exists) return null;
  const data = doc.data()!;

  const layer6Gates: LayerGateResult[] = gatesSnapshot.docs.map((gateDoc) => {
    const gateData = gateDoc.data();
    return {
      target: gateDoc.id,
      latestStatus: gateData.latestStatus,
      ruleBaseWarnings: gateData.ruleBaseWarnings ?? [],
      llmEvalReasons: gateData.llmEvalReasons ?? [],
      retryCount: gateData.retryCount ?? 0,
    };
  });

  return {
    id: doc.id,
    status: data.status,
    runId: data.runId,
    targetLevel: data.targetLevel,
    combo: normalizeCombo(data.combo),
    targetLanguages: data.targetLanguages ?? [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    layer6Gates,
  };
}
```

`gatesSnapshot`은 `doc.exists`가 `false`여도 이미 fetch돼 있다 (의도된 트레이드오프 — sessionId만 있으면 되는 조회라 세션 존재 여부를 기다릴 필요가 없다는 스펙 결정).

- [ ] **Step 4: 테스트 실행하여 통과 확인**

Run: `npx vitest run lib/data/pipelineSessions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 테스트 스위트 확인**

Run: `npm run test`
Expected: 기존 테스트 모두 PASS, 회귀 없음.

- [ ] **Step 6: Commit**

```bash
git add lib/data/pipelineSessions.ts lib/data/pipelineSessions.test.ts
git commit -m "perf(admin): parallelize session and gate subcollection fetch"
```

---

## Task 3: `lib/status.ts` 공유 + 상태 배지 버그 수정

**Files:**
- Modify: `components/ui/badge.tsx:9-27` (success/warning variant 추가)
- Create: `lib/status.ts`
- Test: `lib/status.test.ts`
- Modify: `app/admin/(dashboard)/generation/page.tsx:1-21`
- Modify: `app/admin/(dashboard)/generation/[sessionId]/page.tsx:1-19,74,78,83`
- Modify: `components/admin/ReviewTabs.tsx:1-17,88`

**Interfaces:**
- Produces: `statusBadgeVariant(status: string): StatusBadgeVariant`, `statusBorderClass(variant: StatusBadgeVariant): string`, `type StatusBadgeVariant = "success" | "warning" | "destructive" | "secondary" | "outline"` (`@/lib/status`).
- Consumes: `Badge` 컴포넌트의 새 `success`/`warning` variant (`@/components/ui/badge`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/status.test.ts
import { describe, it, expect } from "vitest";
import { statusBadgeVariant, statusBorderClass } from "./status";

describe("statusBadgeVariant", () => {
  it.each([
    ["pass", "success"],
    ["completed", "success"],
    ["done", "success"],
    ["fail", "destructive"],
    ["failed", "destructive"],
    ["error", "destructive"],
    ["warn", "warning"],
    ["warning", "warning"],
    ["in_progress", "secondary"],
    ["pending", "secondary"],
    ["unknown_status", "outline"],
  ] as const)("%s -> %s", (status, expected) => {
    expect(statusBadgeVariant(status)).toBe(expected);
  });
});

describe("statusBorderClass", () => {
  it("success는 emerald 보더를 반환한다", () => {
    expect(statusBorderClass("success")).toBe("border-l-emerald-500");
  });

  it("warning은 amber 보더를 반환한다", () => {
    expect(statusBorderClass("warning")).toBe("border-l-amber-500");
  });

  it("destructive는 destructive 보더를 반환한다", () => {
    expect(statusBorderClass("destructive")).toBe("border-l-destructive");
  });

  it("그 외(secondary/outline)는 기본 보더를 반환한다", () => {
    expect(statusBorderClass("outline")).toBe("border-l-border");
    expect(statusBorderClass("secondary")).toBe("border-l-border");
  });
});
```

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run lib/status.test.ts`
Expected: FAIL — `Cannot find module './status'`

- [ ] **Step 3: `Badge`에 success/warning variant 추가**

`components/ui/badge.tsx:9-27`의 `variants.variant` 객체에 두 항목 추가:

```ts
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        success:
          "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 [a]:hover:bg-emerald-500/20",
        warning:
          "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 [a]:hover:bg-amber-500/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
```

이 색상은 `--primary`(인디고)와 독립적으로 고정된 emerald/amber이므로, Task 8에서 액센트를 인디고로 바꿔도 상태색은 바뀌지 않는다.

- [ ] **Step 4: `lib/status.ts` 작성**

```ts
// lib/status.ts
export type StatusBadgeVariant = "success" | "warning" | "destructive" | "secondary" | "outline";

export function statusBadgeVariant(status: string): StatusBadgeVariant {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) return "destructive";
  if (normalized.includes("warn")) return "warning";
  if (normalized.includes("progress") || normalized.includes("pending")) return "secondary";
  if (
    normalized.includes("complete") ||
    normalized.includes("done") ||
    normalized.includes("success") ||
    normalized.includes("pass")
  ) {
    return "success";
  }
  return "outline";
}

export function statusBorderClass(variant: StatusBadgeVariant): string {
  switch (variant) {
    case "destructive":
      return "border-l-destructive";
    case "warning":
      return "border-l-amber-500";
    case "success":
      return "border-l-emerald-500";
    default:
      return "border-l-border";
  }
}
```

`"server-only"`를 import하지 않는다 — `ReviewTabs.tsx`(`"use client"`)에서도 이 모듈을 그대로 import해야 한다.

- [ ] **Step 5: 테스트 실행하여 통과 확인**

Run: `npx vitest run lib/status.test.ts`
Expected: PASS

- [ ] **Step 6: `generation/page.tsx`에서 로컬 `statusBadgeVariant` 제거하고 공유 함수 사용**

`app/admin/(dashboard)/generation/page.tsx:1-21`을 다음으로 교체:

```tsx
import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant } from "@/lib/status";
```

(파일 하단의 `<Badge variant={statusBadgeVariant(session.status)}>`는 이미 같은 이름을 쓰므로 호출부는 그대로 둔다. Task 6에서 이 파일의 테이블 부분을 클라이언트 컴포넌트로 옮길 예정이니, 지금은 import 교체와 로컬 함수 삭제만 한다.)

- [ ] **Step 7: `generation/[sessionId]/page.tsx`에서 로컬 함수 제거하고 공유 함수 사용**

`app/admin/(dashboard)/generation/[sessionId]/page.tsx:1-19`를 다음으로 교체:

```tsx
import { notFound } from "next/navigation";
import { getPipelineSessionDetail } from "@/lib/data/pipelineSessions";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant, statusBorderClass } from "@/lib/status";
```

같은 파일의 `gate` 렌더링 부분(기존 74, 78, 83행 부근)에서 `statusBadgeVariant`/`gateBorderClass` 호출을:

```tsx
          {session.layer6Gates.map((gate) => {
            const variant = statusBadgeVariant(gate.latestStatus);
            return (
              <li
                key={gate.target}
                className={`rounded-lg border-l-4 bg-card p-4 text-sm ring-1 ring-foreground/10 ${statusBorderClass(variant)}`}
              >
```

로 변경한다 (`gateBorderClass(variant)` → `statusBorderClass(variant)`, 함수 자체는 삭제).

- [ ] **Step 8: `ReviewTabs.tsx`의 게이트 배지 버그 수정**

`components/admin/ReviewTabs.tsx` 상단 import에 추가:

```tsx
import { statusBadgeVariant } from "@/lib/status";
```

기존 88행의 하드코딩된 배지:

```tsx
                <TableCell>
                  <Badge variant="outline">{item.gateStatus}</Badge>
                </TableCell>
```

를 다음으로 교체 (지금까지는 pass/fail/warn 상관없이 항상 회색 `outline`이었던 버그를 수정):

```tsx
                <TableCell>
                  <Badge variant={statusBadgeVariant(item.gateStatus)}>{item.gateStatus}</Badge>
                </TableCell>
```

- [ ] **Step 9: 빌드 및 전체 테스트 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 모두 통과. `generation/page.tsx`, `generation/[sessionId]/page.tsx`에 더 이상 로컬 `statusBadgeVariant`/`gateBorderClass` 정의가 없어야 함(중복 제거 확인).

- [ ] **Step 10: Commit**

```bash
git add components/ui/badge.tsx lib/status.ts lib/status.test.ts "app/admin/(dashboard)/generation/page.tsx" "app/admin/(dashboard)/generation/[sessionId]/page.tsx" components/admin/ReviewTabs.tsx
git commit -m "fix(admin): unify status badge logic and fix review gate badge always showing outline"
```

---

## Task 4: `EmptyTableRow` 공유 컴포넌트

**Files:**
- Create: `components/admin/EmptyTableRow.tsx`
- Modify: `components/admin/ReviewTabs.tsx` (pending/published 빈 상태 행 2곳)

**Interfaces:**
- Produces: `EmptyTableRow({ colSpan, message }: { colSpan: number; message: string })` — `@/components/admin/EmptyTableRow`, `TableRow` 안에서 `TableCell colSpan`으로 렌더링.
- Consumes: `@/components/ui/table`의 `TableRow`, `TableCell`.

(`generation/page.tsx`의 빈 상태 행은 Task 6에서 테이블 전체가 클라이언트 컴포넌트로 옮겨질 때 함께 `EmptyTableRow`로 교체한다 — 지금 손대면 Task 6에서 다시 옮겨야 하므로 이중 작업을 피한다.)

- [ ] **Step 1: `EmptyTableRow` 작성**

```tsx
// components/admin/EmptyTableRow.tsx
import { TableCell, TableRow } from "@/components/ui/table";

export function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 2: `ReviewTabs.tsx`의 pending 탭 빈 상태 행 교체**

import 추가:

```tsx
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
```

기존:

```tsx
            {pending.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  검토 대기 중인 콘텐츠가 없습니다.
                </TableCell>
              </TableRow>
            )}
```

를:

```tsx
            {pending.length === 0 && (
              <EmptyTableRow colSpan={4} message="검토 대기 중인 콘텐츠가 없습니다." />
            )}
```

로 교체.

- [ ] **Step 3: `ReviewTabs.tsx`의 published 탭 빈 상태 행 교체**

기존:

```tsx
            {published.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  게시된 콘텐츠가 없습니다.
                </TableCell>
              </TableRow>
            )}
```

를:

```tsx
            {published.length === 0 && (
              <EmptyTableRow colSpan={4} message="게시된 콘텐츠가 없습니다." />
            )}
```

로 교체.

- [ ] **Step 4: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 5: Commit**

```bash
git add components/admin/EmptyTableRow.tsx components/admin/ReviewTabs.tsx
git commit -m "refactor(admin): extract shared EmptyTableRow component"
```

---

## Task 5: `InlineError` 공유 컴포넌트

**Files:**
- Create: `components/admin/InlineError.tsx`
- Modify: `app/admin/login/page.tsx:65-69`
- Modify: `components/admin/ReviewTabs.tsx:57-61`

**Interfaces:**
- Produces: `InlineError({ message }: { message: string })` — `@/components/admin/InlineError`, 빨간 테두리 박스 안에 에러 문구를 렌더링.

(Task 6/7의 "더 보기" 버튼 에러도 이 컴포넌트를 재사용한다.)

- [ ] **Step 1: `InlineError` 작성**

```tsx
// components/admin/InlineError.tsx
export function InlineError({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
```

- [ ] **Step 2: `login/page.tsx`에서 인라인 에러 박스를 `InlineError`로 교체**

import 추가:

```tsx
import { InlineError } from "@/components/admin/InlineError";
```

기존 65-69행:

```tsx
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
```

를:

```tsx
          {error && <InlineError message={error} />}
```

로 교체.

- [ ] **Step 3: `ReviewTabs.tsx`의 게시/철회 에러 박스를 `InlineError`로 교체**

기존 57-61행:

```tsx
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
```

를:

```tsx
      {error && <InlineError message={error} />}
```

로 교체 (import는 Task 4에서 이미 추가된 `EmptyTableRow`와 함께 `InlineError`도 추가).

- [ ] **Step 4: 빌드 확인 및 로그인 페이지 수동 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

수동 확인: `npm run dev` 실행 후 `/admin/login`에서 로그인 실패를 유도(Google 로그인 팝업 취소 등)해 에러 박스가 기존과 동일하게 보이는지 확인.

- [ ] **Step 5: Commit**

```bash
git add components/admin/InlineError.tsx "app/admin/login/page.tsx" components/admin/ReviewTabs.tsx
git commit -m "refactor(admin): extract shared InlineError component"
```

---

## Task 6: 생성 목록 페이지네이션

**Files:**
- Modify: `lib/data/pipelineSessions.ts` (`listPipelineSessions()` 커서 페이지네이션)
- Create: `lib/actions/pipelineSessionsActions.ts`
- Create: `components/admin/GenerationSessionsTable.tsx`
- Modify: `app/admin/(dashboard)/generation/page.tsx`
- Modify: `app/admin/(dashboard)/page.tsx:6-11`

**Interfaces:**
- Consumes: `EmptyTableRow`(Task 4), `InlineError`(Task 5), `statusBadgeVariant`(Task 3).
- Produces: `PipelineSessionsPage = { sessions: PipelineSessionSummary[]; nextCursor: string | null }`, `listPipelineSessions(cursorId?: string): Promise<PipelineSessionsPage>`, `fetchMoreSessionsAction(cursorId: string): Promise<PipelineSessionsPage>` (`@/lib/actions/pipelineSessionsActions`).

- [ ] **Step 1: `listPipelineSessions()`에 커서 페이지네이션 추가**

`lib/data/pipelineSessions.ts:38-58`을 다음으로 교체:

```ts
const SESSIONS_PAGE_SIZE = 50;

export type PipelineSessionsPage = {
  sessions: PipelineSessionSummary[];
  nextCursor: string | null;
};

export async function listPipelineSessions(cursorId?: string): Promise<PipelineSessionsPage> {
  const db = getAdminFirestore();
  let query = db
    .collection("pipelineSessions")
    .orderBy("createdAt", "desc")
    .limit(SESSIONS_PAGE_SIZE);

  if (cursorId) {
    const cursorDoc = await db.collection("pipelineSessions").doc(cursorId).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const sessions = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      status: data.status,
      runId: data.runId,
      targetLevel: data.targetLevel,
      combo: normalizeCombo(data.combo),
      targetLanguages: data.targetLanguages ?? [],
      createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    };
  });

  return {
    sessions,
    nextCursor:
      snapshot.docs.length === SESSIONS_PAGE_SIZE
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null,
  };
}
```

`cursorId`를 실제 문서 조회로 검증한 뒤 `startAfter(cursorDoc)`(DocumentSnapshot)을 쓴다 — `createdAt` 필드가 Firestore `Timestamp`이고 클라이언트로 넘긴 값은 ISO 문자열이라 타입이 안 맞으므로, 문자열을 커서로 직접 쓰지 않고 문서 스냅샷을 다시 읽어 커서로 쓴다.

- [ ] **Step 2: 홈페이지(`/admin`)에서 변경된 반환 타입 반영**

`app/admin/(dashboard)/page.tsx:6-11`을 다음으로 교체:

```tsx
  const [sessionsPage, pending] = await Promise.all([
    listPipelineSessions(),
    fetchPendingReviews().catch(() => null),
  ]);
  const inProgressCount = sessionsPage.sessions.filter((s) => s.status === "in_progress").length;
  const pendingCount = pending === null ? "—" : pending.length;
```

- [ ] **Step 3: 서버 액션 작성**

```ts
// lib/actions/pipelineSessionsActions.ts
"use server";

import { getAdminSession } from "@/lib/auth/session";
import { listPipelineSessions, type PipelineSessionsPage } from "@/lib/data/pipelineSessions";

export async function fetchMoreSessionsAction(cursorId: string): Promise<PipelineSessionsPage> {
  const session = await getAdminSession();
  if (!session) throw new Error("관리자 로그인이 필요합니다");

  return listPipelineSessions(cursorId);
}
```

- [ ] **Step 4: 클라이언트 테이블 컴포넌트 작성 (테이블을 `generation/page.tsx`에서 이곳으로 이동)**

```tsx
// components/admin/GenerationSessionsTable.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PipelineSessionSummary } from "@/lib/data/pipelineSessions";
import { fetchMoreSessionsAction } from "@/lib/actions/pipelineSessionsActions";
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

export function GenerationSessionsTable({
  initialSessions,
  initialCursor,
}: {
  initialSessions: PipelineSessionSummary[];
  initialCursor: string | null;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      try {
        const page = await fetchMoreSessionsAction(cursor);
        setSessions((prev) => [...prev, ...page.sessions]);
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "목록을 더 불러오지 못했습니다");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{sessions.length}건 표시 중</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>세션 ID</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>레벨</TableHead>
            <TableHead>Combo</TableHead>
            <TableHead>대상 언어</TableHead>
            <TableHead>생성일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell className="font-mono text-xs">
                <Link
                  href={`/admin/generation/${session.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {session.id}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(session.status)}>{session.status}</Badge>
              </TableCell>
              <TableCell>{session.targetLevel}</TableCell>
              <TableCell className="whitespace-normal">
                {session.combo.mainPremise || "—"}
                {session.combo.genreTone && (
                  <span className="text-muted-foreground"> · {session.combo.genreTone}</span>
                )}
              </TableCell>
              <TableCell className="whitespace-normal">
                {session.targetLanguages.join(", ")}
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {session.createdAt}
              </TableCell>
            </TableRow>
          ))}
          {sessions.length === 0 && <EmptyTableRow colSpan={6} message="생성 세션이 없습니다." />}
        </TableBody>
      </Table>
      {error && <InlineError message={error} />}
      {cursor && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={isPending}
          onClick={handleLoadMore}
        >
          {isPending ? "불러오는 중..." : "더 보기"}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `generation/page.tsx`를 얇은 서버 컴포넌트로 축소**

`app/admin/(dashboard)/generation/page.tsx` 전체를 다음으로 교체:

```tsx
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { GenerationSessionsTable } from "@/components/admin/GenerationSessionsTable";

export default async function GenerationPage() {
  const { sessions, nextCursor } = await listPipelineSessions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">소설 생성 진행상황</h1>
        <p className="text-sm text-muted-foreground">최근 파이프라인 세션</p>
      </div>
      <GenerationSessionsTable initialSessions={sessions} initialCursor={nextCursor} />
    </div>
  );
}
```

- [ ] **Step 6: 빌드 및 테스트 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 통과. `generation/page.tsx`에 더 이상 `Table`/`Badge`/`statusBadgeVariant` import가 남아있지 않아야 함(테이블 렌더링 책임이 `GenerationSessionsTable`로 완전히 이동).

- [ ] **Step 7: 수동 확인**

`npm run dev` 실행 후 `/admin/generation` 접속 — 첫 페이지 50건이 보이고, 세션이 50건 이상 있으면 "더 보기" 버튼이 보이는지, 51건 미만이면 버튼이 없는지 확인 (실 데이터가 50건 미만이면 버튼 미노출이 정상).

- [ ] **Step 8: Commit**

```bash
git add lib/data/pipelineSessions.ts lib/actions/pipelineSessionsActions.ts components/admin/GenerationSessionsTable.tsx "app/admin/(dashboard)/generation/page.tsx" "app/admin/(dashboard)/page.tsx"
git commit -m "feat(admin): add cursor pagination to generation sessions list"
```

---

## Task 7: 검토/게시 발행됨 탭 페이지네이션

**Files:**
- Modify: `lib/data/stories.ts`
- Modify: `lib/actions/adminStoryActions.ts`
- Modify: `app/admin/(dashboard)/review/page.tsx`
- Modify: `components/admin/ReviewTabs.tsx`

**Interfaces:**
- Produces: `PublishedStoriesPage = { stories: PublishedStory[]; nextCursor: string | null }`, `listPublishedStories(cursorId?: string): Promise<PublishedStoriesPage>`, `fetchMorePublishedStoriesAction(cursorId: string): Promise<PublishedStoriesPage>`.
- Consumes: `InlineError`(Task 5), `EmptyTableRow`(Task 4) — 이미 `ReviewTabs.tsx`에 import돼 있음.

- [ ] **Step 1: `listPublishedStories()`에 커서 페이지네이션 추가**

`lib/data/stories.ts:14-30`을 다음으로 교체:

```ts
const PUBLISHED_STORIES_PAGE_SIZE = 100;

export type PublishedStoriesPage = {
  stories: PublishedStory[];
  nextCursor: string | null;
};

export async function listPublishedStories(cursorId?: string): Promise<PublishedStoriesPage> {
  const db = getAdminFirestore();
  let query = db
    .collection("stories")
    .orderBy("createdAt", "desc")
    .limit(PUBLISHED_STORIES_PAGE_SIZE);

  if (cursorId) {
    const cursorDoc = await db.collection("stories").doc(cursorId).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const stories = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      lang: data.lang,
      level: data.level,
      title: data.title ?? null,
      chapterCount: data.chapterCount,
      sessionId: data.sessionId,
      target: data.target,
    };
  });

  return {
    stories,
    nextCursor:
      snapshot.docs.length === PUBLISHED_STORIES_PAGE_SIZE
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null,
  };
}
```

- [ ] **Step 2: 서버 액션 추가**

`lib/actions/adminStoryActions.ts` 상단 import에 추가:

```ts
import { listPublishedStories, type PublishedStoriesPage } from "@/lib/data/stories";
```

파일 하단에 추가:

```ts
export async function fetchMorePublishedStoriesAction(
  cursorId: string,
): Promise<PublishedStoriesPage> {
  const session = await getAdminSession();
  if (!session) throw new Error("관리자 로그인이 필요합니다");

  return listPublishedStories(cursorId);
}
```

- [ ] **Step 3: `review/page.tsx`에서 변경된 반환 타입 반영**

`app/admin/(dashboard)/review/page.tsx` 전체를 다음으로 교체:

```tsx
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";
import { listPublishedStories } from "@/lib/data/stories";
import { ReviewTabs } from "@/components/admin/ReviewTabs";

export default async function ReviewPage() {
  const [pending, publishedPage] = await Promise.all([
    fetchPendingReviews(),
    listPublishedStories(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">소설 검토 / 게시 관리</h1>
      <ReviewTabs
        pending={pending}
        initialPublished={publishedPage.stories}
        initialPublishedCursor={publishedPage.nextCursor}
      />
    </div>
  );
}
```

- [ ] **Step 4: `ReviewTabs.tsx`에 published 탭 페이지네이션 배선**

`components/admin/ReviewTabs.tsx`의 props와 published 상태 관리를 다음으로 교체 (기존 `published: PublishedStory[]` prop을 `initialPublished`/`initialPublishedCursor`로 변경하고, published를 로컬 state로 승격):

```tsx
"use client";

import { useState, useTransition } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import type { PublishedStory } from "@/lib/data/stories";
import {
  publishStoryAction,
  recallStoryAction,
  fetchMorePublishedStoriesAction,
} from "@/lib/actions/adminStoryActions";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { InlineError } from "@/components/admin/InlineError";

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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [published, setPublished] = useState(initialPublished);
  const [publishedCursor, setPublishedCursor] = useState(initialPublishedCursor);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();

  function handlePublish(sessionId: string, target: string) {
    setError(null);
    startTransition(async () => {
      const result = await publishStoryAction(sessionId, target);
      if (result.error) setError(result.error);
    });
  }

  function handleRecall(sessionId: string, target: string) {
    setError(null);
    startTransition(async () => {
      const result = await recallStoryAction(sessionId, target);
      if (result.error) setError(result.error);
    });
  }

  function handleLoadMorePublished() {
    if (!publishedCursor) return;
    setLoadMoreError(null);
    startLoadMoreTransition(async () => {
      try {
        const page = await fetchMorePublishedStoriesAction(publishedCursor);
        setPublished((prev) => [...prev, ...page.stories]);
        setPublishedCursor(page.nextCursor);
      } catch (err) {
        setLoadMoreError(err instanceof Error ? err.message : "목록을 더 불러오지 못했습니다");
      }
    });
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "pending" | "published")}
      className="flex flex-col gap-4"
    >
      <TabsList variant="line" className="border-b border-border">
        <TabsTrigger value="pending">대기중 ({pending.length})</TabsTrigger>
        <TabsTrigger value="published">게시됨 ({published.length})</TabsTrigger>
      </TabsList>

      {error && <InlineError message={error} />}

      <TabsContent value="pending">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>콘텐츠</TableHead>
              <TableHead>언어 / 레벨</TableHead>
              <TableHead>게이트</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((item) => (
              <TableRow key={`${item.sessionId}_${item.target}`}>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{item.title ?? "(제목 없음)"}</div>
                  {item.ruleBaseWarnings.length > 0 && (
                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                      경고: {item.ruleBaseWarnings.join(", ")}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {item.lang} / {item.level}
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(item.gateStatus)}>{item.gateStatus}</Badge>
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
            ))}
            {pending.length === 0 && (
              <EmptyTableRow colSpan={4} message="검토 대기 중인 콘텐츠가 없습니다." />
            )}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="published">
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
              {published.map((story) => (
                <TableRow key={story.id}>
                  <TableCell className="whitespace-normal font-medium">
                    {story.title ?? "(제목 없음)"}
                  </TableCell>
                  <TableCell>
                    {story.lang} / {story.level}
                  </TableCell>
                  <TableCell>{story.chapterCount}개</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleRecall(story.sessionId, story.target)}
                    >
                      게시 철회
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {published.length === 0 && (
                <EmptyTableRow colSpan={4} message="게시된 콘텐츠가 없습니다." />
              )}
            </TableBody>
          </Table>
          {loadMoreError && <InlineError message={loadMoreError} />}
          {publishedCursor && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={isLoadingMore}
              onClick={handleLoadMorePublished}
            >
              {isLoadingMore ? "불러오는 중..." : "더 보기"}
            </Button>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 5: 빌드 및 테스트 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 통과.

- [ ] **Step 6: 수동 확인**

`npm run dev` 실행 후 `/admin/review` → "게시됨" 탭 — 발행된 스토리가 100건 이상이면 "더 보기" 버튼이 보이는지, 클릭 시 목록이 이어붙는지 확인. "대기중" 탭의 게이트 배지가 이제 pass/fail/warn에 따라 초록/빨강/노랑으로 바뀌는지 확인(Task 3 버그 수정 검증 겸함).

- [ ] **Step 7: Commit**

```bash
git add lib/data/stories.ts lib/actions/adminStoryActions.ts "app/admin/(dashboard)/review/page.tsx" components/admin/ReviewTabs.tsx
git commit -m "feat(admin): add cursor pagination to published stories tab"
```

---

## Task 8: 인디고 액센트 테마 + 홈 카드 보더

**Files:**
- Modify: `app/globals.css:51-118`
- Modify: `app/admin/(dashboard)/page.tsx` (카드 왼쪽 보더)

**Interfaces:** 없음 (순수 스타일 변경).

- [ ] **Step 1: 라이트 모드 `:root` 인디고 액센트 적용**

`app/globals.css:58,69,78,83`을 다음으로 교체 (indigo-600/500 oklch 값):

```css
  --primary: oklch(0.511 0.262 276.966);
```

(58행, 기존 `--primary: oklch(0.205 0 0);` 대체)

```css
  --ring: oklch(0.585 0.233 277.117);
```

(69행, 기존 `--ring: oklch(0.708 0 0);` 대체)

```css
  --sidebar-primary: oklch(0.511 0.262 276.966);
```

(78행, 기존 `--sidebar-primary: oklch(0.205 0 0);` 대체)

```css
  --sidebar-ring: oklch(0.708 0 0);
```

→

```css
  --sidebar-ring: oklch(0.585 0.233 277.117);
```

(83행 대체)

`--primary-foreground`(`oklch(0.985 0 0)`, 거의 흰색)는 그대로 둔다 — indigo-600 배경 위 흰 텍스트는 충분한 대비를 갖는다.

- [ ] **Step 2: 다크 모드 `.dark` 인디고 액센트 적용**

`app/globals.css:93,94,104,112,117`을 다음으로 교체:

```css
  --primary: oklch(0.585 0.233 277.117);
```

(93행, 기존 `--primary: oklch(0.922 0 0);` 대체 — indigo-500, 어두운 배경에서 충분히 밝게 보이도록 600 대신 500 사용)

```css
  --primary-foreground: oklch(0.985 0 0);
```

(94행, 기존 `--primary-foreground: oklch(0.205 0 0);` 대체 — primary가 밝은 회색에서 중간톤 인디고로 바뀌었으므로 foreground도 어두운 텍스트에서 흰 텍스트로 변경)

```css
  --ring: oklch(0.673 0.182 276.935);
```

(104행, 기존 `--ring: oklch(0.556 0 0);` 대체 — indigo-400)

```css
  --sidebar-primary: oklch(0.585 0.233 277.117);
```

(112행, 기존 `--sidebar-primary: oklch(0.488 0.243 264.376);` 대체)

```css
  --sidebar-ring: oklch(0.673 0.182 276.935);
```

(117행, 기존 `--sidebar-ring: oklch(0.556 0 0);` 대체)

- [ ] **Step 3: 홈 카드에 인디고 왼쪽 보더 추가**

`app/admin/(dashboard)/page.tsx`의 두 `Card` 컴포넌트:

```tsx
          <Card className="transition-colors hover:bg-muted/40">
```

를 (2곳 모두):

```tsx
          <Card className="border-l-4 border-l-primary transition-colors hover:bg-muted/40">
```

로 교체.

- [ ] **Step 4: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 5: 수동 시각 확인 (라이트/다크 모두)**

`npm run dev` 실행 후 브라우저에서 4개 화면(`/admin`, `/admin/generation`, `/admin/generation/[sessionId]`, `/admin/review`)을 라이트/다크 모드 각각 확인:
- 버튼/링크/포커스 링에 인디고가 적용되고, 상태 배지(성공/경고/실패)는 여전히 초록/노랑/빨강으로 인디고와 분리돼 보이는지.
- 다크 모드에서 `--primary`(인디고) 배경 위 `--primary-foreground`(흰 텍스트) 대비가 충분히 읽히는지 육안 확인 — 부족하면 `--primary`를 `oklch(0.511 0.262 276.966)`(600)로, 부족함이 여전하면 `oklch(0.673 0.182 276.935)`(400)로 조정.
- `generation`/`review` 테이블 행에 마우스를 올렸을 때 `hover:bg-muted/50` 배경이 이미 보이는지(기존 `TableRow` 컴포넌트에 내장돼 있어 별도 코드 변경 없이 확인만 하면 됨).

- [ ] **Step 6: Commit**

```bash
git add app/globals.css "app/admin/(dashboard)/page.tsx"
git commit -m "style(admin): switch accent theme from neutral to indigo"
```

---

## Task 9: 관리자 세션 검증 캐싱

**Files:**
- Modify: `lib/auth/session.ts`
- Test: `lib/auth/session.test.ts`

**Interfaces:**
- Produces: `getAdminSession(): Promise<{ uid: string } | null>` — 시그니처 불변, 내부에 TTL 60초 인메모리 캐시 추가.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/auth/session.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/lib/firebase/admin");

import { cookies } from "next/headers";
import { getAdminSession } from "./session";
import * as adminModule from "@/lib/firebase/admin";

const mockCookies = vi.mocked(cookies);
const mockGetAdminAuth = vi.mocked(adminModule.getAdminAuth);

function mockCookieValue(value: string | undefined) {
  mockCookies.mockResolvedValue({
    get: vi.fn(() => (value === undefined ? undefined : { value })),
  } as never);
}

describe("getAdminSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("세션 쿠키가 없으면 null을 반환하고 검증을 호출하지 않는다", async () => {
    mockCookieValue(undefined);
    const mockVerify = vi.fn();
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    const result = await getAdminSession();

    expect(result).toBeNull();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("TTL 이내 재요청은 캐시를 사용하고 verifySessionCookie를 다시 호출하지 않는다", async () => {
    mockCookieValue("cookie-ttl-hit");
    const mockVerify = vi.fn().mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    const first = await getAdminSession();
    vi.advanceTimersByTime(30_000);
    const second = await getAdminSession();

    expect(first).toEqual({ uid: "admin-1" });
    expect(second).toEqual({ uid: "admin-1" });
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });

  it("TTL 만료 후에는 verifySessionCookie를 다시 호출한다", async () => {
    mockCookieValue("cookie-ttl-miss");
    const mockVerify = vi.fn().mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    await getAdminSession();
    vi.advanceTimersByTime(61_000);
    await getAdminSession();

    expect(mockVerify).toHaveBeenCalledTimes(2);
  });

  it("admin 클레임이 없으면 null을 반환하고 캐시하지 않는다", async () => {
    mockCookieValue("cookie-no-admin");
    const mockVerify = vi.fn().mockResolvedValue({ uid: "user-1", admin: false });
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    const first = await getAdminSession();
    const second = await getAdminSession();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });
});
```

각 테스트는 서로 다른 쿠키 값(`cookie-ttl-hit`/`cookie-ttl-miss`/`cookie-no-admin`)을 써서 모듈 전역 캐시(`sessionCache`)가 테스트 간에 공유돼도 서로 간섭하지 않도록 한다.

- [ ] **Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run lib/auth/session.test.ts`
Expected: FAIL — 캐시가 없어 "TTL 이내 재요청" 테스트에서 `mockVerify`가 2번 호출됨(`toHaveBeenCalledTimes(1)` 실패).

- [ ] **Step 3: `lib/auth/session.ts`에 TTL 캐시 추가**

파일 전체를 다음으로 교체:

```ts
import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";
const SESSION_CACHE_TTL_MS = 60_000;
const SESSION_CACHE_PRUNE_THRESHOLD = 50;

type CachedSession = { uid: string; expiresAt: number };

const sessionCache = new Map<string, CachedSession>();

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [cookieValue, entry] of sessionCache) {
    if (entry.expiresAt <= now) sessionCache.delete(cookieValue);
  }
}

export async function getAdminSession(): Promise<{ uid: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  const cached = sessionCache.get(sessionCookie);
  if (cached && cached.expiresAt > Date.now()) {
    return { uid: cached.uid };
  }

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (decoded.admin !== true) {
      sessionCache.delete(sessionCookie);
      return null;
    }

    if (sessionCache.size > SESSION_CACHE_PRUNE_THRESHOLD) pruneExpiredSessions();
    sessionCache.set(sessionCookie, {
      uid: decoded.uid,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });
    return { uid: decoded.uid };
  } catch {
    sessionCache.delete(sessionCookie);
    return null;
  }
}
```

캐시 키는 세션 쿠키 값 그 자체다 — 로그아웃(`DELETE /api/auth/session`)은 쿠키를 지울 뿐 캐시 엔트리를 명시적으로 지우지 않지만, 지워진 쿠키는 이후 다시 조회되지 않으므로 무해하다(다음 로그인 때 새 쿠키 값으로 새 엔트리가 생김). `pruneExpiredSessions()`는 캐시 크기가 50을 넘을 때만 훑어서, 흔치 않은 관리자 로그인 빈도에서 불필요한 순회를 피한다.

- [ ] **Step 4: 테스트 실행하여 통과 확인**

Run: `npx vitest run lib/auth/session.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 전체 테스트 및 빌드 확인**

Run: `npm run lint && npm run build && npm run test`
Expected: 통과.

- [ ] **Step 6: 수동 확인**

`npm run dev`로 로그인 후 `/admin`, `/admin/generation`, `/admin/review`를 빠르게 연속 이동하면서(1분 이내) 페이지 전환이 이전보다 즉각적인지 확인. 로그아웃 후 로그인 화면으로 정상 리다이렉트되는지도 확인(캐시가 로그아웃 흐름을 깨지 않는지).

- [ ] **Step 7: Commit**

```bash
git add lib/auth/session.ts lib/auth/session.test.ts
git commit -m "perf(admin): cache session verification for 60s to skip repeat revocation checks"
```

---

## Task 10: 검토 대기 목록(외부 Cloud Function) 응답 캐싱

**Files:**
- Modify: `lib/admin-functions/storyGenerator.ts:22-37`

**Interfaces:**
- Produces: `fetchPendingReviews(): Promise<PendingReviewItem[]>` — 시그니처 불변, `fetch()` 캐시 옵션만 변경.

이 태스크는 story-generator Cloud Function 자체의 콜드스타트를 없애지 못한다(그건 별도 레포 작업) — word-bank-web 쪽에서 짧은 시간 캐싱으로 **반복 네비게이션 시 중복 호출**만 줄이는 완화책이다.

- [ ] **Step 1: `fetchPendingReviews()`의 `cache: "no-store"`를 시간 기반 재검증으로 변경**

`lib/admin-functions/storyGenerator.ts` 상단에 상수 추가:

```ts
const PENDING_REVIEWS_REVALIDATE_SECONDS = 15;
```

`lib/admin-functions/storyGenerator.ts:26-30`의 `fetch` 호출:

```ts
  const response = await fetch(`${baseUrl}/adminListPendingReviews`, {
    method: "GET",
    headers: { "x-admin-api-key": secret },
    cache: "no-store",
  });
```

를 다음으로 교체:

```ts
  const response = await fetch(`${baseUrl}/adminListPendingReviews`, {
    method: "GET",
    headers: { "x-admin-api-key": secret },
    next: { revalidate: PENDING_REVIEWS_REVALIDATE_SECONDS },
  });
```

`publishStoryAction`/`recallStoryAction`이 이미 호출하는 `revalidatePath("/admin/review")`(`lib/actions/adminStoryActions.ts`)는 Next.js 공식 문서상 해당 페이지 렌더 중 쓰인 fetch 캐시도 함께 무효화하므로, 게시/철회 직후에는 15초 캐시와 무관하게 항상 최신 데이터를 받는다.

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 3: 수동 확인**

`npm run dev`로 `/admin/review`를 연달아 두 번 새로고침(15초 이내)해 두 번째 요청이 체감상 더 빠른지 확인. 이후 대기 항목을 게시/철회하고 나서 `/admin/review`를 다시 열어 목록이 즉시 갱신되는지(캐시로 인해 stale하게 남지 않는지) 확인.

- [ ] **Step 4: Commit**

```bash
git add lib/admin-functions/storyGenerator.ts
git commit -m "perf(admin): cache pending reviews fetch for 15s to reduce cold-start impact"
```

---

## Task 12: 게이트 경고/판정 사유 가독성 개선

**Files:**
- Create: `components/admin/LabeledList.tsx`
- Modify: `app/admin/(dashboard)/generation/[sessionId]/page.tsx` (게이트 경고/판정 사유 렌더링)
- Modify: `components/admin/ReviewTabs.tsx` (대기중 탭 경고 렌더링)

**Interfaces:**
- Produces: `LabeledList({ label, items, className }: { label: string; items: string[]; className?: string })` — `@/components/admin/LabeledList`. `items`가 비어있으면 `null`을 렌더링(기존 `length > 0 &&` 가드를 컴포넌트 내부로 흡수).

- [ ] **Step 1: `LabeledList` 작성**

```tsx
// components/admin/LabeledList.tsx
export function LabeledList({
  label,
  items,
  className,
}: {
  label: string;
  items: string[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-xs font-medium">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: 생성 상세 페이지의 게이트 경고/판정 사유를 리스트로 교체**

`app/admin/(dashboard)/generation/[sessionId]/page.tsx` 상단 import에 추가:

```tsx
import { LabeledList } from "@/components/admin/LabeledList";
```

기존 (한 줄로 이어붙여 렌더링되던 부분):

```tsx
                {gate.ruleBaseWarnings.length > 0 && (
                  <p className="mt-2 text-amber-700 dark:text-amber-500">
                    경고: {gate.ruleBaseWarnings.join(", ")}
                  </p>
                )}
                {gate.llmEvalReasons.length > 0 && (
                  <p className="mt-1 text-muted-foreground">
                    판정 사유: {gate.llmEvalReasons.join(", ")}
                  </p>
                )}
```

를 다음으로 교체:

```tsx
                <LabeledList
                  label="경고"
                  items={gate.ruleBaseWarnings}
                  className="mt-2 text-sm text-amber-700 dark:text-amber-500"
                />
                <LabeledList
                  label="판정 사유"
                  items={gate.llmEvalReasons}
                  className="mt-1 text-sm text-muted-foreground"
                />
```

- [ ] **Step 3: 검토/게시 대기중 탭의 경고도 리스트로 교체**

`components/admin/ReviewTabs.tsx` 상단 import에 추가:

```tsx
import { LabeledList } from "@/components/admin/LabeledList";
```

기존:

```tsx
                  {item.ruleBaseWarnings.length > 0 && (
                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                      경고: {item.ruleBaseWarnings.join(", ")}
                    </div>
                  )}
```

를 다음으로 교체:

```tsx
                  <LabeledList
                    label="경고"
                    items={item.ruleBaseWarnings}
                    className="mt-1 text-xs text-amber-700 dark:text-amber-500"
                  />
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 5: 수동 확인**

`npm run dev`로 경고가 여러 개 있는 실제 세션의 `/admin/generation/[sessionId]`를 열어, "경고" 항목들이 한 줄로 뭉쳐 있지 않고 각각 별도 줄(bullet)로 분리돼 보이는지 확인. `/admin/review` 대기중 탭에서도 동일하게 확인.

- [ ] **Step 6: Commit**

```bash
git add components/admin/LabeledList.tsx "app/admin/(dashboard)/generation/[sessionId]/page.tsx" components/admin/ReviewTabs.tsx
git commit -m "fix(admin): render gate warnings/reasons as a list instead of a comma-joined wall of text"
```

---

## Task 13: 최종 검증

**Files:** 없음 (검증 전용).

- [ ] **Step 1: 전체 린트/빌드/테스트**

Run: `npm run lint && npm run build && npm run test`
Expected: 모두 통과, 경고 없음.

- [ ] **Step 2: 4개 화면 수동 전체 흐름 확인**

`npm run dev`로 로컬 서버 실행 후 관리자 계정으로 로그인해:
- `/admin` — 카드 2개에 왼쪽 인디고 보더, 로딩 시 스켈레톤 표시.
- `/admin/generation` — 로딩 스켈레톤 → 테이블, 상태 배지 색상(진행중=회색, 완료=초록, 실패=빨강), "더 보기"(데이터가 50건 이상일 때만).
- `/admin/generation/[sessionId]` — 로딩 스켈레톤 → 상세, 게이트 카드 왼쪽 보더 색이 pass/warn/fail에 따라 emerald/amber/destructive로 바뀌는지.
- `/admin/review` — 로딩 스켈레톤 → 탭, 대기중 탭 게이트 배지가 더 이상 항상 회색이 아닌지(버그 수정 확인), 게시됨 탭 "더 보기"(100건 이상일 때).
- 임의로 네트워크를 느리게 하거나(devtools throttling) 페이지를 새로고침해 로딩 스켈레톤이 실제 레이아웃과 비슷한 행 수/너비로 보이는지 확인.
- 로그인 → 여러 화면을 빠르게 연속 이동 → 로그아웃 → 다시 로그인까지 전체 흐름이 매끄러운지(세션 캐싱이 인증 흐름을 깨지 않는지) 확인.
- 경고가 여러 개인 세션의 상세 화면과 검토 대기중 탭에서 "경고"/"판정 사유"가 리스트로 분리되어 보이는지 확인.

- [ ] **Step 3: git status로 의도치 않은 변경 없는지 확인**

Run: `git status`
Expected: 이 계획에서 다룬 파일들만 변경 목록에 있어야 함. `docs/superpowers/plans/2026-08-09-quality-report-dashboard.md`(이 작업과 무관한 기존 untracked 파일)는 그대로 둔다.

- [ ] **Step 4: (선택) 브랜치 정리**

모든 태스크 커밋이 끝났으면 `superpowers:finishing-a-development-branch` 스킬로 넘어가 PR 생성 여부를 사용자와 논의한다.
