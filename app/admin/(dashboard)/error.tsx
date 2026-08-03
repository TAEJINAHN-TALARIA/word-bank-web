"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex flex-col gap-3 py-6">
          <div>
            <h2 className="text-lg font-semibold text-destructive">
              페이지를 불러오는 중 오류가 발생했습니다
            </h2>
            <p className="text-sm text-muted-foreground">
              일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={reset}>
            다시 시도
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
