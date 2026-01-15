import { withAuth } from "next-auth/middleware";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const authMiddleware = withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ token }) => Boolean(token),
  },
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }
  return authMiddleware(req, event);
}

export const config = {
  matcher: [
    "/chat/:path*",
    "/documents/:path*",
    "/timeline/:path*",
    "/insights/:path*",
    "/lawyer-notes/:path*",
    "/settings/:path*",
    "/transcripts/:path*",
    "/api/chat",
    "/api/documents/:path*",
    "/api/jobs/:path*",
  ],
};
