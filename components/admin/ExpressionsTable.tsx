"use client";

import { useEffect, useState, useTransition } from "react";
import type { Expression, ExpressionsPage } from "@/lib/data/expressions";
import { fetchMoreExpressionsAction, deleteExpressionAction } from "@/lib/actions/expressionActions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { InlineError } from "@/components/admin/InlineError";
import { ExpressionEditPanel } from "@/components/admin/ExpressionEditPanel";

export function ExpressionsTable({
  language,
  initialPage,
}: {
  language: string;
  initialPage: ExpressionsPage;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Expression | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 언어를 바꾸면 부모가 새 initialPage를 내려준다 — 로컬 상태를 그 언어 기준으로 리셋한다.
  // 항목 수정/삭제는 이 컴포넌트 내부 상태만 바꾸고 initialPage를 건드리지 않으므로,
  // 이 effect는 진짜 언어 전환 때만 발동한다(수정 저장 후 재실행되지 않음).
  useEffect(() => {
    setItems(initialPage.items);
    setCursor(initialPage.nextCursor);
    setSearch("");
    setEditing(null);
    setError(null);
  }, [language, initialPage]);

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      try {
        const page = await fetchMoreExpressionsAction(language, cursor);
        if ("error" in page) {
          setError(page.error);
          return;
        }
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "목록을 더 불러오지 못했습니다");
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteExpressionAction(language, id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    });
  }

  const visible = items.filter((item) => item.text.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="표현 검색..."
        className="w-64 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>표현</TableHead>
            <TableHead>register</TableHead>
            <TableHead>비슷한 표현</TableHead>
            <TableHead>한국어 뜻</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.text}</TableCell>
              <TableCell>{item.register}</TableCell>
              <TableCell>{item.similarExpressions.length}개</TableCell>
              <TableCell className="max-w-xs truncate">{item.meanings.ko?.definition ?? "-"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(item)}>
                    수정
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleDelete(item.id)}
                  >
                    삭제
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && <EmptyTableRow colSpan={5} message="표현이 없습니다." />}
        </TableBody>
      </Table>
      {error && <InlineError message={error} />}
      {cursor && (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={isPending} onClick={handleLoadMore}>
          {isPending ? "불러오는 중..." : "더 보기"}
        </Button>
      )}
      {editing && (
        <ExpressionEditPanel
          expression={editing}
          language={language}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
