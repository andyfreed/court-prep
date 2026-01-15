import { withAuth } from "next-auth/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const authMiddleware = withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ token }) => Boolean(token),
  },
});

export default function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }
  return authMiddleware(req);
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
