import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";

export default async function AdminHomePage() {
  const [sessions, pending] = await Promise.all([listPipelineSessions(), fetchPendingReviews()]);
  const inProgressCount = sessions.filter((s) => s.status === "in_progress").length;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Word Bank Admin</h1>
      <div className="flex gap-4">
        <Link
          href="/admin/generation"
          className="rounded border border-neutral-200 p-4 hover:border-neutral-400"
        >
          <div className="text-2xl font-semibold">{inProgressCount}</div>
          <div className="text-sm text-neutral-500">진행 중인 생성 run</div>
        </Link>
        <Link
          href="/admin/review"
          className="rounded border border-neutral-200 p-4 hover:border-neutral-400"
        >
          <div className="text-2xl font-semibold">{pending.length}</div>
          <div className="text-sm text-neutral-500">검토 대기 중인 콘텐츠</div>
        </Link>
      </div>
    </div>
  );
}
