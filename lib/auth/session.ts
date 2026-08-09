import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";
const SESSION_CACHE_TTL_MS = 60_000;
const SESSION_CACHE_PRUNE_THRESHOLD = 50;

type CachedSession = { uid: string; expiresAt: number };

const sessionCache = new Map<string, CachedSession>();

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [cookieValue, entry] of sessionCache) {
    if (entry.expiresAt <= now) sessionCache.delete(cookieValue);
  }
}

export async function getAdminSession(): Promise<{ uid: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  const cached = sessionCache.get(sessionCookie);
  if (cached && cached.expiresAt > Date.now()) {
    return { uid: cached.uid };
  }

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (decoded.admin !== true) {
      sessionCache.delete(sessionCookie);
      return null;
    }

    if (sessionCache.size > SESSION_CACHE_PRUNE_THRESHOLD) pruneExpiredSessions();
    sessionCache.set(sessionCookie, {
      uid: decoded.uid,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });
    return { uid: decoded.uid };
  } catch {
    sessionCache.delete(sessionCookie);
    return null;
  }
}
