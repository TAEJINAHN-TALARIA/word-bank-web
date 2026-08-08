import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

// word-bank 앱이 지원하는 언어 코드 목록. word_cache에 실제로 어떤 wordLanguage 값이
// 존재하는지 Firestore에는 distinct 쿼리가 없어 직접 물어볼 수 없으므로, 이 알려진
// 후보 목록을 count()/sum() 집계 쿼리로 하나씩 훑어 "실제 존재하는 값"만 골라낸다.
// word-bank 저장소 functions/src/langNames.ts와 동기화 상태를 유지해야 한다.
export const LANGUAGE_CODES = [
  "en", "ko", "ja", "zh", "fr", "de", "es", "it",
  "pt", "ar", "la", "hi", "bn", "ru", "id",
] as const;

export interface LanguageCacheLoad {
  wordLanguage: string;
  count: number;
}

export async function getCacheLoadByLanguage(): Promise<LanguageCacheLoad[]> {
  const collection = getAdminFirestore().collection("word_cache");

  const results = await Promise.all(
    LANGUAGE_CODES.map(async (wordLanguage) => {
      const snapshot = await collection.where("wordLanguage", "==", wordLanguage).count().get();
      return { wordLanguage, count: snapshot.data().count };
    }),
  );

  return results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}
