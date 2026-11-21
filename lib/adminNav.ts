// 관리자 메뉴 구조와 현재 위치 판별. "server-only"가 없어서 클라이언트 컴포넌트(AdminNav)도 가져다 쓴다.
// 구조: 홈 / 소설 제작(작업 순서 1~4) / 언어 데이터. 한 소설이 거치는 순서대로 소설 제작 메뉴를 늘어놓는다.

export type NavBadgeKey = "stuck" | "editPending" | "autoHidden";

export type NavItem = {
  href: string;
  label: string;
  /** 소설 제작의 작업 순서(1~4). 언어 데이터에는 없다. */
  step?: number;
  badge?: NavBadgeKey;
  /** 이 메뉴 아래에서 활성으로 볼 다른 주소들(예: 게시본 표현 수정 화면). */
  alsoActive?: string[];
};

export type NavGroup = { label: string; hint: string; items: NavItem[] };

export const HOME_ITEM: NavItem = { href: "/admin", label: "홈" };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "소설 제작",
    hint: "작업 순서",
    items: [
      { href: "/admin/generation", label: "생성 현황", step: 1, badge: "stuck" },
      { href: "/admin/edit", label: "편집", step: 2, badge: "editPending" },
      { href: "/admin/review", label: "검토·게시", step: 3 },
      { href: "/admin/published", label: "게시본 관리", step: 4, alsoActive: ["/admin/edit/published"] },
    ],
  },
  {
    label: "언어 데이터",
    hint: "앱 데이터 운영",
    items: [
      { href: "/admin/quality", label: "단어 신고·품질", badge: "autoHidden" },
      { href: "/admin/word-cache", label: "단어 캐시" },
      { href: "/admin/expressions", label: "표현 풀" },
    ],
  },
];

/**
 * 현재 주소에 해당하는 메뉴의 href. 가장 길게 일치하는 메뉴를 고른다 —
 * "/admin/edit/published/…"는 "/admin/edit"(편집)이 아니라 더 길게 일치하는 게시본 관리다.
 * 홈("/admin")은 정확히 그 주소일 때만 활성이다(모든 주소가 /admin으로 시작하므로).
 */
export function activeNavHref(pathname: string): string | null {
  let best: { href: string; length: number } | null = null;
  for (const item of [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)]) {
    const prefixes = [item.href, ...(item.alsoActive ?? [])];
    for (const prefix of prefixes) {
      const matches =
        item.href === HOME_ITEM.href && prefix === item.href
          ? pathname === prefix
          : pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (matches && (!best || prefix.length > best.length)) best = { href: item.href, length: prefix.length };
    }
  }
  return best?.href ?? null;
}

// null = 조회 실패. 0건이거나 실패하면 배지를 달지 않는다.
export type NavCounts = { stuck: number | null; editPending: number | null; autoHidden: number | null };

export type NavBadge = { text: string; tone: "accent" | "warning" | "gray" };

export function navBadge(counts: NavCounts, key: NavBadgeKey | undefined): NavBadge | null {
  if (!key) return null;
  const count = counts[key];
  if (!count) return null;
  if (key === "editPending") return { text: String(count), tone: "accent" };
  if (key === "stuck") return { text: `막힘 ${count}`, tone: "warning" };
  return { text: String(count), tone: "gray" };
}
