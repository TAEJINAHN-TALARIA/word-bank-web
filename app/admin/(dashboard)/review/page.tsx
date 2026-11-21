import Link from "next/link";
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";
import { PendingReviewsTable } from "@/components/admin/PendingReviewsTable";

export default async function ReviewPage() {
  const pending = await fetchPendingReviews();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">검토·게시</h1>
        <p className="text-sm text-muted-foreground">
          품질 게이트를 통과한 번역본 {pending.length}건을 확인하고 게시해요. 이미 게시한 소설은{" "}
          <Link href="/admin/published" className="underline underline-offset-4">
            게시본 관리
          </Link>
          에서 수정·철회해요.
        </p>
      </div>
      <PendingReviewsTable initialItems={pending} />
    </div>
  );
}
