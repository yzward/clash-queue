import Link from "next/link";

export default function NotAuthorisedPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Not authorised
      </h1>
      <p className="max-w-md text-muted-foreground">
        Clash Queue is for tournament organisers. If you think you should have
        access, contact an admin.
      </p>
      <Link
        href="https://play.clash.co.nz"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Go to play.clash.co.nz
      </Link>
    </main>
  );
}
