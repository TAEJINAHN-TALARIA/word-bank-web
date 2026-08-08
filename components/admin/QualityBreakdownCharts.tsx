"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { PromptAnalysisReport } from "@/lib/data/promptAnalysisReports";

function toChartData(breakdown: Record<string, number>) {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function BreakdownBarChart({ data, emptyLabel }: { data: { name: string; count: number }[]; emptyLabel: string }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis type="number" allowDecimals={false} fontSize={12} />
        <YAxis type="category" dataKey="name" fontSize={12} width={100} />
        <Tooltip />
        <Bar dataKey="count" fill="currentColor" className="text-primary" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function QualityBreakdownCharts({ report }: { report: PromptAnalysisReport | undefined }) {
  if (!report) {
    return <p className="text-sm text-muted-foreground">이번 주 신고 없음.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">필드별</h3>
        <BreakdownBarChart data={toChartData(report.fieldBreakdown)} emptyLabel="필드별 데이터 없음" />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">언어별</h3>
        <BreakdownBarChart data={toChartData(report.languageBreakdown)} emptyLabel="언어별 데이터 없음" />
      </div>
    </div>
  );
}
