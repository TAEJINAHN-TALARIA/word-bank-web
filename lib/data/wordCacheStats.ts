import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AggregateField } from "firebase-admin/firestore";

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

export interface LanguagePairVolume {
  wordLanguage: string;
  meaningLanguage: string;
  hitCount: number;
}

export async function getSearchVolumeByLanguagePair(
  discovered: LanguageCacheLoad[],
): Promise<LanguagePairVolume[]> {
  if (discovered.length === 0) return [];

  const collection = getAdminFirestore().collection("word_cache");
  const candidates = discovered.flatMap(({ wordLanguage }) =>
    LANGUAGE_CODES.map((meaningLanguage) => ({ wordLanguage, meaningLanguage })),
  );

  const results = await Promise.all(
    candidates.map(async ({ wordLanguage, meaningLanguage }) => {
      const snapshot = await collection
        .where("wordLanguage", "==", wordLanguage)
        .where("meaningLanguage", "==", meaningLanguage)
        .aggregate({ total: AggregateField.sum("hitCount") })
        .get();
      return { wordLanguage, meaningLanguage, hitCount: snapshot.data().total };
    }),
  );

  return results.filter((r) => r.hitCount > 0).sort((a, b) => b.hitCount - a.hitCount);
}

export interface TopWord {
  word: string;
  hitCount: number;
}

export async function getTopWordsForPair(
  wordLanguage: string,
  meaningLanguage: string,
  limitCount = 10,
): Promise<TopWord[]> {
  const snapshot = await getAdminFirestore()
    .collection("word_cache")
    .where("wordLanguage", "==", wordLanguage)
    .where("meaningLanguage", "==", meaningLanguage)
    .orderBy("hitCount", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { word: data.word, hitCount: data.hitCount };
  });
}

export interface SearchFailureRate {
  wordLanguage: string;
  meaningLanguage: string;
  failCount: number;
  hitCount: number;
  failureRatio: number;
}

export async function getSearchFailureRates(
  pairVolumes: LanguagePairVolume[],
): Promise<SearchFailureRate[]> {
  const snapshot = await getAdminFirestore().collection("word_search_failures").get();

  const hitCountByPairKey = new Map(
    pairVolumes.map((p) => [`${p.wordLanguage}_${p.meaningLanguage}`, p.hitCount]),
  );

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      const failCount: number = data.failCount ?? 0;
      const hitCount = hitCountByPairKey.get(doc.id) ?? 0;
      const total = failCount + hitCount;
      return {
        wordLanguage: data.wordLanguage,
        meaningLanguage: data.meaningLanguage,
        failCount,
        hitCount,
        failureRatio: total > 0 ? failCount / total : 0,
      };
    })
    .sort((a, b) => b.failureRatio - a.failureRatio);
}

const LOCALE_SAMPLE_SIZE = 2000;
const UNKNOWN_LOCALE_LABEL = "알 수 없음";

export interface LocaleDistribution {
  locale: string;
  count: number;
}

export async function getLocaleDistribution(): Promise<LocaleDistribution[]> {
  const snapshot = await getAdminFirestore()
    .collection("word_cache")
    .orderBy("createdAt", "desc")
    .limit(LOCALE_SAMPLE_SIZE)
    .select("locale")
    .get();

  const counts = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const locale = (doc.data().locale as string | undefined) ?? UNKNOWN_LOCALE_LABEL;
    counts.set(locale, (counts.get(locale) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([locale, count]) => ({ locale, count }))
    .sort((a, b) => b.count - a.count);
}
