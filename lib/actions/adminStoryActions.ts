"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import {
  publishStory as callPublishStory,
  recallStory as callRecallStory,
} from "@/lib/admin-functions/storyGenerator";
import { listPublishedStories, type PublishedStoriesPage } from "@/lib/data/stories";

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

/**
 * Next.js는 프로덕션에서 Server Action이 throw한 에러 메시지를 마스킹한다.
 * 따라서 실패는 예외 대신 `{ error }` 형태로 반환해 클라이언트가 그대로 표시할 수 있게 한다.
 */
export type FetchMorePublishedStoriesResult = PublishedStoriesPage | { error: string };

export async function fetchMorePublishedStoriesAction(
  cursorId: string,
): Promise<FetchMorePublishedStoriesResult> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  return listPublishedStories(cursorId);
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

export async function publishStoriesAction(
  items: { sessionId: string; target: string }[],
): Promise<{ sessionId: string; target: string; error?: string }[]> {
  const session = await getAdminSession();
  if (!session) {
    return items.map((item) => ({ ...item, error: "관리자 로그인이 필요합니다" }));
  }

  const results = await Promise.allSettled(
    items.map((item) => callPublishStory(item.sessionId, item.target)),
  );

  const mapped = results.map((result, i) => {
    const item = items[i];
    if (result.status === "fulfilled") return { ...item };
    return {
      ...item,
      error: result.reason instanceof Error ? result.reason.message : "게시 실패",
    };
  });

  revalidatePath("/admin/review");
  return mapped;
}
