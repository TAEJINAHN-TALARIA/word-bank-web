"use server";

import { getAdminSession } from "@/lib/auth/session";
import { listUserFeedback } from "@/lib/data/wordFixReports";
import type { WordFixFeedbackPage } from "@/lib/data/wordFixReports";

export async function fetchNextFeedbackPageAction(cursor: string): Promise<WordFixFeedbackPage> {
  const session = await getAdminSession();
  if (!session) return { items: [], nextCursor: null };

  return listUserFeedback(cursor);
}
