export function groupBySession<T extends { sessionId?: string }>(
  items: T[],
  fallbackId: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const item of items) {
    const key = item.sessionId || fallbackId(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }

  return order.map((key) => ({ key, items: groups.get(key)! }));
}

export function getGroupLabel<
  T extends { target: string; lang: string; level: string; title: string | null },
>(group: T[]): { title: string; level: string; languageCount: number } {
  const master = group.find((item) => item.target === "master" || item.lang === "ko");
  const primary = master ?? group[0];
  return {
    title: primary.title ?? "(제목 없음)",
    level: primary.level,
    languageCount: group.length,
  };
}
