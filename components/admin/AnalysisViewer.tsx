"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { PromptAnalysisReport } from "@/lib/data/promptAnalysisReports";

export function AnalysisViewer({ reports }: { reports: PromptAnalysisReport[] }) {
  const sorted = [...reports].reverse(); // newest first for the dropdown
  const [selectedId, setSelectedId] = useState(sorted[0]?.id ?? "");
  const selected = sorted.find((r) => r.id === selectedId);

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">이번 주 신고 없음.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-fit rounded-md border border-border bg-background px-3 py-1.5 text-sm"
      >
        {sorted.map((r) => (
          <option key={r.id} value={r.id}>
            {new Date(r.periodStart).toLocaleDateString("ko-KR")} ~ {new Date(r.periodEnd).toLocaleDateString("ko-KR")}
          </option>
        ))}
      </select>
      {selected && (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{selected.analysis}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
