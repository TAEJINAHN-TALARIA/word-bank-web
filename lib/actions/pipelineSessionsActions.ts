"use server";

import { getAdminSession } from "@/lib/auth/session";
import { listPipelineSessions, type PipelineSessionsPage } from "@/lib/data/pipelineSessions";

export async function fetchMoreSessionsAction(cursorId: string): Promise<PipelineSessionsPage> {
  const session = await getAdminSession();
  if (!session) throw new Error("관리자 로그인이 필요합니다");

  return listPipelineSessions(cursorId);
}
