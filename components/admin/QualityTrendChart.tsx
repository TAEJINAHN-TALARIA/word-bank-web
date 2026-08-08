"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { PromptAnalysisReport } from "@/lib/data/promptAnalysisReports";

export function QualityTrendChart({ reports }: { reports: PromptAnalysisReport[] }) {
  const data = reports.map((r) => ({
    period: new Date(r.periodStart).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
    reportCount: r.reportCount,
  }));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">아직 주간 리포트가 없습니다.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="period" fontSize={12} />
        <YAxis allowDecimals={false} fontSize={12} />
        <Tooltip />
        <Line type="monotone" dataKey="reportCount" name="신고 건수" stroke="currentColor" className="text-primary" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
