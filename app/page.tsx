import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <div
        className="border-2 border-solid px-5 py-2.5"
        style={{
          borderColor: "#f97316",
          clipPath:
            "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))",
        }}
      >
        <span className="text-2xl font-bold tracking-wide text-white sm:text-3xl">
          CLASH QUEUE
        </span>
      </div>

      <p className="text-center text-muted-foreground">
        Tournament management for Clash League NZ
      </p>

      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
