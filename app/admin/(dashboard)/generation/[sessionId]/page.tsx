import { notFound } from "next/navigation";
import { getPipelineSessionDetail } from "@/lib/data/pipelineSessions";

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getPipelineSessionDetail(sessionId);
  if (!session) notFound();

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">{session.id}</h1>
      <dl className="mb-6 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-neutral-500">상태</dt>
        <dd>{session.status}</dd>
        <dt className="text-neutral-500">레벨</dt>
        <dd>{session.targetLevel}</dd>
        <dt className="text-neutral-500">Combo</dt>
        <dd>{session.combo}</dd>
        <dt className="text-neutral-500">대상 언어</dt>
        <dd>{session.targetLanguages.join(", ")}</dd>
      </dl>
      <h2 className="mb-2 font-medium">Layer 6 게이트 결과</h2>
      <ul className="space-y-3">
        {session.layer6Gates.map((gate) => (
          <li key={gate.target} className="rounded border border-neutral-200 p-3 text-sm">
            <div className="font-medium">
              {gate.target} — {gate.latestStatus} (재시도 {gate.retryCount}회)
            </div>
            {gate.ruleBaseWarnings.length > 0 && (
              <p className="mt-1 text-amber-700">경고: {gate.ruleBaseWarnings.join(", ")}</p>
            )}
            {gate.llmEvalReasons.length > 0 && (
              <p className="mt-1 text-neutral-600">
                판정 사유: {gate.llmEvalReasons.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
