"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import {
  createTournamentFromChallongeAction,
  verifyChallongeForCreateAction,
} from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CreateFromChallongePreview } from "@/lib/data/tournaments";
import { cn } from "@/lib/utils";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

function verifyErrorMessage(error: string, parsedId?: string): string {
  switch (error) {
    case "invalid_format":
      return "That doesn't look like a Challonge URL or slug. Paste the full URL or just the slug (e.g. nl7udlbm).";
    case "not_found":
      return `No Challonge tournament found for '${parsedId ?? "that id"}'. Check the URL or make sure the tournament is public / your API key can see it.`;
    case "auth":
      return "Challonge rejected the API key. Contact Armani.";
    case "network":
      return "Couldn't reach Challonge. Try again.";
    case "already_linked":
      return "This Challonge bracket is already linked to a Clash Queue tournament.";
    default:
      return "Something went wrong talking to Challonge. Try again.";
  }
}

export function NewTournamentButton({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [input, setInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [preview, setPreview] = useState<CreateFromChallongePreview | null>(
    null
  );
  const [verifiedInput, setVerifiedInput] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [existingLink, setExistingLink] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [isRanking, setIsRanking] = useState(true);
  const [isMajor, setIsMajor] = useState(false);

  const canCreate =
    preview != null &&
    verifiedInput != null &&
    verifiedInput === input.trim() &&
    !existingLink;

  function resetForm() {
    setInput("");
    setPreview(null);
    setVerifiedInput(null);
    setVerifyError(null);
    setExistingLink(null);
    setCreateError(null);
    setIsRanking(true);
    setIsMajor(false);
    setVerifying(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function runVerify() {
    setVerifyError(null);
    setCreateError(null);
    setPreview(null);
    setVerifiedInput(null);
    setExistingLink(null);
    setVerifying(true);

    startTransition(async () => {
      const result = await verifyChallongeForCreateAction(input);
      setVerifying(false);
      if (!result.ok) {
        if (
          result.error === "already_linked" &&
          result.existing_tournament_id
        ) {
          setExistingLink({
            id: result.existing_tournament_id,
            name: result.existing_tournament_name ?? "Existing tournament",
          });
          setVerifyError(null);
          return;
        }
        setVerifyError(
          result.message ||
            verifyErrorMessage(result.error, result.parsedId)
        );
        return;
      }
      setPreview(result.preview);
      setVerifiedInput(input.trim());
    });
  }

  function runCreate() {
    if (!canCreate) return;
    setCreateError(null);

    startTransition(async () => {
      const result = await createTournamentFromChallongeAction(input, {
        isRanking,
        isMajor,
      });
      if (!result.ok) {
        if (
          result.error === "already_linked" &&
          result.existing_tournament_id
        ) {
          setExistingLink({
            id: result.existing_tournament_id,
            name: result.existing_tournament_name ?? "Existing tournament",
          });
          setPreview(null);
          setVerifiedInput(null);
          return;
        }
        setCreateError(result.message || "Failed to create tournament");
        toast.error(result.message || "Failed to create tournament");
        return;
      }
      toast.success("Tournament created");
      handleOpenChange(false);
      router.push(`/t/${result.tournamentId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center bg-white px-3.5 py-2 text-sm font-semibold text-[#0a0a12] transition-opacity hover:opacity-90",
            className
          )}
          style={{ clipPath: LOGO_CLIP }}
        >
          + New tournament
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md border-white/10 bg-[#12101a] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            New tournament from Challonge
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Link an existing Challonge bracket. Players are added later from
            the Players tab — nothing is created on Challonge.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Challonge URL, slug, or ID
            </label>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setPreview(null);
                  setVerifiedInput(null);
                  setVerifyError(null);
                  setExistingLink(null);
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runVerify();
                  }
                }}
                placeholder="https://challonge.com/… or nl7udlbm"
                className="border-white/10 bg-background text-sm font-bold"
                disabled={isPending}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!input.trim() || verifying || isPending}
                onClick={runVerify}
                className="shrink-0 border-white/15"
              >
                {verifying ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Verify"
                )}
              </Button>
            </div>
          </div>

          {verifyError ? (
            <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
              {verifyError}
            </p>
          ) : null}

          {existingLink ? (
            <div className="space-y-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
              <p className="text-[12px] text-amber-100">
                This Challonge bracket is already linked to a Clash Queue
                tournament.
              </p>
              <Link
                href={`/t/${existingLink.id}`}
                className="inline-flex text-[12px] font-semibold text-[#a78bfa] underline-offset-2 hover:underline"
                onClick={() => handleOpenChange(false)}
              >
                Open {existingLink.name} →
              </Link>
            </div>
          ) : null}

          {preview && canCreate ? (
            <div
              className="space-y-1 rounded-lg px-3 py-2.5"
              style={{
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.25)",
              }}
            >
              <p className="text-[13px] font-medium text-[#86efac]">
                Found: {preview.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {preview.formatLabel} · {preview.state} ·{" "}
                {preview.participantCount} participants
              </p>
              {preview.state === "complete" ? (
                <p className="pt-1 text-[11px] text-amber-200">
                  This bracket is already finished. You can still import it for
                  record-keeping.
                </p>
              ) : null}
            </div>
          ) : null}

          {canCreate ? (
            <div className="space-y-3 border-t border-white/10 pt-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Local settings
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsRanking(true)}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-[12px] font-semibold transition-colors",
                    isRanking
                      ? "bg-[rgba(167,139,250,0.25)] text-[#c4b5fd] ring-1 ring-[#a78bfa]"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10"
                  )}
                >
                  Ranked
                </button>
                <button
                  type="button"
                  onClick={() => setIsRanking(false)}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-[12px] font-semibold transition-colors",
                    !isRanking
                      ? "bg-[rgba(167,139,250,0.25)] text-[#c4b5fd] ring-1 ring-[#a78bfa]"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10"
                  )}
                >
                  Casual
                </button>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={isMajor}
                onClick={() => setIsMajor((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div>
                  <p className="text-sm font-medium text-white">Major event</p>
                  <p className="text-[11px] text-muted-foreground">
                    Tag for majors / invitational billing
                  </p>
                </div>
                <span
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
                    isMajor ? "bg-[#fbbf24]" : "bg-white/15"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
                      isMajor ? "translate-x-[22px]" : "translate-x-0.5"
                    )}
                  />
                </span>
              </button>
            </div>
          ) : null}

          {createError ? (
            <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
              {createError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-white/10 bg-transparent">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canCreate || isPending}
            onClick={runCreate}
            className="bg-[#a78bfa] font-black uppercase tracking-widest text-xs text-[#0a0a12] hover:bg-[#b79afc] disabled:opacity-40"
          >
            {isPending && !verifying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Create tournament"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
