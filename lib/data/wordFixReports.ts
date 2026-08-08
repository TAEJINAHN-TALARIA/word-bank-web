import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export interface WordFixFeedbackItem {
  id: string;
  word: string;
  wordLanguage: string;
  meaningLanguage: string;
  userFeedback: string;
  createdAt: string;
}

export interface WordFixFeedbackPage {
  items: WordFixFeedbackItem[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;

export async function listUserFeedback(
  cursor?: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<WordFixFeedbackPage> {
  const db = getAdminFirestore();
  let query = db
    .collection("word_fix_reports")
    .where("userFeedback", "!=", null)
    .orderBy("createdAt", "desc");

  if (cursor) {
    const cursorDoc = await db.collection("word_fix_reports").doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.limit(pageSize + 1).get();
  const hasMore = snapshot.docs.length > pageSize;
  const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

  const items = pageDocs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      word: data.word,
      wordLanguage: data.wordLanguage,
      meaningLanguage: data.meaningLanguage,
      userFeedback: data.userFeedback,
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });

  return {
    items,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : null,
  };
}
