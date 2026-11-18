"use client";

import Link from "next/link";
import type { MasterReviewSummary } from "@/lib/data/masterReviews";
import type { PublishedStory } from "@/lib/data/stories";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { cn } from "@/lib/utils";

const TOTAL_CHAPTERS = 10;

export function EditTabs({
  pending,
  published,
}: {
  pending: MasterReviewSummary[];
  published: PublishedStory[];
}) {
  return (
    <Tabs defaultValue="pending" className="flex flex-col gap-4">
      <TabsList variant="line" className="border-b border-border">
        <TabsTrigger value="pending">편집 대기 ({pending.length})</TabsTrigger>
        <TabsTrigger value="published">게시된 소설 ({published.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead>레벨</TableHead>
              <TableHead>실행</TableHead>
              <TableHead>확인</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((item) => (
              <TableRow key={item.sessionId}>
                <TableCell className="whitespace-normal font-medium">{item.title ?? "(제목 없음)"}</TableCell>
                <TableCell>{item.level}</TableCell>
                <TableCell>{item.executionPath === "onDemand" ? "온디맨드" : "월간 배치"}</TableCell>
                <TableCell>
                  {item.confirmedCount}/{TOTAL_CHAPTERS}
                </TableCell>
                <TableCell>
                  {item.gateNote ? <Badge variant="warning">게이트 실패로 복귀</Badge> : <Badge variant="secondary">검토 대기</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/admin/edit/${item.sessionId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    열기
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {pending.length === 0 && <EmptyTableRow colSpan={6} message="편집을 기다리는 소설이 없습니다." />}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="published">
        <p className="mb-3 text-sm text-muted-foreground">
          한국어 게시본만 표현을 다듬을 수 있어요. 최근 게시된 순으로 최대 100건까지 보여줍니다.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead>레벨</TableHead>
              <TableHead>챕터</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {published.map((story) => (
              <TableRow key={story.id}>
                <TableCell className="whitespace-normal font-medium">{story.title ?? "(제목 없음)"}</TableCell>
                <TableCell>{story.level}</TableCell>
                <TableCell>{story.chapterCount}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/admin/edit/published/${story.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    편집
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {published.length === 0 && <EmptyTableRow colSpan={4} message="게시된 한국어 소설이 없습니다." />}
          </TableBody>
        </Table>
      </TabsContent>
    </Tabs>
  );
}
