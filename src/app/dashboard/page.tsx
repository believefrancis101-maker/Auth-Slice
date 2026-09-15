import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import SignOutButton from "./sign-out-button";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/signin");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white p-6 dark:bg-black">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {user.name || user.email}
        </h1>
        <SignOutButton />
      </div>
    </main>
  );
}
