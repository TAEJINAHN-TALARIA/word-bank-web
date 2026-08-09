import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { GenerationSessionsTable } from "@/components/admin/GenerationSessionsTable";

export default async function GenerationPage() {
  const { sessions, nextCursor } = await listPipelineSessions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">소설 생성 진행상황</h1>
        <p className="text-sm text-muted-foreground">최근 파이프라인 세션</p>
      </div>
      <GenerationSessionsTable initialSessions={sessions} initialCursor={nextCursor} />
    </div>
  );
}
