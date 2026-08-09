import type { SearchFailureRate } from "@/lib/data/wordCacheStats";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function SearchFailureRateTable({
  rates,
  volumesAvailable,
}: {
  rates: SearchFailureRate[];
  volumesAvailable: boolean;
}) {
  if (!volumesAvailable) {
    return (
      <p className="text-sm text-muted-foreground">
        검색량 데이터를 불러오지 못해 무의미 검색 비율을 계산할 수 없습니다.
      </p>
    );
  }

  if (rates.length === 0) {
    return <p className="text-sm text-muted-foreground">무의미 검색 데이터가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>언어쌍</TableHead>
          <TableHead className="text-right">무의미 검색</TableHead>
          <TableHead className="text-right">성공 검색</TableHead>
          <TableHead className="text-right">무의미 비율</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rates.map((r) => (
          <TableRow key={`${r.wordLanguage}_${r.meaningLanguage}`}>
            <TableCell className="font-medium">{r.wordLanguage} → {r.meaningLanguage}</TableCell>
            <TableCell className="text-right">{r.failCount.toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-right">{r.hitCount.toLocaleString("ko-KR")}</TableCell>
            <TableCell className="text-right">{(r.failureRatio * 100).toFixed(1)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
