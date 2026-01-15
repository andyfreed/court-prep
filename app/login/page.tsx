import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import LoginForm from "./LoginForm";
import { authOptions } from "@/lib/auth";

type LoginPageProps = {
  searchParams?: { callbackUrl?: string };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getServerSession(authOptions);
  const callbackUrl = searchParams?.callbackUrl ?? "/chat";

  if (session) {
    redirect(callbackUrl);
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use your app credentials to access Court Prep.
        </p>
      </div>
      <LoginForm />
    </section>
  );
}
