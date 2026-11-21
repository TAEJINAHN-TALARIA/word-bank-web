import "server-only";
import { cache } from "react";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { NavCounts } from "@/lib/adminNav";

// 메뉴 옆 숫자와 홈의 단계별 숫자. 모든 관리자 페이지가 렌더링할 때마다 읽으므로 문서를 읽지 않고 count() 집계만 쓴다.
// 항목별로 실패를 격리한다 — 한 집계(인덱스 없음, 환경변수 없음 등)가 실패해도 메뉴·페이지가 깨지지 않고 그 숫자만 빠진다.
//
// 검토·게시 대기 수는 일부러 여기 넣지 않았다. 그 수는 story-generator 함수가 완료된 세션을 전부 훑어 계산해서
// 페이지마다 부르기엔 비싸다 — 홈과 검토·게시 화면에서만 보여준다.
async function countOrNull(label: string, run: () => Promise<number>): Promise<number | null> {
  try {
    return await run();
  } catch (error) {
    console.error(`[admin-nav] ${label} 집계 실패`, error);
    return null;
  }
}

const sessionsWhereStatus = (status: string) => async () =>
  (await getAdminFirestore().collection("pipelineSessions").where("status", "==", status).count().get()).data().count;

// 레이아웃과 페이지가 한 요청 안에서 같은 값을 쓰므로 React cache로 한 번만 조회한다.
export const getAdminNavCounts = cache(async (): Promise<NavCounts> => {
  const [stuck, editPending, autoHidden] = await Promise.all([
    countOrNull("막힌 세션", sessionsWhereStatus("on_hold")),
    countOrNull("편집 대기", sessionsWhereStatus("awaiting_master_review")),
    countOrNull("자동 숨김", async () =>
      (await getAdminFirestore().collection("word_cache").where("reportCount", ">=", 3).count().get()).data().count),
  ]);
  return { stuck, editPending, autoHidden };
});

export type HomeStageCounts = { inProgress: number | null; published: number | null };

export const getHomeStageCounts = cache(async (): Promise<HomeStageCounts> => {
  const [inProgress, published] = await Promise.all([
    countOrNull("진행 중 세션", sessionsWhereStatus("in_progress")),
    countOrNull("게시된 소설", async () => (await getAdminFirestore().collection("stories").count().get()).data().count),
  ]);
  return { inProgress, published };
});
