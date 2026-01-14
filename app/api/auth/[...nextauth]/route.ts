import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username;
        const password = credentials?.password;

        if (
          username &&
          password &&
          username === process.env.APP_USERNAME &&
          password === process.env.APP_PASSWORD
        ) {
          return { id: "single-user", name: "Owner", email: "owner@local" };
        }

        return null;
      },
    }),
  ],
});

export { handler as GET, handler as POST };
