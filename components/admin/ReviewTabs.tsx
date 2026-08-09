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
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { InlineError } from "@/components/admin/InlineError";
import { LabeledList } from "@/components/admin/LabeledList";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
