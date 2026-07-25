"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useParams } from "next/navigation";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getTabletContextAction,
  listRefsForCourtAction,
  refreshCurrentMatchAction,
  selectRefAction,
  verifyTabletPinAction,
} from "@/app/tablet/actions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  CourtTabletContextOk,
  TabletMatchContext,
  TabletRefRole,
  TabletRefWithRole,
} from "@/lib/data/tablet";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

const PIN_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 5;
const LONG_PRESS_MS = 1500;

type Step = "pin" | "ref" | "match";
type LoadError = "court_not_found" | "tournament_not_active" | "invalid_court_id" | "unknown";

function pinOkKey(tournamentId: string) {
  return `clash_tablet_pin_ok:${tournamentId}`;
}

function refKey(courtId: string) {
  return `clash_tablet_ref:${courtId}`;
}

function pinAttemptsKey(tournamentId: string) {
  return `clash_tablet_pin_attempts:${tournamentId}`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function isPinFresh(tournamentId: string): boolean {
  const raw = readStorage(pinOkKey(tournamentId));
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < PIN_TTL_MS;
}

function markPinOk(tournamentId: string) {
  writeStorage(pinOkKey(tournamentId), String(Date.now()));
}

function clearPinOk(tournamentId: string) {
  writeStorage(pinOkKey(tournamentId), null);
}

function getRecentAttempts(tournamentId: string): number[] {
  try {
    const raw = readStorage(pinAttemptsKey(tournamentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - PIN_ATTEMPT_WINDOW_MS;
    return parsed
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= cutoff);
  } catch {
    return [];
  }
}

function recordFailedAttempt(tournamentId: string): number {
  const next = [...getRecentAttempts(tournamentId), Date.now()];
  writeStorage(pinAttemptsKey(tournamentId), JSON.stringify(next));
  return next.length;
}

function ClashQueueLogoSmall() {
  return (
    <div
      className="inline-flex h-6 items-center border-2 border-solid px-2.5"
      style={{
        borderColor: "#f97316",
        clipPath: LOGO_CLIP,
      }}
    >
      <span className="text-[11px] font-bold tracking-wide text-white">
        CLASH QUEUE
      </span>
    </div>
  );
}

function RoleBadge({ role }: { role: TabletRefRole }) {
  const styles: Record<TabletRefRole, CSSProperties> = {
    Admin: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
    Ops: { background: "rgba(167,139,250,0.15)", color: "#c4b5fd" },
    Referee: { background: "rgba(34,211,238,0.15)", color: "#67e8f9" },
    Organiser: { background: "rgba(251,191,36,0.15)", color: "#fcd34d" },
  };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={styles[role]}
    >
      {role}
    </span>
  );
}

function LivePill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
    >
      <span className="size-1.5 rounded-full" style={{ background: "#22c55e" }} />
      Live
    </span>
  );
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "Pending";
  if (status === "in_progress") return "In progress";
  if (status === "completed" || status === "submitted") return "Completed";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

