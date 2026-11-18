"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PipelineSessionSummary } from "@/lib/data/pipelineSessions";
import { fetchMoreSessionsAction } from "@/lib/actions/pipelineSessionsActions";
import { sessionStage } from "@/lib/sessionStage";
import { Badge } from "@/components/ui/badge";
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
        if ("error" in page) {
          setError(page.error);
          return;
        }
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
            <TableHead className="text-right">다음 할 일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const stage = sessionStage(session.status, session.id);
            return (
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
                <Badge variant={stage.variant}>{stage.label}</Badge>
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
              <TableCell className="text-right">
                {stage.next ? (
                  <Link href={stage.next.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {stage.next.label}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">{session.status === "in_progress" ? "자동 진행 중" : "—"}</span>
                )}
              </TableCell>
            </TableRow>
            );
          })}
          {sessions.length === 0 && <EmptyTableRow colSpan={7} message="생성 세션이 없습니다." />}
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
