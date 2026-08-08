import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export interface AutoHiddenWord {
  cacheKey: string;
  word: string;
  wordLanguage: string;
  meaningLanguage: string;
  reportCount: number;
  updatedAt: string;
}

export async function listAutoHiddenWords(): Promise<AutoHiddenWord[]> {
  const db = getAdminFirestore();
  const snapshot = await db
    .collection("word_cache")
    .where("reportCount", ">=", 3)
    .orderBy("updatedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      cacheKey: doc.id,
      word: data.word,
      wordLanguage: data.wordLanguage,
      meaningLanguage: data.meaningLanguage,
      reportCount: data.reportCount,
      updatedAt: data.updatedAt.toDate().toISOString(),
    };
  });
}
