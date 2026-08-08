import { listPromptAnalysisReports } from "@/lib/data/promptAnalysisReports";
import { listUserFeedback } from "@/lib/data/wordFixReports";
import { listAutoHiddenWords } from "@/lib/data/wordCacheQueue";
import { QualityTrendChart } from "@/components/admin/QualityTrendChart";
import { QualityBreakdownCharts } from "@/components/admin/QualityBreakdownCharts";
import { AnalysisViewer } from "@/components/admin/AnalysisViewer";
import { UserFeedbackList } from "@/components/admin/UserFeedbackList";
import { AutoHiddenQueue } from "@/components/admin/AutoHiddenQueue";
import { Card, CardContent } from "@/components/ui/card";

export default async function QualityReportPage() {
  const [reports, feedbackPage, autoHidden] = await Promise.all([
    listPromptAnalysisReports(),
    listUserFeedback(),
    listAutoHiddenWords(),
  ]);
  const latestReport = reports[reports.length - 1];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">품질 리포트</h1>
        <p className="text-sm text-muted-foreground">
          사용자 신고 추이와 AI 분석 결과를 확인하고, 오신고로 숨겨진 단어를 복구하세요.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">주간 신고 추이</h2>
        <Card>
          <CardContent>
            <QualityTrendChart reports={reports} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">이번 주 breakdown</h2>
        <Card>
          <CardContent>
            <QualityBreakdownCharts report={latestReport} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">AI 분석 결과</h2>
        <Card>
          <CardContent>
            <AnalysisViewer reports={reports} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">사용자 피드백 원문</h2>
        <UserFeedbackList initialPage={feedbackPage} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">자동 숨김 대기열</h2>
        <AutoHiddenQueue words={autoHidden} />
      </section>
    </div>
  );
}
