"use server";

import { getAdminSession } from "@/lib/auth/session";
import { getTopWordsForPair } from "@/lib/data/wordCacheStats";
import type { TopWord } from "@/lib/data/wordCacheStats";

export async function fetchTopWordsAction(
  wordLanguage: string,
  meaningLanguage: string,
): Promise<TopWord[]> {
  const session = await getAdminSession();
  if (!session) return [];

  return getTopWordsForPair(wordLanguage, meaningLanguage);
}
