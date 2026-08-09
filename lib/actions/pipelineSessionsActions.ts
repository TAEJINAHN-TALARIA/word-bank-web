"use server";

import { getAdminSession } from "@/lib/auth/session";
import { listPipelineSessions, type PipelineSessionsPage } from "@/lib/data/pipelineSessions";

/**
 * Next.js는 프로덕션에서 Server Action이 throw한 에러 메시지를 마스킹한다.
 * 따라서 실패는 예외 대신 `{ error }` 형태로 반환해 클라이언트가 그대로 표시할 수 있게 한다.
 */
export type FetchMoreSessionsResult = PipelineSessionsPage | { error: string };

export async function fetchMoreSessionsAction(
  cursorId: string,
): Promise<FetchMoreSessionsResult> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  return listPipelineSessions(cursorId);
}
