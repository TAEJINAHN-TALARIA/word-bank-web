"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";

export async function restoreWordCacheEntryAction(
  cacheKey: string,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await getAdminFirestore().collection("word_cache").doc(cacheKey).update({ reportCount: 0 });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "복구 실패" };
  }
  revalidatePath("/admin/quality");
  return {};
}
