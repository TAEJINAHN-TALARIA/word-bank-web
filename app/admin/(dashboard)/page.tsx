import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";
import { getAdminNavCounts, getHomeStageCounts } from "@/lib/data/adminCounts";
import { sessionStage } from "@/lib/sessionStage";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { cn } from "@/lib/utils";

const RECENT_SESSION_COUNT = 5;

// 조회에 실패한 숫자는 0이 아니라 "—"로 보여준다(실패와 "0건"은 다르다).
const fmt = (n: number | null) => (n === null ? "—" : String(n));

export default async function AdminHomePage() {
  // 각 조회는 서로 독립이다 — 하나가 실패해도 그 숫자만 빠지고 홈은 그대로 열린다.
  const [sessionsPage, pending, nav, stages] = await Promise.all([
    listPipelineSessions().catch(() => null),
    fetchPendingReviews().catch(() => null),
    getAdminNavCounts(),
    getHomeStageCounts(),
  ]);
  const pendingCount = pending === null ? null : pending.length;
  const recent = sessionsPage?.sessions.slice(0, RECENT_SESSION_COUNT) ?? [];

  const todos = [
    {
      href: "/admin/edit",
      count: nav.editPending,
      label: "편집 대기",
      hint: "마스터를 읽고 승인해야 번역이 시작돼요",
      cta: "편집하러 가기",
      tone: nav.editPending ? "primary" : "plain",
    },
    {
      href: "/admin/review",
      count: pendingCount,
      label: "게시 대기",
      hint: "품질 게이트를 통과한 번역본, 게시 전 확인",
      cta: "검토하러 가기",
      tone: "plain",
    },
    {
      href: "/admin/generation",
      count: nav.stuck,
      label: "막힌 세션",
      hint: "재시도 한도를 넘어 멈췄어요",
      cta: "사유 보기",
      tone: nav.stuck ? "warning" : "plain",
    },
    {
      href: "/admin/quality",
      count: nav.autoHidden,
      label: "자동 숨김 단어",
      hint: "오신고인지 확인하고 복구해요",
      cta: "확인하러 가기",
      tone: "plain",
    },
  ] as const;

  const flow = [
    { count: stages.inProgress, label: "진행 중", where: "① 생성 현황 · 자동", human: false },
    { count: nav.editPending, label: "편집 대기", where: "② 편집 · 사람 차례", human: true },
    { count: pendingCount, label: "게시 대기", where: "③ 검토·게시 · 사람 차례", human: true },
    { count: stages.published, label: "게시됨", where: "④ 게시본 관리", human: false },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">오늘 할 일</h1>
        <p className="text-sm text-muted-foreground">지금 사람이 움직여야 하는 것만 모았어요. 카드를 누르면 해당 단계로 가요.</p>
      </div>

      <section aria-label="할 일" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {todos.map((todo) => (
          <Link
            key={todo.label}
            href={todo.href}
            className={cn(
              "flex flex-col gap-1.5 rounded-2xl border p-4 transition-opacity hover:opacity-90",
              todo.tone === "primary" && "border-primary bg-primary text-primary-foreground",
              todo.tone === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
              todo.tone === "plain" && "border-border bg-card",
            )}
          >
            <span className="text-4xl leading-none font-semibold tabular-nums">{fmt(todo.count)}</span>
            <span className="text-[15px] font-semibold">{todo.label}</span>
            <span className={cn("text-sm leading-snug", todo.tone === "plain" ? "text-muted-foreground" : "opacity-85")}>{todo.hint}</span>
            <span className={cn("mt-1.5 text-sm font-semibold", todo.tone === "plain" && "text-primary")}>{todo.cta} →</span>
          </Link>
        ))}
      </section>

      <section aria-labelledby="flow" className="flex flex-col gap-3">
        <h2 id="flow" className="text-base font-semibold">
          소설 제작 흐름 <span className="text-sm font-normal text-muted-foreground">· 지금 몇 건이 어느 단계에 있는지</span>
        </h2>
        <ol className="flex flex-wrap items-stretch gap-2">
          {flow.map((step, i) => (
            <li key={step.label} className="flex flex-1 basis-36 items-center gap-2">
              <div
                className={cn(
                  "flex flex-1 flex-col gap-0.5 rounded-xl px-3.5 py-3",
                  step.human && step.count ? "border-2 border-primary bg-primary/5" : "border border-border",
                )}
              >
                <span className={cn("text-2xl font-semibold tabular-nums", step.human && step.count ? "text-primary" : "")}>{fmt(step.count)}</span>
                <span className="text-sm font-semibold">{step.label}</span>
                <span className="text-xs text-muted-foreground">{step.where}</span>
              </div>
              {i < flow.length - 1 && (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">파란 테두리는 사람이 움직여야 하는 단계예요. 게시 대기는 소설이 아니라 언어별 번역본 단위로 세요.</p>
      </section>

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="recent" className="text-base font-semibold">
            최근 세션 <span className="text-sm font-normal text-muted-foreground">· 한 소설을 단계 사이에서 따라가요</span>
          </h2>
          <Link href="/admin/generation" className="text-sm text-muted-foreground underline underline-offset-4">
            전체 보기
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>소재</TableHead>
              <TableHead>레벨</TableHead>
              <TableHead>지금 단계</TableHead>
              <TableHead className="text-right">다음 할 일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((session) => {
              const stage = sessionStage(session.status, session.id);
              return (
                <TableRow key={session.id}>
                  <TableCell className="whitespace-normal font-medium">
                    <Link href={`/admin/generation/${session.id}`} className="underline-offset-4 hover:underline">
                      {session.combo.mainPremise || session.id}
                    </Link>
                  </TableCell>
                  <TableCell>{session.targetLevel}</TableCell>
                  <TableCell>
                    <Badge variant={stage.variant}>{stage.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {stage.next ? (
                      <Link href={stage.next.href} className={cn(buttonVariants({ size: "sm", variant: stage.variant === "default" ? "default" : "outline" }))}>
                        {stage.next.label}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">{session.status === "in_progress" ? "자동 진행 중" : "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {recent.length === 0 && (
              <EmptyTableRow colSpan={4} message={sessionsPage === null ? "세션을 불러오지 못했습니다." : "생성 세션이 없습니다."} />
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
