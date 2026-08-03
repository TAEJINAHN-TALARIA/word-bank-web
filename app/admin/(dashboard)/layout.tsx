import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    const pathname = (await headers()).get("x-pathname") ?? "/admin";
    redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 shrink-0 border-r border-neutral-200 p-4">
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/admin">홈</Link>
          </li>
          <li>
            <Link href="/admin/generation">생성 진행상황</Link>
          </li>
          <li>
            <Link href="/admin/review">검토/게시</Link>
          </li>
        </ul>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
