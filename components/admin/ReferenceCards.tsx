import { averageSentenceLength, type CharacterInfo, type LevelGuidance } from "@/lib/masterReview";

// 쓸 때 참고할 정보 — 문장 길이, 서술 문체, 인물 말투. 문장 길이는 맞추라는 게 아니라 읽는 호흡을 보는 참고용이다.
export function ReferenceCards({
  text,
  level,
  levelGuidance,
  characters,
  narrativeStyle,
}: {
  text: string;
  level: string;
  levelGuidance: LevelGuidance | null;
  characters: CharacterInfo[];
  narrativeStyle: string | null;
}) {
  const avg = averageSentenceLength(text);
  const target = levelGuidance?.sentenceLen ?? null;
  const ok = target === null || avg <= target * 1.2;
  const barWidth = target ? Math.min(100, Math.round((avg / (target * 2)) * 100)) : 0;
  const voices = characters.filter((c) => c.speechStyle);

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="문장 길이" className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-sm font-semibold">문장 길이 ({level})</h3>
        <p className="text-sm leading-snug">
          평균 <strong>{avg}{levelGuidance?.unit ?? "자"}</strong>
          {target !== null && (
            <>
              {" "}· 목표 약 {target}
              {levelGuidance?.unit ?? "자"}{" "}
              <span className={ok ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                · {avg === 0 ? "글을 쓰면 표시돼요" : ok ? "목표 범위예요" : "목표보다 길어요"}
              </span>
            </>
          )}
        </p>
        {target !== null && (
          <div aria-hidden className="relative h-2.5 rounded-full bg-muted">
            <div className={`absolute top-0 left-0 h-2.5 rounded-full ${ok ? "bg-emerald-600" : "bg-amber-600"}`} style={{ width: `${barWidth}%` }} />
            <div className="absolute -top-0.5 left-1/2 h-3.5 w-0.5 bg-foreground" />
          </div>
        )}
        <p className="text-xs leading-snug text-muted-foreground">
          검은 선이 목표 길이예요. 길이를 맞추라는 게 아니라 읽는 호흡을 보는 참고용입니다.
        </p>
      </section>

      {(narrativeStyle || voices.length > 0) && (
        <section aria-label="인물과 문체" className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3">
          <h3 className="text-sm font-semibold">인물·문체</h3>
          {narrativeStyle && (
            <p className="text-sm leading-relaxed">
              <strong>서술</strong> · {narrativeStyle}
            </p>
          )}
          {voices.map((c) => (
            <p key={c.name} className="text-sm leading-relaxed">
              <strong>{c.name}</strong> · {c.speechStyle}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
