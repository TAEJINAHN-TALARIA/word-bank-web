import { Button } from "@/components/ui/button";

export function BulkPublishBar({
  selectedCount,
  disabled,
  onPublishSelected,
  result,
}: {
  selectedCount: number;
  disabled: boolean;
  onPublishSelected: () => void;
  result: {
    successCount: number;
    failures: { sessionId: string; target: string; error: string }[];
  } | null;
}) {
  if (selectedCount === 0 && !result) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{selectedCount}건 선택됨</span>
        <Button
          type="button"
          size="sm"
          disabled={disabled || selectedCount === 0}
          onClick={onPublishSelected}
        >
          선택 게시
        </Button>
      </div>
      {result && (
        <p className="text-sm text-muted-foreground">
          {result.successCount + result.failures.length}건 중 {result.successCount}건 게시 완료
          {result.failures.length > 0 && `, ${result.failures.length}건 실패`}
        </p>
      )}
    </div>
  );
}
