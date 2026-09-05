"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { submitExpressionBatch } from "@/lib/admin-functions/expressionPool";
import { listExpressions, type Expression, type ExpressionsPage } from "@/lib/data/expressions";

const UPDATE_ALLOWED_KEYS = ["text", "register", "meanings", "similarExpressions"] as const;
type ExpressionUpdate = Partial<Pick<Expression, "text" | "register" | "meanings" | "similarExpressions">>;

export async function updateExpressionAction(
  language: string,
  id: string,
  updates: ExpressionUpdate,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  const invalidKey = Object.keys(updates).find(
    (key) => !UPDATE_ALLOWED_KEYS.includes(key as (typeof UPDATE_ALLOWED_KEYS)[number]),
  );
  if (invalidKey) return { error: `허용되지 않은 필드입니다: ${invalidKey}` };

  try {
    await getAdminFirestore()
      .collection("expressions")
      .doc(language)
      .collection("items")
      .doc(id)
      .update(updates);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "수정 실패" };
  }
  revalidatePath("/admin/expressions");
  return {};
}

export async function deleteExpressionAction(language: string, id: string): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await getAdminFirestore().collection("expressions").doc(language).collection("items").doc(id).delete();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "삭제 실패" };
  }
  revalidatePath("/admin/expressions");
  return {};
}

export async function updateExpressionPoolConfigAction(
  language: string,
  targetSize: number,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  if (!Number.isInteger(targetSize) || targetSize < 0) {
    return { error: "목표 풀 크기는 0 이상의 정수여야 합니다" };
  }

  try {
    await getAdminFirestore()
      .collection("expressionPoolConfig")
      .doc(language)
      .set({ targetSize, updatedAt: new Date() }, { merge: true });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "설정 저장 실패" };
  }
  revalidatePath("/admin/expressions");
  return {};
}

export async function submitExpressionBatchAction(
  language: string,
  count: number,
): Promise<{ jobId?: string; error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    const result = await submitExpressionBatch(language, count);
    revalidatePath("/admin/expressions");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "생성 요청 실패" };
  }
}

export async function fetchMoreExpressionsAction(language: string, cursor: string): Promise<ExpressionsPage> {
  return listExpressions(language, cursor);
}
