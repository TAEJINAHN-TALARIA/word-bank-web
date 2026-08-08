import type { LanguageCacheLoad } from "@/lib/data/wordCacheStats";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function CacheLoadByLanguageTable({ loads }: { loads: LanguageCacheLoad[] }) {
  if (loads.length === 0) {
    return <p className="text-sm text-muted-foreground">캐시된 단어가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>언어</TableHead>
          <TableHead className="text-right">캐시 문서 수</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loads.map((l) => (
          <TableRow key={l.wordLanguage}>
            <TableCell className="font-medium">{l.wordLanguage}</TableCell>
            <TableCell className="text-right">{l.count.toLocaleString("ko-KR")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
