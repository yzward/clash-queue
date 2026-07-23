import Link from "next/link";

export default function TournamentNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Tournament not found
      </h1>
      <p className="max-w-md text-muted-foreground">
        This tournament may have been deleted or the link is incorrect.
      </p>
      <Link
        href="/dashboard"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
