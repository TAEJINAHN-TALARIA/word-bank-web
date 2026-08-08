"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { LocaleDistribution } from "@/lib/data/wordCacheStats";

export function LocaleDistributionChart({ distribution }: { distribution: LocaleDistribution[] }) {
  if (distribution.length === 0) {
    return <p className="text-sm text-muted-foreground">locale 데이터 없음</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, distribution.length * 32)}>
      <BarChart data={distribution} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis type="number" allowDecimals={false} fontSize={12} />
        <YAxis type="category" dataKey="locale" fontSize={12} width={100} />
        <Tooltip />
        <Bar dataKey="count" fill="currentColor" className="text-primary" />
      </BarChart>
    </ResponsiveContainer>
  );
}
