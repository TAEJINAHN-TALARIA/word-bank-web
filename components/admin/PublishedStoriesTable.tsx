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
