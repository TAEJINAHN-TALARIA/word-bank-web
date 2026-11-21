import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAdminSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { AdminNav } from "@/components/admin/AdminNav";
import { getAdminNavCounts } from "@/lib/data/adminCounts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    const pathname = (await headers()).get("x-pathname") ?? "/admin";
    redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
  }

  // 메뉴 옆 숫자는 집계 쿼리라 가볍고, 항목별로 실패를 격리해서 메뉴 렌더링을 막지 않는다.
  const counts = await getAdminNavCounts();

  return (
    <div className="min-h-screen bg-background lg:flex">
      <AdminNav counts={counts} signOut={<SignOutButton />} />
      <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
