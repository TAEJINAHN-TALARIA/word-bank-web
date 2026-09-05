import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type Expression = {
  id: string;
  text: string;
  register: "casual" | "formal";
  meanings: Record<string, { definition: string; example: { sentence: string; translation: string } }>;
  similarExpressions: string[];
  createdAt: string;
};

export type ExpressionsPage = {
  items: Expression[];
  nextCursor: string | null;
};

export type ExpressionPoolConfigRow = {
  language: string;
  targetSize: number;
  currentCount: number;
};

export type ExpressionBatchJob = {
  id: string;
  language: string;
  count: number;
  status: "pending" | "running" | "succeeded" | "failed";
  requestedBy: "auto" | "manual";
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

const EXPRESSIONS_PAGE_SIZE = 50;
const BATCH_JOBS_LIMIT = 30;

export async function listExpressions(language: string, cursor?: string): Promise<ExpressionsPage> {
  const db = getAdminFirestore();
  const itemsRef = db.collection("expressions").doc(language).collection("items");
  let query = itemsRef.orderBy("createdAt", "desc");

  if (cursor) {
    const cursorDoc = await itemsRef.doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.limit(EXPRESSIONS_PAGE_SIZE + 1).get();
  const hasMore = snapshot.docs.length > EXPRESSIONS_PAGE_SIZE;
  const pageDocs = hasMore ? snapshot.docs.slice(0, EXPRESSIONS_PAGE_SIZE) : snapshot.docs;

  const items = pageDocs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      text: data.text,
      register: data.register,
      meanings: data.meanings ?? {},
      similarExpressions: Array.isArray(data.similarExpressions) ? data.similarExpressions : [],
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });

  return {
    items,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : null,
  };
}

export async function listExpressionPoolConfigs(languages: string[]): Promise<ExpressionPoolConfigRow[]> {
  const db = getAdminFirestore();

  return Promise.all(
    languages.map(async (language) => {
      const [configDoc, countSnap] = await Promise.all([
        db.collection("expressionPoolConfig").doc(language).get(),
        db.collection("expressions").doc(language).collection("items").count().get(),
      ]);
      const targetSize = configDoc.exists ? (configDoc.data()?.targetSize ?? 0) : 0;
      return { language, targetSize, currentCount: countSnap.data().count };
    }),
  );
}

export async function listExpressionBatchJobs(language?: string): Promise<ExpressionBatchJob[]> {
  const db = getAdminFirestore();
  const base = language
    ? db.collection("expressionBatchJobs").where("language", "==", language)
    : db.collection("expressionBatchJobs");
  const snapshot = await base.orderBy("createdAt", "desc").limit(BATCH_JOBS_LIMIT).get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      language: data.language,
      count: data.count,
      status: data.status,
      requestedBy: data.requestedBy,
      createdAt: data.createdAt.toDate().toISOString(),
      completedAt: data.completedAt ? data.completedAt.toDate().toISOString() : null,
      error: data.error ?? null,
    };
  });
}
