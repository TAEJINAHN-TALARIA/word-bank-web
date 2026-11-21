import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublishedStory } from "@/lib/data/stories";
import { getStoryContent } from "@/lib/data/storyContent";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function StoryContentPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const [story, chapters] = await Promise.all([
    getPublishedStory(docId),
    getStoryContent(docId),
  ]);

  if (!story || !chapters) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{story.title ?? "(제목 없음)"}</h1>
          <p className="text-sm text-muted-foreground">
            {story.lang} · {story.level}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {story.lang === "ko" && (
            <Link
              href={`/admin/edit/published/${docId}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              표현 수정
            </Link>
          )}
          {story.sessionId && (
            <Link
              href={`/admin/generation/${story.sessionId}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              생성 상세
            </Link>
          )}
          <a
            href={`/admin/published/${docId}/download`}
            download
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            다운로드
          </a>
          <Link href="/admin/published" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            목록으로
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {chapters.map((chapter) => (
          <div key={chapter.num} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {chapter.num}챕. {chapter.title ?? "(제목 없음)"}
            </h2>
            <div className="flex flex-col gap-3 text-sm leading-relaxed">
              {chapter.paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>
        ))}
        {chapters.length === 0 && (
          <p className="text-sm text-muted-foreground">챕터 내용이 없습니다.</p>
        )}
      </div>
    </div>
  );
}
