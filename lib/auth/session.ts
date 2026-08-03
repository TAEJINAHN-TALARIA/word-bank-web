import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";

export async function getAdminSession(): Promise<{ uid: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (decoded.admin !== true) return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}
