"use client";

import { useState, useTransition } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import type { PublishedStory } from "@/lib/data/stories";
import { publishStoryAction, recallStoryAction } from "@/lib/actions/adminStoryActions";
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

export function ReviewTabs({
  pending,
  published,
}: {
  pending: PendingReviewItem[];
  published: PublishedStory[];
}) {
  const [tab, setTab] = useState<"pending" | "published">("pending");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

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
                  <Badge variant="outline">{item.gateStatus}</Badge>
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
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  검토 대기 중인 콘텐츠가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="published">
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
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  게시된 콘텐츠가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TabsContent>
    </Tabs>
  );
}
