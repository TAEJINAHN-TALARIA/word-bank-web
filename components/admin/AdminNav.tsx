"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HOME_ITEM, NAV_GROUPS, activeNavHref, navBadge, type NavCounts, type NavItem } from "@/lib/adminNav";
import { cn } from "@/lib/utils";

const BADGE_TONE = {
  accent: "bg-primary text-primary-foreground",
  warning: "bg-amber-500/15 text-amber-800",
  gray: "bg-muted text-foreground/80",
} as const;

function NavLink({
  item,
  active,
  counts,
  tall,
}: {
  item: NavItem;
  active: boolean;
  counts: NavCounts;
  tall: boolean;
}) {
  const badge = navBadge(counts, item.badge);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors",
        tall ? "min-h-12 text-[15px]" : "min-h-10",
        active ? "border-border bg-background font-semibold" : "border-transparent text-foreground/80 hover:bg-muted",
      )}
    >
      {item.step !== undefined && (
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-border text-xs font-bold text-foreground/80">
          {item.step}
        </span>
      )}
      <span className="flex-1">{item.label}</span>
      {badge && (
        <span className={cn("rounded-full px-2 py-px text-xs font-bold", BADGE_TONE[badge.tone])}>{badge.text}</span>
      )}
    </Link>
  );
}

function NavList({ counts, active, tall }: { counts: NavCounts; active: string | null; tall: boolean }) {
  return (
    <nav aria-label="관리자 메뉴" className="flex flex-col gap-5">
      <NavLink item={HOME_ITEM} active={active === HOME_ITEM.href} counts={counts} tall={tall} />
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
            {group.label} <span className="font-normal">· {group.hint}</span>
          </p>
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} active={active === item.href} counts={counts} tall={tall} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * 관리자 메뉴 틀. 넓은 화면(lg 이상)은 왼쪽 사이드바, 좁은 화면은 상단 바 + 메뉴 서랍.
 * 서랍은 "열린 때의 주소"를 기억해 두고 주소가 바뀌면(메뉴를 눌러 이동하면) 저절로 닫힌다.
 */
export function AdminNav({ counts, signOut }: { counts: NavCounts; signOut: ReactNode }) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const closeButton = useRef<HTMLButtonElement>(null);

  const activeItem = [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)].find((i) => i.href === active);
  const pageTitle = activeItem?.label ?? "관리자";
  const editBadge = navBadge(counts, "editPending");

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 서랍 뒤 화면이 같이 스크롤되지 않게
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background px-2 lg:hidden">
        <button
          type="button"
          aria-label="메뉴 열기"
          aria-expanded={open}
          onClick={() => setOpenPath(pathname)}
          className="flex size-12 items-center justify-center rounded-lg hover:bg-muted"
        >
          <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h16M3 11h16M3 16h16" />
          </svg>
        </button>
        <h1 className="flex-1 truncate text-[17px] font-semibold">{pageTitle}</h1>
        {editBadge && active !== "/admin/edit" && (
          <Link href="/admin/edit" className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", BADGE_TONE.accent)}>
            편집 {editBadge.text}
          </Link>
        )}
      </header>

      <aside className="hidden shrink-0 flex-col gap-6 border-r border-border bg-muted/40 p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:overflow-y-auto">
        <span className="px-2.5 text-sm font-semibold tracking-tight">Word Bank Admin</span>
        <NavList counts={counts} active={active} tall={false} />
        <div className="mt-auto px-2.5">{signOut}</div>
      </aside>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="관리자 메뉴"
          className="fixed inset-0 z-40 flex lg:hidden"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpenPath(null);
          }}
        >
          <div className="flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-muted p-3 shadow-xl">
            <div className="flex h-12 items-center">
              <span className="flex-1 px-2.5 text-sm font-semibold">Word Bank Admin</span>
              <button
                ref={closeButton}
                type="button"
                aria-label="메뉴 닫기"
                onClick={() => setOpenPath(null)}
                className="flex size-12 items-center justify-center rounded-lg hover:bg-background"
              >
                <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l12 12M16 4L4 16" />
                </svg>
              </button>
            </div>
            <NavList counts={counts} active={active} tall />
            {/* 로그아웃 버튼도 터치하기 쉬운 높이(44px 이상)로 */}
            <div className="mt-auto px-2.5 [&_button]:h-11 [&_button]:px-4 [&_button]:text-sm">{signOut}</div>
          </div>
          <button type="button" aria-label="메뉴 닫기" className="flex-1 bg-foreground/45" onClick={() => setOpenPath(null)} />
        </div>
      )}
    </>
  );
}
