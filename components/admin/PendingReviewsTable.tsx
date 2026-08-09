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

function itemKey(item: { sessionId: string; target: string }) {
  return `${item.sessionId}_${item.target}`;
}

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
            <TableHead className="w-8" />
            <TableHead>콘텐츠</TableHead>
            <TableHead>언어 / 레벨</TableHead>
            <TableHead>게이트</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ key, items: groupItems }) => {
            const label = groupItems.length > 1 ? getGroupLabel(groupItems) : null;
            return (
              <Fragment key={key}>
                {label && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={4} className="font-medium">
                      {label.title} ({label.level}) · {label.languageCount}개 언어
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
                {groupItems.map((item) => {
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
