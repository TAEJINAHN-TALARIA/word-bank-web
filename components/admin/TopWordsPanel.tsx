"use client";

import { useState, useTransition } from "react";
import type { LanguagePairVolume, TopWord } from "@/lib/data/wordCacheStats";
import { fetchTopWordsAction } from "@/lib/actions/wordCacheStatsActions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function pairKey(wordLanguage: string, meaningLanguage: string) {
  return `${wordLanguage}_${meaningLanguage}`;
}

export function TopWordsPanel({
  pairs,
  initialWords,
}: {
  pairs: LanguagePairVolume[];
  initialWords: TopWord[];
}) {
  const [selectedKey, setSelectedKey] = useState(
    pairs.length > 0 ? pairKey(pairs[0].wordLanguage, pairs[0].meaningLanguage) : "",
  );
  const [words, setWords] = useState(initialWords);
  const [isPending, startTransition] = useTransition();

  if (pairs.length === 0) {
    return <p className="text-sm text-muted-foreground">검색 데이터가 없습니다.</p>;
  }

  function handleChange(key: string) {
    setSelectedKey(key);
    const [wordLanguage, meaningLanguage] = key.split("_");
    startTransition(async () => {
      setWords(await fetchTopWordsAction(wordLanguage, meaningLanguage));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <select
        value={selectedKey}
        onChange={(e) => handleChange(e.target.value)}
        className="w-fit rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      >
        {pairs.map((p) => {
          const key = pairKey(p.wordLanguage, p.meaningLanguage);
          return (
            <option key={key} value={key}>
              {p.wordLanguage} → {p.meaningLanguage}
            </option>
          );
        })}
      </select>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>단어</TableHead>
            <TableHead className="text-right">hitCount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {words.map((w) => (
            <TableRow key={w.word}>
              <TableCell className="font-medium">{w.word}</TableCell>
              <TableCell className="text-right">{w.hitCount.toLocaleString("ko-KR")}</TableCell>
            </TableRow>
          ))}
          {words.length === 0 && !isPending && (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground">
                데이터가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
