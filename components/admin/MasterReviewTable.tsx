import Link from "next/link";
import type { MasterReviewSummary } from "@/lib/data/masterReviews";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyTableRow } from "@/components/admin/EmptyTableRow";
import { cn } from "@/lib/utils";

const TOTAL_CHAPTERS = 10;

// 편집 대기 세션 목록. 게시된 소설의 수정은 "게시본 관리"에서 한다.
export function MasterReviewTable({ items }: { items: MasterReviewSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>제목</TableHead>
          <TableHead>레벨</TableHead>
          <TableHead>실행</TableHead>
          <TableHead>확인</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.sessionId}>
            <TableCell className="whitespace-normal font-medium">{item.title ?? "(제목 없음)"}</TableCell>
            <TableCell>{item.level}</TableCell>
            <TableCell>{item.executionPath === "onDemand" ? "온디맨드" : "월간 배치"}</TableCell>
            <TableCell>
              {item.confirmedCount}/{TOTAL_CHAPTERS}
            </TableCell>
            <TableCell>
              {item.gateNote ? <Badge variant="warning">게이트 실패로 복귀</Badge> : <Badge>편집 대기</Badge>}
            </TableCell>
            <TableCell className="text-right">
              <Link href={`/admin/edit/${item.sessionId}`} className={cn(buttonVariants({ size: "sm" }))}>
                편집하기
              </Link>
            </TableCell>
          </TableRow>
        ))}
        {items.length === 0 && <EmptyTableRow colSpan={6} message="편집을 기다리는 소설이 없습니다." />}
      </TableBody>
    </Table>
  );
}
