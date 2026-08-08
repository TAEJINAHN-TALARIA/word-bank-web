"use server";

import { listUserFeedback } from "@/lib/data/wordFixReports";
import type { WordFixFeedbackPage } from "@/lib/data/wordFixReports";

export async function fetchNextFeedbackPageAction(cursor: string): Promise<WordFixFeedbackPage> {
  return listUserFeedback(cursor);
}
