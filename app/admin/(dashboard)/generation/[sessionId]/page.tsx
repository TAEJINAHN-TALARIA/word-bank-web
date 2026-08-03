import { notFound } from "next/navigation";
import { getPipelineSessionDetail } from "@/lib/data/pipelineSessions";
import { Badge } from "@/components/ui/badge";

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) return "destructive";
  if (normalized.includes("progress") || normalized.includes("pending")) return "secondary";
  if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("success")) {
    return "default";
  }
  return "outline";
}

function gateBorderClass(variant: ReturnType<typeof statusBadgeVariant>): string {
  if (variant === "destructive") return "border-l-destructive";
  if (variant === "secondary") return "border-l-amber-500";
  return "border-l-border";
}

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getPipelineSessionDetail(sessionId);
  if (!session) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-mono text-xl font-semibold tracking-tight">{session.id}</h1>
        <div className="mt-2">
          <Badge variant={statusBadgeVariant(session.status)}>{session.status}</Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:max-w-md">
        <dt className="text-muted-foreground">레벨</dt>
        <dd>{session.targetLevel}</dd>
        <dt className="text-muted-foreground">Combo</dt>
        <dd>{session.combo}</dd>
        <dt className="text-muted-foreground">대상 언어</dt>
        <dd>{session.targetLanguages.join(", ")}</dd>
        <dt className="text-muted-foreground">생성일</dt>
        <dd>{session.createdAt}</dd>
      </dl>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Layer 6 게이트 결과</h2>
        <ul className="flex flex-col gap-3">
          {session.layer6Gates.map((gate) => {
            const variant = statusBadgeVariant(gate.latestStatus);
            return (
              <li
                key={gate.target}
                className={`rounded-lg border-l-4 bg-card p-4 text-sm ring-1 ring-foreground/10 ${gateBorderClass(variant)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono font-medium">{gate.target}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={variant}>{gate.latestStatus}</Badge>
                    <span className="text-xs text-muted-foreground">재시도 {gate.retryCount}회</span>
                  </div>
                </div>
                {gate.ruleBaseWarnings.length > 0 && (
                  <p className="mt-2 text-amber-700 dark:text-amber-500">
                    경고: {gate.ruleBaseWarnings.join(", ")}
                  </p>
                )}
                {gate.llmEvalReasons.length > 0 && (
                  <p className="mt-1 text-muted-foreground">
                    판정 사유: {gate.llmEvalReasons.join(", ")}
                  </p>
                )}
              </li>
            );
          })}
          {session.layer6Gates.length === 0 && (
            <p className="text-sm text-muted-foreground">게이트 결과가 없습니다.</p>
          )}
        </ul>
      </div>
    </div>
  );
}
