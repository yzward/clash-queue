"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  completeTournamentAction,
  type CompleteTournamentActionResult,
} from "@/app/t/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))";

type Props = {
  tournamentId: string;
  tournamentName: string;
  isRankingTournament: boolean;
  challongeId: string | null;
  matchCount: number;
  submittedMatchCount: number;
};

export function CompleteTournamentCard({
  tournamentId,
  tournamentName,
  isRankingTournament,
  challongeId,
  matchCount,
  submittedMatchCount,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const unsubmitted = Math.max(0, matchCount - submittedMatchCount);
  const allSubmitted = matchCount > 0 && unsubmitted === 0;

  function handleConfirm() {
    if (!allSubmitted) return;
    startTransition(async () => {
      const result = await completeTournamentAction(tournamentId);
      handleResult(result);
    });
  }

  function handleResult(result: CompleteTournamentActionResult) {
    if (result.ok) {
      setOpen(false);
      const clpLabel = result.clpAwarded ? "awarded" : "skipped";
      toast.success(
        `Tournament completed. ${result.placementsWritten} placements, CLP ${clpLabel}.`
      );
      router.refresh();
      return;
    }

    if (result.error === "matches_incomplete") {
      toast.error(
        result.message ??
          `All matches must be submitted. ${result.unsubmittedCount ?? "Some"} still open.`
      );
      return;
    }

    if (result.error === "challonge_not_finalised") {
      toast.error(
        result.message ??
          "Challonge has no final ranks yet. Finalise the bracket on Challonge first.",
        result.challongePublicUrl
          ? {
              action: {
                label: "Open Challonge",
                onClick: () => {
                  window.open(result.challongePublicUrl, "_blank", "noopener");
                },
              },
            }
          : undefined
      );
      return;
    }

    if (result.error === "challonge_finalize_failed") {
      toast.error(result.message ?? "Couldn't finalise Challonge.");
      return;
    }

    if (result.error === "clp_award_failed") {
      toast.error(result.message ?? "CLP award failed after completion.");
      router.refresh();
      return;
    }

    toast.error(result.message ?? result.error);
  }

  return (
    <>
      <div
        className="rounded-[10px] px-4 py-5"
        style={{
          background: "rgba(34,197,94,0.05)",
          border: "1px solid rgba(34,197,94,0.15)",
          borderTop: "2px solid #22c55e",
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Tournament is live</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {submittedMatchCount} of {matchCount} match
              {matchCount === 1 ? "" : "es"} submitted
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {isRankingTournament
                ? "Ranked — completing awards CLP from Challonge standings"
                : "Casual — completing finalises standings with no CLP"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "inline-flex shrink-0 items-center justify-center px-4 py-2 text-sm font-semibold transition-opacity",
              "bg-white text-[#0a0a12] hover:opacity-90"
            )}
            style={{ clipPath: LOGO_CLIP }}
          >
            Complete tournament
          </button>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Complete {tournamentName}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-left text-[12px] leading-relaxed text-muted-foreground">
                <p>
                  {submittedMatchCount} of {matchCount} matches submitted.
                </p>
                {!allSubmitted ? (
                  <p className="text-[#fcd34d]">
                    All matches must be submitted before completing.{" "}
                    {unsubmitted} still open.
                  </p>
                ) : (
                  <>
                    <p>
                      This will finalise placements from Challonge and award CLP
                      points (ranked tournaments only). The tournament moves to
                      completed.
                    </p>
                    <p className="font-medium text-white/80">
                      {isRankingTournament
                        ? "Ranked — CLP will be awarded"
                        : "Casual — no CLP"}
                    </p>
                    {!challongeId ? (
                      <p className="text-[#fcd34d]">
                        No Challonge link — completion requires a Challonge
                        bracket for placements.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            {allSubmitted ? (
              <Button
                type="button"
                disabled={pending || !challongeId}
                className="bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
                onClick={handleConfirm}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Complete tournament
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
