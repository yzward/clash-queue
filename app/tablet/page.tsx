"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  Loader2,
  Radio,
} from "lucide-react";
import { toast } from "sonner";

import {
  getTabletContextAction,
  listActiveTournamentsAction,
  listCourtsForTournamentAction,
  listRefsForTabletAction,
  refreshCurrentMatchAction,
} from "@/app/tablet/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  TabletCourt,
  TabletMatchContext,
  TabletRef,
  TabletTournament,
} from "@/lib/data/tablet";
import { createClient } from "@/lib/supabase/client";
import { formatNZDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const LS_TOURNAMENT = "csp_tournament_id";
const LS_COURT = "clash_tablet_court_id";
const LS_REF = "clash_tablet_ref_id";

type Step = "tournament" | "court" | "ref" | "match";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore quota / private mode
  }
}

function ClashQueueLogoSmall() {
  return (
    <div
      className="inline-flex border-2 border-solid px-3.5 py-1.5"
      style={{
        borderColor: "#f97316",
        clipPath: LOGO_CLIP,
      }}
    >
      <span className="text-sm font-bold tracking-wide text-white">
        CLASH QUEUE
      </span>
    </div>
  );
}

function LivePill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: "#22c55e" }}
      />
      Live
    </span>
  );
}

function InUsePill() {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "rgba(251,191,36,0.15)", color: "#fcd34d" }}
    >
      In use
    </span>
  );
}

function TouchCard({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[140px] w-full rounded-[10px] p-4 text-left transition-colors",
        "hover:bg-white/[0.05] active:bg-white/[0.07]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/60",
        className
      )}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {children}
    </button>
  );
}

function BackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
    >
      <ChevronLeft className="size-4" />
      {label}
    </button>
  );
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "Pending";
  if (status === "in_progress") return "In progress";
  if (status === "completed" || status === "submitted") return "Completed";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export default function TabletPage() {
  const [booting, setBooting] = useState(true);
  const [step, setStep] = useState<Step>("tournament");

  const [tournament, setTournament] = useState<TabletTournament | null>(null);
  const [court, setCourt] = useState<TabletCourt | null>(null);
  const [refPlayer, setRefPlayer] = useState<TabletRef | null>(null);

  const [tournaments, setTournaments] = useState<TabletTournament[]>([]);
  const [courts, setCourts] = useState<TabletCourt[]>([]);
  const [refs, setRefs] = useState<TabletRef[]>([]);
  const [match, setMatch] = useState<TabletMatchContext | null>(null);

  const [loadingList, setLoadingList] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadTournaments = useCallback(async () => {
    setLoadingList(true);
    const result = await listActiveTournamentsAction();
    setLoadingList(false);
    if (!result.ok) {
      toast.error(result.error);
      setTournaments([]);
      return;
    }
    setTournaments(result.tournaments);
  }, []);

  const loadCourts = useCallback(async (tournamentId: string) => {
    setLoadingList(true);
    const result = await listCourtsForTournamentAction(tournamentId);
    setLoadingList(false);
    if (!result.ok) {
      toast.error(result.error);
      setCourts([]);
      return;
    }
    setCourts(result.courts);
  }, []);

  const loadRefs = useCallback(async (tournamentId: string) => {
    setLoadingList(true);
    const result = await listRefsForTabletAction(tournamentId);
    setLoadingList(false);
    if (!result.ok) {
      toast.error(result.error);
      setRefs([]);
      return;
    }
    setRefs(result.refs);
  }, []);

  const loadMatch = useCallback(async (courtId: string) => {
    const result = await refreshCurrentMatchAction(courtId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setMatch(result.match);
  }, []);

  const clearFrom = useCallback(
    (level: "tournament" | "court" | "ref") => {
      if (level === "tournament") {
        writeStorage(LS_TOURNAMENT, null);
        writeStorage(LS_COURT, null);
        writeStorage(LS_REF, null);
        setTournament(null);
        setCourt(null);
        setRefPlayer(null);
        setMatch(null);
        setStep("tournament");
        void loadTournaments();
        return;
      }
      if (level === "court") {
        writeStorage(LS_COURT, null);
        writeStorage(LS_REF, null);
        setCourt(null);
        setRefPlayer(null);
        setMatch(null);
        setStep("court");
        if (tournament) void loadCourts(tournament.id);
        return;
      }
      writeStorage(LS_REF, null);
      setRefPlayer(null);
      setMatch(null);
      setStep("ref");
      if (tournament) void loadRefs(tournament.id);
    },
    [loadCourts, loadRefs, loadTournaments, tournament]
  );

  // Boot: query params + localStorage validation
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const qTournament = params.get("tournament");
      const qCourt = params.get("court");
      const qRef = params.get("ref");

      const storedTournament = readStorage(LS_TOURNAMENT);
      const storedCourt = readStorage(LS_COURT);
      const storedRef = readStorage(LS_REF);

      const tournamentId = qTournament || storedTournament;
      const courtId = qCourt || storedCourt;
      const refId = qRef || storedRef;

      const result = await getTabletContextAction({
        tournamentId,
        courtId,
        refId,
      });

      if (cancelled) return;

      if (!result.ok) {
        toast.error(result.error);
        setBooting(false);
        void loadTournaments();
        return;
      }

      const { tournament: t, court: c, ref: r } = result.context;

      if (!t) {
        writeStorage(LS_TOURNAMENT, null);
        writeStorage(LS_COURT, null);
        writeStorage(LS_REF, null);
        setTournament(null);
        setCourt(null);
        setRefPlayer(null);
        setStep("tournament");
        await loadTournaments();
      } else if (!c) {
        writeStorage(LS_TOURNAMENT, t.id);
        writeStorage(LS_COURT, null);
        writeStorage(LS_REF, null);
        setTournament(t);
        setCourt(null);
        setRefPlayer(null);
        setStep("court");
        await loadCourts(t.id);
      } else if (!r) {
        writeStorage(LS_TOURNAMENT, t.id);
        writeStorage(LS_COURT, c.id);
        writeStorage(LS_REF, null);
        setTournament(t);
        setCourt(c);
        setRefPlayer(null);
        setStep("ref");
        await loadRefs(t.id);
      } else {
        writeStorage(LS_TOURNAMENT, t.id);
        writeStorage(LS_COURT, c.id);
        writeStorage(LS_REF, r.id);
        setTournament(t);
        setCourt(c);
        setRefPlayer(r);
        setStep("match");
        await loadMatch(c.id);
      }

      if (qTournament || qCourt || qRef) {
        const url = new URL(window.location.href);
        url.search = "";
        window.history.replaceState({}, "", url.pathname);
      }

      if (!cancelled) setBooting(false);
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadCourts, loadMatch, loadRefs, loadTournaments]);

  // Realtime: court occupancy + current match status
  useEffect(() => {
    if (step !== "match" || !court?.id) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`tablet-court-${court.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "courts",
          filter: `id=eq.${court.id}`,
        },
        () => {
          startTransition(() => {
            void loadMatch(court.id);
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
            void loadMatch(court.id);
          });
        }
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [step, court?.id, match?.match.id, loadMatch]);

  function selectTournament(t: TabletTournament) {
    writeStorage(LS_TOURNAMENT, t.id);
    writeStorage(LS_COURT, null);
    writeStorage(LS_REF, null);
    setTournament(t);
    setCourt(null);
    setRefPlayer(null);
    setMatch(null);
    setStep("court");
    void loadCourts(t.id);
  }

  function selectCourt(c: TabletCourt) {
    writeStorage(LS_COURT, c.id);
    writeStorage(LS_REF, null);
    setCourt(c);
    setRefPlayer(null);
    setMatch(null);
    setStep("ref");
    if (tournament) void loadRefs(tournament.id);
  }

  function selectRef(r: TabletRef) {
    writeStorage(LS_REF, r.id);
    setRefPlayer(r);
    setStep("match");
    if (court) void loadMatch(court.id);
  }

  if (booting) {
    return (
      <main className="flex min-h-dvh flex-1 items-center justify-center bg-[#0a0a12] px-6">
        <Loader2 className="size-8 animate-spin text-[#a78bfa]" />
      </main>
    );
  }

  return (
    <TooltipProvider>
      <main className="min-h-dvh flex-1 bg-[#0a0a12] text-white">
        <div className="mx-auto flex min-h-dvh w-full max-w-[900px] flex-col px-5 py-6 sm:px-8">
          {step === "tournament" ? (
            <div className="flex flex-1 flex-col">
              <div className="mb-8 flex flex-col items-center text-center">
                <ClashQueueLogoSmall />
                <h1 className="mt-6 text-[18px] font-medium text-white">
                  Select tournament
                </h1>
                <p className="mt-2 max-w-md text-[13px] text-muted-foreground">
                  Choose which tournament this tablet will score matches for
                </p>
              </div>

              {loadingList ? (
                <div className="flex flex-1 items-center justify-center py-16">
                  <Loader2 className="size-7 animate-spin text-[#a78bfa]" />
                </div>
              ) : tournaments.length === 0 ? (
                <div
                  className="mx-auto flex w-full max-w-md flex-col items-center rounded-[10px] px-6 py-12 text-center"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <p className="text-[15px] font-medium text-white">
                    No active tournaments right now
                  </p>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Wait for a tournament to be started, then reload this page.
                  </p>
                  <Button
                    type="button"
                    className="mt-5 min-h-11 bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
                    onClick={() => void loadTournaments()}
                  >
                    Reload
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {tournaments.map((t) => (
                    <TouchCard key={t.id} onClick={() => selectTournament(t)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-medium text-white">
                          {t.name}
                        </p>
                        {t.has_live_match ? <LivePill /> : null}
                      </div>
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        {[t.format, formatNZDate(t.held_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </TouchCard>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {step === "court" && tournament ? (
            <div className="flex flex-1 flex-col">
              <BackButton
                label="Change tournament"
                onClick={() => clearFrom("tournament")}
              />
              <div className="mt-4 mb-6">
                <h1 className="text-[18px] font-medium text-white">
                  Select court
                </h1>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {tournament.name} · which court is this tablet at?
                </p>
              </div>

              {loadingList ? (
                <div className="flex flex-1 items-center justify-center py-16">
                  <Loader2 className="size-7 animate-spin text-[#a78bfa]" />
                </div>
              ) : courts.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No courts configured for this tournament.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {courts.map((c) => (
                    <TouchCard key={c.id} onClick={() => selectCourt(c)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-medium text-white">
                          {c.name}
                        </p>
                        {c.occupied ? <InUsePill /> : null}
                      </div>
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        {c.occupied
                          ? `Match in progress: ${c.current_matchup}`
                          : "Free"}
                      </p>
                    </TouchCard>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {step === "ref" && tournament && court ? (
            <div className="flex flex-1 flex-col">
              <BackButton
                label="Change court"
                onClick={() => clearFrom("court")}
              />
              <div className="mt-4 mb-6">
                <h1 className="text-[18px] font-medium text-white">
                  Who&apos;s refereeing this court?
                </h1>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {tournament.name} · {court.name} · select yourself
                </p>
              </div>

              {loadingList ? (
                <div className="flex flex-1 items-center justify-center py-16">
                  <Loader2 className="size-7 animate-spin text-[#a78bfa]" />
                </div>
              ) : refs.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No referees available. Assign Admin / Ops / Referee roles
                  first.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {refs.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => selectRef(r)}
                      className="flex min-h-14 w-full items-center rounded-[10px] px-4 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/60"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <span className="text-[15px] font-medium text-white">
                        {r.display_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {step === "match" && tournament && court && refPlayer ? (
            <div className="flex flex-1 flex-col">
              <header
                className="flex items-start justify-between gap-3 pb-4"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-white">
                    {tournament.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {court.name} · {refPlayer.display_name}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 shrink-0 text-muted-foreground hover:text-white"
                    >
                      Change
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => clearFrom("tournament")}
                    >
                      Change tournament
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearFrom("court")}>
                      Change court
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => clearFrom("ref")}>
                      Change ref
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                          style={{
                            background: "rgba(255,255,255,0.06)",
                          }}
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
                      Scoring coming next step
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
                      <Radio className="relative size-7 text-[#a78bfa]" />
                    </div>
                    <p className="text-[18px] font-medium text-white">
                      No match yet
                    </p>
                    <p className="mt-2 max-w-sm text-[13px] text-muted-foreground">
                      Waiting for a match to be assigned to {court.name}.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </TooltipProvider>
  );
}
