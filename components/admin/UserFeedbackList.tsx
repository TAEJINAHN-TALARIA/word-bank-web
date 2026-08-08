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
