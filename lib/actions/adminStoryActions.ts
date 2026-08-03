"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import {
  publishStory as callPublishStory,
  recallStory as callRecallStory,
} from "@/lib/admin-functions/storyGenerator";

export async function publishStoryAction(
  sessionId: string,
  target: string,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await callPublishStory(sessionId, target);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "게시 실패" };
  }
  revalidatePath("/admin/review");
  return {};
}

export async function recallStoryAction(
  sessionId: string,
  target: string,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await callRecallStory(sessionId, target);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "철회 실패" };
  }
  revalidatePath("/admin/review");
  return {};
}
