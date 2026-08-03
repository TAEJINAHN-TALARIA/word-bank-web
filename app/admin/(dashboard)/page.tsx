import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";
import { Card, CardContent } from "@/components/ui/card";

export default async function AdminHomePage() {
  const [sessions, pending] = await Promise.all([
    listPipelineSessions(),
    fetchPendingReviews().catch(() => null),
  ]);
  const inProgressCount = sessions.filter((s) => s.status === "in_progress").length;
  const pendingCount = pending === null ? "—" : pending.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Word Bank Admin</h1>
        <p className="text-sm text-muted-foreground">
          생성 파이프라인과 콘텐츠 검토 현황을 한눈에 확인하세요.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:max-w-xl sm:grid-cols-2">
        <Link href="/admin/generation" className="block">
          <Card className="transition-colors hover:bg-muted/40">
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">{inProgressCount}</div>
              <div className="text-sm text-muted-foreground">진행 중인 생성 run</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/review" className="block">
          <Card className="transition-colors hover:bg-muted/40">
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">{pendingCount}</div>
              <div className="text-sm text-muted-foreground">검토 대기 중인 콘텐츠</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
