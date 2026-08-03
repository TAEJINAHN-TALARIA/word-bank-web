import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    const response = NextResponse.next();
    response.headers.set("x-pathname", pathname);
    return response;
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
