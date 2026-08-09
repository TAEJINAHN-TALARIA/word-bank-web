import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";
import { getPublishedStory } from "@/lib/data/stories";
import { getStoryContent, type StoryChapterContent } from "@/lib/data/storyContent";

function buildTextFile(
  story: { title: string | null; lang: string },
  chapters: StoryChapterContent[],
): string {
  const lines = [`${story.title ?? "(제목 없음)"} (${story.lang})`, ""];
  for (const chapter of chapters) {
    lines.push(`${chapter.num}챕. ${chapter.title ?? "(제목 없음)"}`, "");
    for (const paragraph of chapter.paragraphs) {
      lines.push(paragraph, "");
    }
  }
  return lines.join("\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "관리자 로그인이 필요합니다" }, { status: 401 });
  }

  const { docId } = await params;

  try {
    const [story, chapters] = await Promise.all([
      getPublishedStory(docId),
      getStoryContent(docId),
    ]);

    if (!story || !chapters) {
      return NextResponse.json({ error: "콘텐츠를 찾을 수 없습니다" }, { status: 404 });
    }

    const text = buildTextFile(story, chapters);
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${docId}.txt"`,
      },
    });
  } catch (err) {
    console.error("[review-download]", err);
    return NextResponse.json({ error: "콘텐츠 조회 실패" }, { status: 500 });
  }
}
