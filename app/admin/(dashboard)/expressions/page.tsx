import { LANG_NAMES } from "@/lib/constants/languages";
import { listExpressionPoolConfigs, listExpressions, listExpressionBatchJobs } from "@/lib/data/expressions";
import { ExpressionPoolManager } from "@/components/admin/ExpressionPoolManager";

const DEFAULT_LANGUAGE = "en";

export default async function ExpressionPoolPage() {
  const languages = Object.keys(LANG_NAMES);
  const [configs, initialExpressionsPage, initialJobs] = await Promise.all([
    listExpressionPoolConfigs(languages),
    listExpressions(DEFAULT_LANGUAGE),
    listExpressionBatchJobs(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">표현 풀 관리</h1>
        <p className="text-sm text-muted-foreground">
          언어별 표현 추천 풀을 조회·수정하고, 목표 풀 크기와 생성 작업 현황을 확인하세요.
        </p>
      </div>
      <ExpressionPoolManager
        configs={configs}
        initialLanguage={DEFAULT_LANGUAGE}
        initialExpressionsPage={initialExpressionsPage}
        initialJobs={initialJobs}
      />
    </div>
  );
}
