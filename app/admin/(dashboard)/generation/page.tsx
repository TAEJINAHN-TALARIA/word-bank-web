import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { GenerationSessionsTable } from "@/components/admin/GenerationSessionsTable";

export default async function GenerationPage() {
  const { sessions, nextCursor } = await listPipelineSessions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">생성 현황</h1>
        <p className="text-sm text-muted-foreground">최근 파이프라인 세션이에요. 사람이 움직여야 하는 세션은 오른쪽에서 바로 이어서 처리해요.</p>
      </div>
      <GenerationSessionsTable initialSessions={sessions} initialCursor={nextCursor} />
    </div>
  );
}
