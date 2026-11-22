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
      {/* lg에서는 가로 스크롤을 풀어야 안쪽의 lg:sticky 패널(마스터 편집 화면)이 창 스크롤을 따라 고정된다. 표는 자체 가로 스크롤 래퍼가 있다 */}
      <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:overflow-x-visible lg:p-8">{children}</main>
    </div>
  );
}
