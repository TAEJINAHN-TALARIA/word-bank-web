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

const PUBLISHED_STORIES_PAGE_SIZE = 100;

export type PublishedStoriesPage = {
  stories: PublishedStory[];
  nextCursor: string | null;
};

export async function listPublishedStories(cursorId?: string): Promise<PublishedStoriesPage> {
  const db = getAdminFirestore();
  let query = db
    .collection("stories")
    .orderBy("createdAt", "desc")
    .limit(PUBLISHED_STORIES_PAGE_SIZE);

  if (cursorId) {
    const cursorDoc = await db.collection("stories").doc(cursorId).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const stories = snapshot.docs.map((doc) => {
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

  return {
    stories,
    nextCursor:
      snapshot.docs.length === PUBLISHED_STORIES_PAGE_SIZE
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null,
  };
}
