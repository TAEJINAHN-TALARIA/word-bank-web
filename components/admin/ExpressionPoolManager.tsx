"use client";

import { useState, useTransition } from "react";
import type { ExpressionPoolConfigRow, ExpressionsPage, ExpressionBatchJob } from "@/lib/data/expressions";
import { LANG_NAMES } from "@/lib/constants/languages";
import {
  fetchMoreExpressionsAction,
  fetchExpressionBatchJobsAction,
  updateExpressionPoolConfigAction,
  submitExpressionBatchAction,
} from "@/lib/actions/expressionActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineError } from "@/components/admin/InlineError";
import { ExpressionsTable } from "@/components/admin/ExpressionsTable";
import { ExpressionBatchJobsTable } from "@/components/admin/ExpressionBatchJobsTable";

export function ExpressionPoolManager({
  configs,
  initialLanguage,
  initialExpressionsPage,
  initialJobs,
}: {
  configs: ExpressionPoolConfigRow[];
  initialLanguage: string;
  initialExpressionsPage: ExpressionsPage;
  initialJobs: ExpressionBatchJob[];
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const [expressionsPage, setExpressionsPage] = useState(initialExpressionsPage);
  const [jobs, setJobs] = useState(initialJobs);
  const [targetSizeInput, setTargetSizeInput] = useState(
    String(configs.find((c) => c.language === initialLanguage)?.targetSize ?? 0),
  );
  const [overrideCount, setOverrideCount] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentConfig = configs.find((c) => c.language === language);

  function handleLanguageChange(next: string) {
    setLanguage(next);
    setTargetSizeInput(String(configs.find((c) => c.language === next)?.targetSize ?? 0));
    setError(null);
    setNotice(null);
    setExpressionsPage({ items: [], nextCursor: null });
    setJobs([]);
    startTransition(async () => {
      const [page, jobsResult] = await Promise.all([
        fetchMoreExpressionsAction(next, ""),
        fetchExpressionBatchJobsAction(next),
      ]);
      if ("error" in page) {
        setError(page.error);
        return;
      }
      setExpressionsPage(page);

      if ("error" in jobsResult) {
        setError(jobsResult.error);
        return;
      }
      setJobs(jobsResult);
    });
  }

  function handleSaveTargetSize() {
    const targetSize = Number(targetSizeInput);
    setError(null);
    startTransition(async () => {
      const result = await updateExpressionPoolConfigAction(language, targetSize);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice("목표 풀 크기를 저장했습니다.");
    });
  }

  function handleSubmitOverride() {
    const count = Number(overrideCount);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await submitExpressionBatchAction(language, count);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(`생성 작업을 제출했습니다 (jobId: ${result.jobId}). 완료되면 자동으로 풀에 반영됩니다.`);

      const jobsResult = await fetchExpressionBatchJobsAction(language);
      if ("error" in jobsResult) {
        return;
      }
      setJobs(jobsResult);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          언어
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="w-fit rounded-md border border-input bg-background px-3 py-1.5"
          >
            {Object.entries(LANG_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          현재 풀 크기
          <span className="px-1 py-1.5 font-medium">{currentConfig?.currentCount ?? 0}개</span>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          목표 풀 크기
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={targetSizeInput}
              onChange={(e) => setTargetSizeInput(e.target.value)}
              className="w-24 rounded-md border border-input bg-background px-3 py-1.5"
            />
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleSaveTargetSize}>
              저장
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          지금 바로 생성
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={50}
              value={overrideCount}
              onChange={(e) => setOverrideCount(e.target.value)}
              className="w-20 rounded-md border border-input bg-background px-3 py-1.5"
            />
            <Button type="button" size="sm" disabled={isPending} onClick={handleSubmitOverride}>
              생성
            </Button>
          </div>
        </label>
      </div>

      {error && <InlineError message={error} />}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <Card>
        <CardContent>
          <ExpressionsTable language={language} initialPage={expressionsPage} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">생성 작업 현황</h2>
        <Card>
          <CardContent>
            <ExpressionBatchJobsTable jobs={jobs} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
