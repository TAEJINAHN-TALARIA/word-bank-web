import type { LanguagePairVolume } from "@/lib/data/wordCacheStats";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function WordCacheVolumeTable({ volumes }: { volumes: LanguagePairVolume[] }) {
  if (volumes.length === 0) {
    return <p className="text-sm text-muted-foreground">검색 데이터가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>언어쌍</TableHead>
          <TableHead className="text-right">검색량 (hitCount 합계)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {volumes.map((v) => (
          <TableRow key={`${v.wordLanguage}_${v.meaningLanguage}`}>
            <TableCell className="font-medium">{v.wordLanguage} → {v.meaningLanguage}</TableCell>
            <TableCell className="text-right">{v.hitCount.toLocaleString("ko-KR")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
