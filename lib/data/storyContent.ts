import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type StoryChapterContent = {
  num: number;
  title: string | null;
  paragraphs: string[];
};

export async function getStoryContent(docId: string): Promise<StoryChapterContent[] | null> {
  const doc = await getAdminFirestore().collection("storyContent").doc(docId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  const chapters = (data.chapters ?? []) as StoryChapterContent[];
  return chapters.map((chapter) => ({
    num: chapter.num,
    title: chapter.title ?? null,
    paragraphs: chapter.paragraphs ?? [],
  }));
}
