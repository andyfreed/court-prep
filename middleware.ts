import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ token }) => Boolean(token),
  },
});

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