function KioskShell({
  tournamentName,
  children,
  onLongPressReset,
}: {
  tournamentName?: string;
  children: ReactNode;
  onLongPressReset?: () => void;
}) {
  const pressTimer = useRef<number | null>(null);

  function clearPress() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  return (
    <main className="relative min-h-dvh flex-1 bg-[#0a0a12] text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-[700px] flex-col px-5 py-6 sm:px-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <ClashQueueLogoSmall />
          {tournamentName ? (
            <p className="mt-3 text-sm text-muted-foreground">{tournamentName}</p>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>

      {onLongPressReset ? (
        <>
          <button
            type="button"
            aria-label="Reset tablet PIN"
            className="absolute bottom-0 right-0 size-16 opacity-0"
            onPointerDown={() => {
              clearPress();
              pressTimer.current = window.setTimeout(() => {
                onLongPressReset();
                pressTimer.current = null;
              }, LONG_PRESS_MS);
            }}
            onPointerUp={clearPress}
            onPointerLeave={clearPress}
            onPointerCancel={clearPress}
          />
          <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[10px] text-muted-foreground/50">
            Long-press corner to reset PIN
          </p>
        </>
      ) : null}
    </main>
  );
}

function PinGate({
  tournamentId,
  onSuccess,
}: {
  tournamentId: string;
  onSuccess: () => void;
}) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setLocked(getRecentAttempts(tournamentId).length >= PIN_MAX_ATTEMPTS);
    inputsRef.current[0]?.focus();
  }, [tournamentId]);

  const submit = useCallback(
    (pin: string) => {
      if (locked || pending) return;
      if (getRecentAttempts(tournamentId).length >= PIN_MAX_ATTEMPTS) {
        setLocked(true);
        setError("Too many attempts. Wait a few minutes.");
        return;
      }

      startTransition(async () => {
        const result = await verifyTabletPinAction(tournamentId, pin);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (!result.valid) {
          const count = recordFailedAttempt(tournamentId);
          setShake(true);
          window.setTimeout(() => setShake(false), 450);
          setDigits(["", "", "", ""]);
          inputsRef.current[0]?.focus();
          if (count >= PIN_MAX_ATTEMPTS) {
            setLocked(true);
            setError("Too many attempts. Wait a few minutes.");
          } else {
            setError("Wrong PIN");
          }
          return;
        }
        writeStorage(pinAttemptsKey(tournamentId), null);
        markPinOk(tournamentId);
        onSuccess();
      });
    },
    [locked, onSuccess, pending, tournamentId]
  );

  function setDigitAt(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError(null);

    if (digit && index < 3) {
      inputsRef.current[index + 1]?.focus();
    }

    if (digit && index === 3) {
      const pin = next.join("");
      if (pin.length === 4) submit(pin);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-16">
      <h1 className="text-[20px] font-medium text-white">Enter tablet PIN</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Get the PIN from the tournament organiser
      </p>

      <div
        className={cn("mt-8 flex gap-3", shake && "tablet-pin-shake")}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            disabled={pending || locked}
            aria-label={`PIN digit ${i + 1}`}
            className="size-14 rounded-[10px] text-center font-mono text-2xl text-white outline-none focus:ring-2 focus:ring-[#a78bfa]/60 disabled:opacity-50 sm:size-16"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onChange={(e) => setDigitAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) {
                inputsRef.current[i - 1]?.focus();
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData
                .getData("text")
                .replace(/\D/g, "")
                .slice(0, 4);
              if (!pasted) return;
              const next = ["", "", "", ""];
              for (let j = 0; j < pasted.length; j++) next[j] = pasted[j];
              setDigits(next);
              if (pasted.length === 4) submit(pasted);
              else inputsRef.current[pasted.length]?.focus();
            }}
          />
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-[11px] text-[#f87171]">{error}</p>
      ) : (
        <p className="mt-3 h-[17px]" />
      )}

      {pending ? (
        <Loader2 className="mt-4 size-5 animate-spin text-[#a78bfa]" />
      ) : null}
    </div>
  );
}

