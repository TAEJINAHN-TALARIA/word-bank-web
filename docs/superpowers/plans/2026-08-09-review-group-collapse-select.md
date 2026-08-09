# 검토/게시 화면 세션 그룹 collapsible + 전체선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/review`의 대기중/게시됨 탭에서 마스터 원고(세션) 그룹을 접고 펼 수 있게 하고, 대기중 탭에 페이지 전체선택 + 세션 그룹별 전체선택 체크박스를 추가한다.

**Architecture:** 새 공유 컴포넌트 `GroupCollapseToggle`(셰브런 + 클릭 토글)을 만들어 `PendingReviewsTable.tsx`/`PublishedStoriesTable.tsx` 양쪽 그룹 헤더에서 재사용한다. 접힘 상태는 "펼쳐진 그룹 키의 집합"(`expandedKeys: Set<string>`)으로 관리해 기본값이 항상 접힘이 되게 한다. 대기중 탭에는 추가로 3-state(전체/일부/없음) 체크박스를 테이블 헤더(페이지 전체)와 그룹 헤더(세션 전체)에 넣는다. 순수 클라이언트 UI 상태 변경이라 Server Action, Firestore 스키마, 기존 게시/재검증 로직은 건드리지 않는다.

**Tech Stack:** Next.js 16(App Router, Client Components), React 19, TypeScript, Tailwind, `lucide-react`(이미 설치돼 있음, 신규 설치 불필요).

## Global Constraints

- collapsible은 대기중/게시됨 두 탭 모두 적용. 기본 상태는 접힘 — 새로 나타나는 세션(새로고침 후 등)도 항상 접힌 채로 시작한다.
- 페이지 전체선택 + 그룹별 전체선택 체크박스는 대기중 탭에만 추가한다 — 게시됨 탭은 일괄 액션이 없으므로 체크박스 없이 collapse만 적용한다.
- 그룹 크기가 1(헤더 없는 평범한 행)인 항목은 대상이 아니다 — collapse도, 체크박스도 적용하지 않고 기존 그대로 렌더링한다.
- 그룹 키는 `lib/reviewGrouping.ts`의 `groupBySession`이 반환하는 `key`를 그대로 재사용한다 — 새 키 체계를 만들지 않는다.
- 접힘 상태는 컴포넌트 로컬 state로만 관리한다 — localStorage 등 영속화는 이번 범위 밖(새로고침 시 항상 기본 접힘으로 리셋).
- 새 Server Action, Firestore 스키마 변경 없음 — 순수 클라이언트 UI 상태 변경만 한다.
- 이 프로젝트엔 컴포넌트 렌더링 테스트 인프라(jsdom/RTL)가 없다 — 기존 admin 테이블 컴포넌트들과 동일하게 이번 태스크들도 전용 테스트 파일을 만들지 않는다. 검증은 `npm run lint && npm run build`(타입/빌드 확인)로 한다.
- 체크박스의 `indeterminate` 상태는 React가 JSX prop으로 지원하지 않으므로 `ref` 콜백으로 DOM에 직접 설정한다.
- 검증 명령: `npm run lint`, `npm run build`.

---

## Task 1: `GroupCollapseToggle` 공유 컴포넌트

**Files:**
- Create: `components/admin/GroupCollapseToggle.tsx`

**Interfaces:**
- Produces: `GroupCollapseToggle({ expanded, onToggle, children }: { expanded: boolean; onToggle: () => void; children: React.ReactNode }): JSX.Element` (`@/components/admin/GroupCollapseToggle`) — Task 2, 3에서 그룹 헤더 라벨을 감싸는 데 사용.

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// components/admin/GroupCollapseToggle.tsx
import { ChevronDown, ChevronRight } from "lucide-react";

export function GroupCollapseToggle({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 text-left hover:underline"
    >
      {expanded ? (
        <ChevronDown className="size-4 shrink-0" />
      ) : (
        <ChevronRight className="size-4 shrink-0" />
      )}
      {children}
    </button>
  );
}
```

`"use client"` 지시어는 필요 없다 — `EmptyTableRow`/`InlineError`/`LabeledList`와 같은 기존 선례처럼, 이 파일은 항상 이미 `"use client"`인 부모(`PendingReviewsTable.tsx`, `PublishedStoriesTable.tsx`)에서만 렌더링되므로 자체 지시어가 필요하지 않다.

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과. (이 시점엔 아직 아무 파일도 이 컴포넌트를 import하지 않아 화면에서 직접 확인은 안 되지만, 타입/린트/빌드는 독립적으로 통과해야 함 — 실제 연결은 Task 2, 3)

- [ ] **Step 3: Commit**

```bash
git add components/admin/GroupCollapseToggle.tsx
git commit -m "feat(admin): add shared GroupCollapseToggle component"
```

---

## Task 2: `PendingReviewsTable.tsx` — collapse + 전체선택

**Files:**
- Modify: `components/admin/PendingReviewsTable.tsx`

**Interfaces:**
- Consumes: `GroupCollapseToggle`(Task 1).
- Produces: 시그니처 불변(`PendingReviewsTable({ initialItems, onCountChange })`) — 내부 구현만 확장.

- [ ] **Step 1: 전체 파일 교체**

`components/admin/PendingReviewsTable.tsx` 전체를 다음으로 교체:

```tsx
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
import { GroupCollapseToggle } from "@/components/admin/GroupCollapseToggle";

