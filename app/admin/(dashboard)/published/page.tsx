import Link from "next/link";
import { listPublishedStories } from "@/lib/data/stories";
import { PublishedStoriesTable } from "@/components/admin/PublishedStoriesTable";

export default async function PublishedPage() {
  const page = await listPublishedStories();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">게시본 관리</h1>
        <p className="text-sm text-muted-foreground">
          앱에 게시된 소설이에요. 한국어 게시본은 표현을 수정하고, 필요하면 게시를 철회하거나 내려받아요. 새로 게시하려면{" "}
          <Link href="/admin/review" className="underline underline-offset-4">
            검토·게시
          </Link>
          로 가세요.
        </p>
      </div>
      <PublishedStoriesTable initialStories={page.stories} initialCursor={page.nextCursor} />
    </div>
  );
}
