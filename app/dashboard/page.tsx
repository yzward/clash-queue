import { redirect } from "next/navigation";

import { requireTO } from "@/lib/auth/require-to";

export default async function DashboardPage() {
  const auth = await requireTO();

  if (!auth.authorised) {
    if (auth.reason === "no_session") {
      redirect("/login");
    }
    redirect("/not-authorised");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6">
      <p className="text-muted-foreground">
        Dashboard — signed in as {auth.userId}, roles: {auth.roles.join(", ")}
      </p>
    </main>
  );
}
