import { listMasterReviews } from "@/lib/data/masterReviews";
import { listPublishedStories } from "@/lib/data/stories";
import { EditTabs } from "@/components/admin/EditTabs";

export default async function EditPage() {
  const [pending, publishedPage] = await Promise.all([listMasterReviews(), listPublishedStories()]);
  const koreanStories = publishedPage.stories.filter((story) => story.lang === "ko");

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">소설 편집</h1>
      <EditTabs pending={pending} published={koreanStories} />
    </div>
  );
}
