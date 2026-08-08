"use client";

import { useState, useTransition } from "react";
import type { AutoHiddenWord } from "@/lib/data/wordCacheQueue";
import { restoreWordCacheEntryAction } from "@/lib/actions/wordCacheActions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AutoHiddenQueue({ words }: { words: AutoHiddenWord[] }) {
  const [restored, setRestored] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRestore(cacheKey: string) {
    setError(null);
    startTransition(async () => {
      const result = await restoreWordCacheEntryAction(cacheKey);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRestored((prev) => new Set(prev).add(cacheKey));
    });
  }

  const visible = words.filter((w) => !restored.has(w.cacheKey));

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>단어</TableHead>
            <TableHead>언어쌍</TableHead>
            <TableHead>신고 수</TableHead>
            <TableHead>마지막 갱신</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((w) => (
            <TableRow key={w.cacheKey}>
              <TableCell className="font-medium">{w.word}</TableCell>
              <TableCell>{w.wordLanguage} → {w.meaningLanguage}</TableCell>
              <TableCell>{w.reportCount}</TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(w.updatedAt).toLocaleString("ko-KR")}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRestore(w.cacheKey)}
                >
                  복구
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                자동 숨김 대기 중인 단어가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
