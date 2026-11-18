import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublishedStoryForEdit } from "@/lib/data/masterReviews";
import { MasterEditor } from "@/components/admin/MasterEditor";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const maxDuration = 300;

export default async function PublishedEditPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const story = await getPublishedStoryForEdit(docId);
  if (!story) notFound();

  if (story.lang !== "ko") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{story.detail.title ?? "(제목 없음)"}</h1>
        <p className="text-sm text-muted-foreground">
          한국어 게시본만 편집할 수 있어요. 번역본({story.lang})을 직접 고치면 한국어 원문과 어긋납니다.
        </p>
        <Link href="/admin/edit" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
          목록으로
        </Link>
      </div>
    );
  }

  return <MasterEditor detail={story.detail} />;
}
