import type { ExpressionBatchJob } from "@/lib/data/expressions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<ExpressionBatchJob["status"], string> = {
  pending: "대기중",
  running: "진행중",
  succeeded: "완료",
  failed: "실패",
};

const STATUS_VARIANT: Record<ExpressionBatchJob["status"], "secondary" | "warning" | "success" | "destructive"> = {
  pending: "secondary",
  running: "warning",
  succeeded: "success",
  failed: "destructive",
};

export function ExpressionBatchJobsTable({ jobs }: { jobs: ExpressionBatchJob[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>상태</TableHead>
          <TableHead>언어</TableHead>
          <TableHead>개수</TableHead>
          <TableHead>요청</TableHead>
          <TableHead>생성 시각</TableHead>
          <TableHead>완료 시각</TableHead>
          <TableHead>비고</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
            </TableCell>
            <TableCell>{job.language}</TableCell>
            <TableCell>{job.count}개</TableCell>
            <TableCell>{job.requestedBy === "auto" ? "자동" : "수동"}</TableCell>
            <TableCell className="text-muted-foreground">{new Date(job.createdAt).toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-muted-foreground">
              {job.completedAt ? new Date(job.completedAt).toLocaleString("ko-KR") : "-"}
            </TableCell>
            <TableCell className="max-w-xs truncate text-destructive">{job.error ?? "-"}</TableCell>
          </TableRow>
        ))}
        {jobs.length === 0 && <EmptyTableRow colSpan={7} message="생성 작업 이력이 없습니다." />}
      </TableBody>
    </Table>
  );
}
