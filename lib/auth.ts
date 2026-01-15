import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const appUsername = process.env.APP_USERNAME ?? "";
const appPassword = process.env.APP_PASSWORD ?? "";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const username = credentials?.username ?? "";
        const password = credentials?.password ?? "";

        if (!appUsername || !appPassword) return null;
        if (username !== appUsername || password !== appPassword) return null;

        return { id: "single-user", name: appUsername };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
};
