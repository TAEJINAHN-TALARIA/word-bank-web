import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export default async function GenerationPage() {
  const sessions = await listPipelineSessions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">소설 생성 진행상황</h1>
        <p className="text-sm text-muted-foreground">최근 파이프라인 세션 {sessions.length}건</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>세션 ID</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>레벨</TableHead>
            <TableHead>Combo</TableHead>
            <TableHead>대상 언어</TableHead>
            <TableHead>생성일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell className="font-mono text-xs">
                <Link
                  href={`/admin/generation/${session.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {session.id}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(session.status)}>{session.status}</Badge>
              </TableCell>
              <TableCell>{session.targetLevel}</TableCell>
              <TableCell>{session.combo}</TableCell>
              <TableCell className="whitespace-normal">
                {session.targetLanguages.join(", ")}
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {session.createdAt}
              </TableCell>
            </TableRow>
          ))}
          {sessions.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                생성 세션이 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
