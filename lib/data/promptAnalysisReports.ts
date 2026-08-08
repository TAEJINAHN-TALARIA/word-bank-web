import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export interface PromptAnalysisReport {
  id: string;
  periodStart: string;
  periodEnd: string;
  reportCount: number;
  fieldBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  feedbackCount: number;
  analysis: string;
  createdAt: string;
}

export async function listPromptAnalysisReports(): Promise<PromptAnalysisReport[]> {
  const db = getAdminFirestore();
  const snapshot = await db.collection("prompt_analysis_reports").orderBy("periodStart", "asc").get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      periodStart: data.periodStart.toDate().toISOString(),
      periodEnd: data.periodEnd.toDate().toISOString(),
      reportCount: data.reportCount,
      fieldBreakdown: data.fieldBreakdown ?? {},
      languageBreakdown: data.languageBreakdown ?? {},
      feedbackCount: data.feedbackCount,
      analysis: data.analysis,
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });
}
