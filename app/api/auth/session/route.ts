import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";
const SESSION_EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export async function POST(request: NextRequest) {
  const { idToken } = await request.json();
  if (!idToken) {
    return NextResponse.json({ error: "idToken이 필요합니다" }, { status: 400 });
  }

  const adminAuth = getAdminAuth();
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "유효하지 않은 토큰입니다" }, { status: 401 });
  }

  if (decoded.admin !== true) {
    return NextResponse.json({ error: "관리자 권한이 없습니다" }, { status: 401 });
  }

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_EXPIRES_IN_MS,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/admin",
    maxAge: SESSION_EXPIRES_IN_MS / 1000,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete({ name: SESSION_COOKIE_NAME, path: "/admin" });
  return response;
}
