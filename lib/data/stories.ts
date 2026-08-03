import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type PublishedStory = {
  id: string;
  lang: string;
  level: string;
  title: string | null;
  chapterCount: number;
  sessionId: string;
  target: string;
};

export async function listPublishedStories(): Promise<PublishedStory[]> {
  const db = getAdminFirestore();
  const snapshot = await db.collection("stories").orderBy("createdAt", "desc").limit(100).get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      lang: data.lang,
      level: data.level,
      title: data.title ?? null,
      chapterCount: data.chapterCount,
      sessionId: data.sessionId,
      target: data.target,
    };
  });
}
