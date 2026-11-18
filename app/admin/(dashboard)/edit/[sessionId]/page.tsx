import { notFound } from "next/navigation";
import { getMasterReview } from "@/lib/data/masterReviews";
import { MasterEditor } from "@/components/admin/MasterEditor";

// 이 페이지의 Server Action(Claude 전체 점검 등)은 오래 걸릴 수 있어 실행 시간 상한을 늘린다.
export const maxDuration = 300;

export default async function MasterReviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const detail = await getMasterReview(sessionId);
  if (!detail) notFound();

  return <MasterEditor detail={detail} />;
}