export default function TabletCourtPage() {
  const params = useParams<{ courtId: string }>();
  const courtId = typeof params.courtId === "string" ? params.courtId : "";

  const [booting, setBooting] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [context, setContext] = useState<CourtTabletContextOk | null>(null);
  const [step, setStep] = useState<Step>("pin");
  const [refs, setRefs] = useState<TabletRefWithRole[]>([]);
  const [refPlayer, setRefPlayer] = useState<TabletRefWithRole | null>(null);
  const [match, setMatch] = useState<TabletMatchContext | null>(null);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadContext = useCallback(async () => {
    setBooting(true);
    setLoadError(null);
    const result = await getTabletContextAction(courtId);
    if (!result.ok) {
      const err = result.error;
      if (
        err === "court_not_found" ||
        err === "tournament_not_active" ||
        err === "invalid_court_id"
      ) {
        setLoadError(err);
      } else {
        setLoadError("unknown");
        toast.error(typeof err === "string" ? err : "Failed to load tablet");
      }
      setContext(null);
      setBooting(false);
      return;
    }

    setContext(result);
    setMatch(result.currentMatch);

    const pinNeeded = result.tournament.tablet_pin_set;
    const pinOk = !pinNeeded || isPinFresh(result.tournament.id);
    const storedRefId = readStorage(refKey(result.court.id));

    if (!pinOk) {
      setStep("pin");
      setRefPlayer(null);
      setBooting(false);
      return;
    }

    setLoadingRefs(true);
    const refsResult = await listRefsForCourtAction(result.tournament.id);
    setLoadingRefs(false);
    if (refsResult.ok) {
      setRefs(refsResult.refs);
      const found = storedRefId
        ? refsResult.refs.find((r) => r.id === storedRefId) ?? null
        : null;
      if (found) {
        setRefPlayer(found);
        setStep("match");
      } else {
        writeStorage(refKey(result.court.id), null);
        setRefPlayer(null);
        setStep("ref");
      }
    } else {
      toast.error(refsResult.error);
      setStep("ref");
    }

    setBooting(false);
  }, [courtId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (step !== "match" || !context?.court.id) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`tablet-court-kiosk-${context.court.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "courts",
          filter: `id=eq.${context.court.id}`,
        },
        () => {
          startTransition(() => {
            void refreshCurrentMatchAction(context.court.id).then((r) => {
              if (r.ok) setMatch(r.match);
            });
          });
        }
      );

    if (match?.match.id) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `id=eq.${match.match.id}`,
        },
        () => {
          startTransition(() => {
            void refreshCurrentMatchAction(context.court.id).then((r) => {
              if (r.ok) setMatch(r.match);
            });
          });
        }
      );
    }

    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [step, context?.court.id, match?.match.id]);

  async function advanceFromPin() {
    if (!context) return;
    setLoadingRefs(true);
    const refsResult = await listRefsForCourtAction(context.tournament.id);
    setLoadingRefs(false);
    if (refsResult.ok) setRefs(refsResult.refs);
    else toast.error(refsResult.error);

    const storedRefId = readStorage(refKey(context.court.id));
    const found = storedRefId
      ? (refsResult.ok ? refsResult.refs : []).find((r) => r.id === storedRefId)
      : null;
    if (found) {
      setRefPlayer(found);
      setStep("match");
      void refreshCurrentMatchAction(context.court.id).then((r) => {
        if (r.ok) setMatch(r.match);
      });
    } else {
      setStep("ref");
    }
  }

  async function pickRef(ref: TabletRefWithRole) {
    if (!context) return;
    writeStorage(refKey(context.court.id), ref.id);
    await selectRefAction(context.court.id, ref.id);
    setRefPlayer(ref);
    setStep("match");
    const result = await refreshCurrentMatchAction(context.court.id);
    if (result.ok) setMatch(result.match);
  }

  function switchRef() {
    if (!context) return;
    writeStorage(refKey(context.court.id), null);
    setRefPlayer(null);
    setStep("ref");
  }

  function resetPin() {
    if (!context) return;
    clearPinOk(context.tournament.id);
    writeStorage(refKey(context.court.id), null);
    setRefPlayer(null);
    if (context.tournament.tablet_pin_set) {
      setStep("pin");
      toast.message("PIN reset — enter PIN again");
    } else {
      setStep("ref");
    }
  }

  if (booting) {
    return (
      <KioskShell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-[#a78bfa]" />
        </div>
      </KioskShell>
    );
  }

  if (loadError || !context) {
    const message =
      loadError === "tournament_not_active"
        ? "This tournament isn't live yet. The tablet will activate when the TO starts the tournament."
        : "This tablet URL is invalid or the court has been deleted. Contact the TO.";

    return (
      <KioskShell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="max-w-sm text-[15px] text-muted-foreground">{message}</p>
          <Button
            type="button"
            className="mt-6 min-h-11 bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
            onClick={() => void loadContext()}
          >
            Retry
          </Button>
        </div>
      </KioskShell>
    );
  }

  return (
    <TooltipProvider>
      <KioskShell
        tournamentName={context.tournament.name}
        onLongPressReset={
          context.tournament.tablet_pin_set ? resetPin : undefined
        }
      >
        {!context.tournament.tablet_pin_set && step !== "pin" ? (
          <div
            className="mb-4 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12px]"
            style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.25)",
              color: "#fbbf24",
            }}
          >
            This tournament has no PIN set. Anyone with this URL can score
            matches.
          </div>
        ) : null}

        {step === "pin" ? (
          <PinGate
            tournamentId={context.tournament.id}
            onSuccess={() => void advanceFromPin()}
          />
        ) : null}

        {step === "ref" ? (
          <div className="flex flex-1 flex-col">
            <div className="mb-6 text-center">
              <h1 className="text-[20px] font-medium text-white">
                Check in as ref
              </h1>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {context.court.name} — {context.tournament.name}
              </p>
            </div>

            {loadingRefs ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="size-7 animate-spin text-[#a78bfa]" />
              </div>
            ) : refs.length === 0 ? (
              <p className="text-center text-[13px] text-muted-foreground">
                No refs available — an admin needs to assign referee roles
                first
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                {refs.map((ref) => (
                  <button
                    key={ref.id}
                    type="button"
                    onClick={() => void pickRef(ref)}
                    className="relative min-h-20 rounded-[10px] p-4 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/60"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div className="absolute top-3 right-3">
                      <RoleBadge role={ref.role} />
                    </div>
                    <p className="pr-16 text-base font-medium text-white">
                      {ref.display_name}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {step === "match" && refPlayer ? (
          <div className="flex flex-1 flex-col">
            <header
              className="flex items-start justify-between gap-3 pb-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-white">
                  {context.tournament.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {context.court.name} · {refPlayer.display_name}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 shrink-0 text-muted-foreground hover:text-white"
                onClick={switchRef}
              >
                Switch ref
              </Button>
            </header>

            <div className="flex flex-1 flex-col items-center justify-center py-10">
              {isPending && !match ? (
                <Loader2 className="size-8 animate-spin text-[#a78bfa]" />
              ) : match ? (
                <div className="flex w-full max-w-lg flex-col items-center text-center">
                  <div className="mb-4">
                    {match.match.status === "in_progress" ? (
                      <LivePill />
                    ) : (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                        style={{ background: "rgba(255,255,255,0.06)" }}
                      >
                        {statusLabel(match.match.status)}
                      </span>
                    )}
                  </div>

                  <p
                    className="text-3xl font-semibold sm:text-4xl"
                    style={{ color: "var(--scorer-p1)" }}
                  >
                    {match.players[0]?.display_name ?? "TBD"}
                  </p>
                  <p className="my-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
                    vs
                  </p>
                  <p
                    className="text-3xl font-semibold sm:text-4xl"
                    style={{ color: "var(--scorer-p2)" }}
                  >
                    {match.players[1]?.display_name ?? "TBD"}
                  </p>

                  <p className="mt-10 text-[13px] text-muted-foreground">
                    Scoring UI comes next
                  </p>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="mt-4 inline-flex">
                        <Button
                          type="button"
                          disabled
                          className="min-h-11 bg-[#a78bfa]/40 text-[#0a0a12]"
                        >
                          Start match
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Coming next step</TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <div className="relative mb-5 flex size-14 items-center justify-center">
                    <span
                      className="absolute inset-0 animate-ping rounded-full opacity-20"
                      style={{ background: "#a78bfa" }}
                    />
                    <Clock className="relative size-7 text-[#a78bfa]" />
                  </div>
                  <p className="text-[20px] font-medium text-white">
                    Waiting for a match
                  </p>
                  <p className="mt-2 max-w-sm text-[13px] text-muted-foreground">
                    Ask the TO to assign a match to {context.court.name}.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </KioskShell>
    </TooltipProvider>
  );
}
