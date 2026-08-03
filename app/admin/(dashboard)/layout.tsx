import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";

const NAV_ITEMS = [
  { href: "/admin", label: "홈" },
  { href: "/admin/generation", label: "생성 진행상황" },
  { href: "/admin/review", label: "검토/게시" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    const pathname = (await headers()).get("x-pathname") ?? "/admin";
    redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-border p-6">
        <span className="text-sm font-semibold tracking-tight">Word Bank Admin</span>
        <nav>
          <ul className="flex flex-col gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-2 font-medium text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
