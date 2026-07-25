"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { syncMatchesAction } from "@/app/t/[id]/actions";
import { cn } from "@/lib/utils";

export function SyncMatchesButton({
  tournamentId,
  className,
}: {
  tournamentId: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await syncMatchesAction(tournamentId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          if (result.generated > 0) {
            toast.success(
              `Added ${result.generated} new match${result.generated === 1 ? "" : "es"}`
            );
          } else {
            toast.success("All matches up to date, no new matches");
          }
          if (result.errors.length > 0) {
            toast.error(
              `${result.errors.length} match${result.errors.length === 1 ? "" : "es"} failed to sync`
            );
          }
          router.refresh();
        });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      aria-label="Sync matches from Challonge"
    >
      {isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <RefreshCw className="size-3" />
      )}
      Sync matches
    </button>
  );
}