function itemKey(item: { sessionId: string; target: string }) {
  return `${item.sessionId}_${item.target}`;
}

type SelectionState = "all" | "some" | "none";

export function PendingReviewsTable({
  initialItems,
  onCountChange,
}: {
  initialItems: PendingReviewItem[];
  onCountChange: (count: number) => void;
}) {
  // `initialItems`는 서버 컴포넌트가 매 렌더마다 내려주는 목록(source of truth)이다.
  // publish 후 revalidatePath("/admin/review")로 새 prop이 오면 아래에서
  // "렌더 중 상태 조정" 패턴으로 removedKeys 오버레이를 리셋해 목록이 stale해지지 않게 한다.
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [prevInitialItems, setPrevInitialItems] = useState(initialItems);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [singleError, setSingleError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    successCount: number;
    failures: { sessionId: string; target: string; error: string }[];
  } | null>(null);
  // "펼쳐진 그룹 키의 집합"으로 관리한다 — 빈 Set으로 시작하므로 모든 그룹이
  // 기본 접힘 상태가 되고, 새로고침 후 새로 나타나는 세션도 항상 접힌 채로 시작한다.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  if (prevInitialItems !== initialItems) {
    setPrevInitialItems(initialItems);
    setRemovedKeys(new Set());
  }

  const items = initialItems.filter((i) => !removedKeys.has(itemKey(i)));

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

  function toggleGroupExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isExpanded(key: string) {
    return expandedKeys.has(key);
  }

  function selectionStateOf(keys: string[]): SelectionState {
    if (keys.length === 0) return "none";
    const selectedCount = keys.filter((k) => selected.has(k)).length;
    if (selectedCount === 0) return "none";
    if (selectedCount === keys.length) return "all";
    return "some";
  }

  function toggleGroupSelected(groupItems: PendingReviewItem[]) {
    const keys = groupItems.map(itemKey);
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }

  function togglePageSelected() {
    const allKeys = items.map(itemKey);
    if (selectionStateOf(allKeys) === "all") {
      setSelected(new Set());
    } else {
      setSelected(new Set(allKeys));
    }
  }

  function handlePublish(sessionId: string, target: string) {
    setSingleError(null);
    startTransition(async () => {
      try {
        const result = await publishStoryAction(sessionId, target);
        if (result.error) {
          setSingleError(result.error);
          return;
        }
        const key = itemKey({ sessionId, target });
        setRemovedKeys((prev) => new Set(prev).add(key));
        setSelected((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } catch (err) {
        setSingleError(err instanceof Error ? err.message : "게시 실패");
      }
    });
  }

  function handleBulkPublish(targets: { sessionId: string; target: string }[]) {
    if (targets.length === 0) return;
    setBulkResult(null);
    startTransition(async () => {
      try {
        const results = await publishStoriesAction(targets);
        const failures = results.filter(
          (r): r is { sessionId: string; target: string; error: string } => Boolean(r.error),
        );
        const succeededKeys = new Set(results.filter((r) => !r.error).map((r) => itemKey(r)));
        setRemovedKeys((prev) => {
          const next = new Set(prev);
          succeededKeys.forEach((k) => next.add(k));
          return next;
        });
        setSelected((prev) => {
          const next = new Set(prev);
          succeededKeys.forEach((k) => next.delete(k));
          return next;
        });
        setBulkResult({ successCount: results.length - failures.length, failures });
      } catch (err) {
        setBulkResult({
          successCount: 0,
          failures: targets.map((t) => ({
            ...t,
            error: err instanceof Error ? err.message : "일괄 게시 실패",
          })),
        });
      }
    });
  }

  const groups = groupBySession(items, itemKey);
  const failureByKey = new Map(bulkResult?.failures.map((f) => [itemKey(f), f.error]) ?? []);
  const pageSelection = selectionStateOf(items.map(itemKey));

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
            <TableHead className="w-8">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={pageSelection === "all"}
                ref={(el) => {
                  if (el) el.indeterminate = pageSelection === "some";
                }}
                onChange={togglePageSelected}
                aria-label="전체 선택"
              />
            </TableHead>
            <TableHead>콘텐츠</TableHead>
            <TableHead>언어 / 레벨</TableHead>
            <TableHead>게이트</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ key, items: groupItems }) => {
            const label = groupItems.length > 1 ? getGroupLabel(groupItems) : null;
            const groupSelection = selectionStateOf(groupItems.map(itemKey));
            const hasWarnings = groupItems.some((i) => i.ruleBaseWarnings.length > 0);
            return (
              <Fragment key={key}>
                {label && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={groupSelection === "all"}
                        ref={(el) => {
                          if (el) el.indeterminate = groupSelection === "some";
                        }}
                        onChange={() => toggleGroupSelected(groupItems)}
                        aria-label={`${label.title} 전체 선택`}
                      />
                    </TableCell>
                    <TableCell colSpan={3} className="font-medium">
                      <GroupCollapseToggle
                        expanded={isExpanded(key)}
                        onToggle={() => toggleGroupExpanded(key)}
                      >
                        <span>
                          {label.title} ({label.level}) · {label.languageCount}개 언어
                        </span>
                        {hasWarnings && (
                          <span className="text-xs text-amber-700 dark:text-amber-500">
                            ⚠ 경고 포함
                          </span>
                        )}
                      </GroupCollapseToggle>
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
                {(!label || isExpanded(key)) &&
                  groupItems.map((item) => {
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

주요 변경점(기존 코드 대비):
- `expandedKeys` state + `toggleGroupExpanded`/`isExpanded` 추가.
- `selectionStateOf(keys)` 헬퍼로 3-state(전체/일부/없음) 판정을 그룹/페이지 양쪽에서 재사용.
- `toggleGroupSelected`, `togglePageSelected` 추가.
- 테이블 헤더 첫 칸(`w-8`)이 빈 칸에서 페이지 전체선택 체크박스로 바뀜.
- 그룹 헤더 행이 2칸(`colSpan=4` + 버튼)에서 3칸(체크박스 + `colSpan=3` + 버튼)으로 바뀌고, `GroupCollapseToggle`로 라벨을 감싸며 경고 배지를 추가.
- 그룹 항목 행 렌더링 조건이 `groupItems.map(...)`에서 `(!label || isExpanded(key)) && groupItems.map(...)`로 바뀜 — 그룹 크기 1(헤더 없음, `label` null)은 항상 렌더링되고, 헤더 있는 그룹은 펼쳐졌을 때만 렌더링.

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add components/admin/PendingReviewsTable.tsx
git commit -m "feat(admin): add collapsible groups and select-all to pending reviews table"
```

---

## Task 3: `PublishedStoriesTable.tsx` — collapse

**Files:**
- Modify: `components/admin/PublishedStoriesTable.tsx`

**Interfaces:**
- Consumes: `GroupCollapseToggle`(Task 1).
- Produces: 시그니처 불변(`PublishedStoriesTable({ initialStories, initialCursor, onCountChange })`) — 내부 구현만 확장.

- [ ] **Step 1: 전체 파일 교체**

`components/admin/PublishedStoriesTable.tsx` 전체를 다음으로 교체:

```tsx
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
import { GroupCollapseToggle } from "@/components/admin/GroupCollapseToggle";
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
  // `initialStories`는 서버 컴포넌트가 매 렌더마다 내려주는 1페이지(source of truth)다.
  // publish/recall 후 revalidatePath("/admin/review")로 새 prop이 오면 아래에서
  // "렌더 중 상태 조정" 패턴으로 로컬 오버레이(removedKeys/extraPages)를 리셋해
  // 목록이 stale해지지 않게 한다.
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [extraPages, setExtraPages] = useState<PublishedStory[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [prevInitialStories, setPrevInitialStories] = useState(initialStories);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const [recallError, setRecallError] = useState<string | null>(null);
  const [isRecalling, startRecallTransition] = useTransition();
  // "펼쳐진 그룹 키의 집합"으로 관리한다 — 빈 Set으로 시작하므로 모든 그룹이
  // 기본 접힘 상태가 되고, 새로고침 후 새로 나타나는 세션도 항상 접힌 채로 시작한다.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  if (prevInitialStories !== initialStories) {
    setPrevInitialStories(initialStories);
    setRemovedKeys(new Set());
    setExtraPages([]);
    setCursor(initialCursor);
    setLoadMoreError(null);
  }

  const stories = [...initialStories, ...extraPages].filter((s) => !removedKeys.has(s.id));

  useEffect(() => {
    onCountChange(stories.length);
  }, [stories.length, onCountChange]);

  function toggleGroupExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isExpanded(key: string) {
    return expandedKeys.has(key);
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreError(null);
    startLoadMoreTransition(async () => {
      try {
        const page = await fetchMorePublishedStoriesAction(cursor);
        if ("error" in page) {
          setLoadMoreError(page.error);
          return;
        }
        setExtraPages((prev) => [...prev, ...page.stories]);
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
      const recalled = stories.find((s) => s.sessionId === sessionId && s.target === target);
      if (recalled) {
        setRemovedKeys((prev) => new Set(prev).add(recalled.id));
      }
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
                      <GroupCollapseToggle
                        expanded={isExpanded(key)}
                        onToggle={() => toggleGroupExpanded(key)}
                      >
                        {label.title} ({label.level}) · {label.languageCount}개 언어
                      </GroupCollapseToggle>
                    </TableCell>
                  </TableRow>
                )}
                {(!label || isExpanded(key)) &&
                  items.map((story) => (
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

주요 변경점(기존 코드 대비):
- `expandedKeys` state + `toggleGroupExpanded`/`isExpanded` 추가.
- 그룹 헤더의 라벨 텍스트를 `GroupCollapseToggle`로 감쌈.
- 그룹 항목 행 렌더링 조건이 `items.map(...)`에서 `(!label || isExpanded(key)) && items.map(...)`로 바뀜 — Task 2와 동일한 규칙(그룹 크기 1은 항상 렌더링, 헤더 있는 그룹은 펼쳐졌을 때만).
- 체크박스는 추가하지 않는다(이 탭엔 일괄 액션이 없음 — Global Constraints 참고).

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add components/admin/PublishedStoriesTable.tsx
git commit -m "feat(admin): add collapsible session groups to published stories table"
```

---

## Task 4: 최종 검증

**Files:** 없음 (검증 전용).

- [ ] **Step 1: 전체 린트/빌드 확인**

Run: `npm run lint && npm run build`
Expected: 모두 통과.

- [ ] **Step 2: 수동 확인**

`npm run dev`로 관리자 로그인 후 `/admin/review`에서:
- **대기중 탭**: 10개 언어짜리 세션이 기본 접힘 상태로 보이는지(그룹당 헤더 행 하나만). 헤더를 클릭하면 펼쳐지고 다시 클릭하면 접히는지. 경고가 있는 세션은 접힌 상태에서도 헤더에 "⚠ 경고 포함" 표시가 보이는지. 그룹 크기 1(단일 언어)인 항목은 헤더 없이 평범한 행으로 그대로 보이는지.
- 테이블 헤더의 전체선택 체크박스를 누르면 대기중 전체 항목(접힌 그룹 포함)이 선택되고, `BulkPublishBar`의 선택 건수가 맞는지. 다시 누르면 전체 해제되는지.
- 그룹 헤더의 체크박스를 누르면 그 그룹 항목만 선택되는지. 그룹 내 일부만 선택된 상태에서 그룹 체크박스가 반쯤 채워진(indeterminate) 모양으로 보이는지.
- 개별 항목을 게시(성공)하면 목록에서 사라지고, 선택돼 있었다면 선택 상태도 같이 정리되는지(기존 동작 유지 확인).
- **게시됨 탭**: 세션 그룹이 기본 접힘 상태로 보이는지, 헤더 클릭으로 펼침/접힘이 되는지. 체크박스는 없는지(의도된 동작).
- 두 탭 모두 접힘 상태가 "더 보기"/게시/재검증 이후에도 이상하게 깨지지 않는지(그룹 자체가 사라지지만 않으면 상태 유지, 세션이 새로 나타나면 접힘으로 시작).

Report: 실제로 어떤 걸 확인했는지(로그인 세션 확보 방법 포함), 어떤 걸 확인 못 했는지 정리해서 알려줄 것.

- [ ] **Step 3: git status 확인**

Run: `git status`
Expected: 이 플랜에서 다룬 3개 파일(신규 1 + 수정 2)만 커밋에 반영돼 있어야 함.

- [ ] **Step 4: (선택) 브랜치 정리**

모든 태스크 커밋이 끝났으면 `superpowers:finishing-a-development-branch` 스킬로 넘어가 머지 여부를 사용자와 논의한다.
