"use client";

import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  linkChallongeAction,
  setTabletPinAction,
  unlinkChallongeAction,
  verifyChallongeLinkAction,
  type ChallongePreview,
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
import { Input } from "@/components/ui/input";

type SettingsTournament = {
  id: string;
  name: string;
  challonge_id: string | null;
  /** True when a PIN is stored — never pass the raw digits into this UI. */
  tabletPinSet: boolean;
};

const PIN_RE = /^[0-9]{4}$/;

const STARTED_BRACKET_STATES = new Set([
  "underway",
  "group_stages_underway",
  "complete",
]);

function verifyErrorMessage(
  error: string,
  parsedId?: string
): string {
  switch (error) {
    case "invalid_format":
      return "That doesn't look like a Challonge URL or slug. Paste the full URL or just the slug (e.g. nl7udlbm).";
    case "not_found":
      return `No Challonge tournament found for '${parsedId ?? "that id"}'. Check the URL or make sure the tournament is public / your API key can see it.`;
    case "auth":
      return "Challonge rejected the API key. Contact Armani.";
    case "network":
      return "Couldn't reach Challonge. Try again.";
    default:
      return "Something went wrong talking to Challonge. Try again.";
  }
}

export function SettingsTab({
  tournament,
}: {
  tournament: SettingsTournament;
}) {
  const [linkedId, setLinkedId] = useState(tournament.challonge_id);
  const [pinSet, setPinSet] = useState(tournament.tabletPinSet);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ChallongePreview | null>(null);
  const [verifiedInput, setVerifiedInput] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkCounts, setUnlinkCounts] = useState<{
    entrants_with_ids: number;
    matches_with_ids: number;
  } | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [clearPinOpen, setClearPinOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setLinkedId(tournament.challonge_id);
  }, [tournament.challonge_id]);

  useEffect(() => {
    setPinSet(tournament.tabletPinSet);
  }, [tournament.tabletPinSet]);

  useEffect(() => {
    if (pinDialogOpen) {
      setPinDraft("");
      setPinError(null);
      const t = window.setTimeout(() => pinInputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [pinDialogOpen]);

  const isLinked = Boolean(linkedId);
  const canLink =
    preview != null &&
    verifiedInput != null &&
    verifiedInput === input.trim();

  const resetUnlinkedForm = () => {
    setInput("");
    setPreview(null);
    setVerifiedInput(null);
    setVerifyError(null);
    setLinkError(null);
  };

  const runVerify = () => {
    setVerifyError(null);
    setLinkError(null);
    setPreview(null);
    setVerifiedInput(null);
    setVerifying(true);

    startTransition(async () => {
      const result = await verifyChallongeLinkAction(input);
      setVerifying(false);
      if (!result.ok) {
        setVerifyError(verifyErrorMessage(result.error, result.parsedId));
        return;
      }
      setPreview(result.preview);
      setVerifiedInput(input.trim());
    });
  };

  const runLink = () => {
    if (!canLink) return;
    setLinkError(null);

    startTransition(async () => {
      const result = await linkChallongeAction(tournament.id, input);
      if (!result.ok) {
        const message =
          result.message ||
          verifyErrorMessage(result.error) ||
          "Failed to link Challonge";
        setLinkError(message);
        toast.error(message);
        return;
      }
      setLinkedId(result.tournament.challonge_id);
      resetUnlinkedForm();
      toast.success("Challonge bracket linked");
    });
  };

  const attemptUnlink = (confirmDataLoss: boolean) => {
    startTransition(async () => {
      const result = await unlinkChallongeAction(tournament.id, {
        confirmDataLoss,
      });

      if (!result.ok) {
        if (result.error === "has_challonge_data" && result.counts) {
          setUnlinkCounts(result.counts);
          setUnlinkOpen(true);
          return;
        }
        const message = result.message || "Failed to unlink Challonge";
        toast.error(message);
        return;
      }

      setUnlinkOpen(false);
      setUnlinkCounts(null);
      setLinkedId(null);
      resetUnlinkedForm();
      toast.success("Challonge bracket unlinked");
    });
  };

  const startedWarning =
    preview && STARTED_BRACKET_STATES.has(preview.state);

  const pinValid = PIN_RE.test(pinDraft);

  function savePin() {
    if (!pinValid) {
      setPinError("Enter exactly 4 digits.");
      return;
    }
    setPinError(null);
    startTransition(async () => {
      const result = await setTabletPinAction(tournament.id, pinDraft);
      if (!result.ok) {
        if (result.error === "invalid_pin_format") {
          setPinError("Enter exactly 4 digits.");
        } else {
          toast.error(result.error);
        }
        return;
      }
      setPinSet(true);
      setPinDialogOpen(false);
      setPinDraft("");
      toast.success(pinSet ? "Tablet PIN updated" : "Tablet PIN set");
    });
  }

  function clearPin() {
    startTransition(async () => {
      const result = await setTabletPinAction(tournament.id, null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPinSet(false);
      setClearPinOpen(false);
      toast.success("Tablet PIN cleared");
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[14px] font-medium text-white">Settings</h2>

      <div
        className="rounded-[10px] p-4"
        style={{
          background: isLinked
            ? "rgba(34,197,94,0.05)"
            : "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderLeft: isLinked
            ? "2px solid rgba(34,197,94,0.5)"
            : "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <h3 className="text-sm font-medium text-white">Challonge bracket</h3>

        {isLinked ? (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-white">
                Linked to Challonge
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Bracket ID: {linkedId}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-white"
                asChild
              >
                <a
                  href={`https://challonge.com/${linkedId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open on Challonge
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => attemptUnlink(false)}
                disabled={pending}
              >
                {pending ? "Unlinking…" : "Unlink"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Link a Challonge bracket to enable participant sync, match
              generation, and results reporting.
            </p>

            <div className="space-y-2">
              <label
                htmlFor="challonge-link-input"
                className="text-xs font-medium text-muted-foreground"
              >
                Challonge URL, slug, or ID
              </label>
              <Input
                id="challonge-link-input"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setPreview(null);
                  setVerifiedInput(null);
                  setVerifyError(null);
                  setLinkError(null);
                }}
                placeholder="https://challonge.com/nl7udlbm or nl7udlbm"
                disabled={pending}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={runVerify}
                disabled={pending || !input.trim()}
                className="gap-1.5"
                style={{ color: "#c4b5fd" }}
              >
                {verifying ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking Challonge...
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={runLink}
                disabled={pending || !canLink}
              >
                {pending && !verifying ? "Linking…" : "Link"}
              </Button>
            </div>

            {verifyError ? (
              <div
                className="rounded-[6px] px-3 py-2 text-sm"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#fca5a5",
                }}
              >
                {verifyError}
              </div>
            ) : null}

            {preview ? (
              <div
                className="rounded-[6px] px-3 py-2.5"
                style={{
                  background: "rgba(34,197,94,0.05)",
                  border: "1px solid rgba(34,197,94,0.2)",
                }}
              >
                <p className="text-sm font-medium text-white">
                  Found: {preview.name}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  state: {preview.state} · {preview.participantCount}{" "}
                  participants · {preview.matchCount} matches
                </p>
                {startedWarning ? (
                  <p
                    className="mt-2 text-[11px]"
                    style={{ color: "#fbbf24" }}
                  >
                    This bracket is already started. You can still link it, but
                    you won&apos;t be able to push new participants.
                  </p>
                ) : null}
              </div>
            ) : null}

            {linkError ? (
              <p className="text-sm text-destructive">{linkError}</p>
            ) : null}
          </div>
        )}
      </div>

      <div
        className="rounded-[10px] p-4"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <h3 className="text-sm font-medium text-white">Tablet PIN</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Set a 4-digit PIN that refs enter on tablets before scoring. Tablets
          remember the PIN for 12 hours.
        </p>

        {pinSet ? (
          <div className="mt-3 space-y-3">
            <p className="font-mono text-[12px] text-muted-foreground">
              PIN: •••• (set)
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-white"
                onClick={() => setPinDialogOpen(true)}
                disabled={pending}
              >
                Change PIN
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setClearPinOpen(true)}
                disabled={pending}
              >
                Clear PIN
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p
              className="flex items-start gap-2 text-[12px]"
              style={{ color: "#fbbf24" }}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                No PIN set — anyone with a tablet URL can score
              </span>
            </p>
            <Button
              type="button"
              size="sm"
              className="bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
              onClick={() => setPinDialogOpen(true)}
              disabled={pending}
            >
              Set PIN
            </Button>
          </div>
        )}
      </div>

      <Dialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Challonge?</DialogTitle>
            <DialogDescription>
              This tournament has {unlinkCounts?.entrants_with_ids ?? 0}{" "}
              entrants and {unlinkCounts?.matches_with_ids ?? 0} matches linked
              to Challonge. Unlinking will clear those references locally, but
              does NOT delete anything on Challonge. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnlinkOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => attemptUnlink(true)}
              disabled={pending}
            >
              {pending ? "Unlinking…" : "Unlink anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pinDialogOpen}
        onOpenChange={(open) => {
          if (pending) return;
          setPinDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {pinSet ? "Change tablet PIN" : "Set tablet PIN"}
            </DialogTitle>
            <DialogDescription className="text-left text-[12px] text-muted-foreground">
              This PIN will be required on all tablets for this tournament.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="tablet-pin-input"
              className="text-xs font-medium text-muted-foreground"
            >
              4-digit PIN
            </label>
            <Input
              ref={pinInputRef}
              id="tablet-pin-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              pattern="[0-9]{4}"
              value={pinDraft}
              disabled={pending}
              placeholder="••••"
              className="font-mono tracking-[0.3em]"
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 4);
                setPinDraft(next);
                setPinError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && pinValid && !pending) {
                  event.preventDefault();
                  savePin();
                }
              }}
            />
            {pinError ? (
              <p className="text-sm text-destructive">{pinError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setPinDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || !pinValid}
              className="bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
              onClick={() => savePin()}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={clearPinOpen}
        onOpenChange={(open) => {
          if (pending) return;
          setClearPinOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Clear tablet PIN?</DialogTitle>
            <DialogDescription className="text-left text-[12px] leading-relaxed text-muted-foreground">
              Without a PIN, anyone with a tablet URL can score matches for
              this tournament. This includes if a URL is shared or shown on
              stream. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setClearPinOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => clearPin()}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Clear PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
