import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";
import { listPublishedStories } from "@/lib/data/stories";
import { ReviewTabs } from "@/components/admin/ReviewTabs";

export default async function ReviewPage() {
  const [pending, published] = await Promise.all([
    fetchPendingReviews(),
    listPublishedStories(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">소설 검토 / 게시 관리</h1>
      <ReviewTabs pending={pending} published={published} />
    </div>
  );
}
