import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CompletedTournaments } from "@/components/dashboard/completed-tournaments";
import { Button } from "@/components/ui/button";
import { requireTO } from "@/lib/auth/require-to";
import {
  getTournamentsForDashboard,
  type DashboardTournament,
} from "@/lib/data/tournaments";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatNZDate, getNZTimeOfDay } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

function firstNameFromDisplayName(displayName: string | null | undefined) {
  const first = displayName?.trim().split(/\s+/)[0];
  return first || "there";
}

function rankingLabel(tournament: DashboardTournament) {
  return tournament.is_ranking_tournament ? "Ranked" : "Casual";
}

function NewTournamentButton({ className }: { className?: string }) {
  return (
    <Link
      href="/tournaments/new"
      className={cn(
        "inline-flex items-center justify-center bg-white px-3.5 py-2 text-sm font-semibold text-[#0a0a12] transition-opacity hover:opacity-90",
        className
      )}
      style={{ clipPath: LOGO_CLIP }}
    >
      + New tournament
    </Link>
  );
}

function TournamentCard({
  tournament,
  variant,
}: {
  tournament: DashboardTournament;
  variant: "live" | "setup";
}) {
  const isLive = variant === "live";

  return (
    <div
      className="flex items-center gap-3 rounded-lg px-3.5 py-3 sm:gap-4"
      style={
        isLive
          ? {
              background: "rgba(34,197,94,0.05)",
              border: "1px solid rgba(34,197,94,0.2)",
              borderLeft: "3px solid #22c55e",
            }
          : {
              background: "rgba(251,191,36,0.04)",
              border: "1px solid rgba(251,191,36,0.15)",
            }
      }
    >
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
        style={
          isLive
            ? {
                background: "rgba(34,197,94,0.15)",
                color: "#86efac",
              }
            : {
                background: "rgba(251,191,36,0.12)",
                color: "#fcd34d",
              }
        }
      >
        {isLive ? (
          <span
            className="size-[5px] rounded-full"
            style={{ background: "#22c55e" }}
          />
        ) : null}
        {isLive ? "Live" : "Setup"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13px] font-medium text-white sm:text-sm">
            {tournament.name}
          </p>
          {tournament.is_major_event ? (
            <span
              className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
              style={{
                background: "rgba(251,191,36,0.15)",
                color: "#fcd34d",
                border: "1px solid rgba(251,191,36,0.3)",
              }}
            >
              Major
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {formatNZDate(tournament.held_at)} · {rankingLabel(tournament)}
        </p>
      </div>

      {isLive ? (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="shrink-0 border border-[#22c55e]/40 text-[#86efac] hover:bg-[#22c55e]/10 hover:text-[#86efac]"
        >
          <Link href={`/t/${tournament.id}`}>Open →</Link>
        </Button>
      ) : (
        <Link
          href={`/t/${tournament.id}`}
          className="shrink-0 text-sm font-medium text-[#fbbf24] transition-opacity hover:opacity-80"
        >
          Open →
        </Link>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const auth = await requireTO();

  if (!auth.authorised) {
    if (auth.reason === "no_session") {
      redirect("/login");
    }
    redirect("/not-authorised");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "";

  const admin = createAdminClient();
  const { data: player } = await admin
    .from("players")
    .select("display_name")
    .eq("id", auth.playerId)
    .maybeSingle();

  const { live, setup, completed } = await getTournamentsForDashboard();
  const timeOfDay = getNZTimeOfDay();
  const firstName = firstNameFromDisplayName(player?.display_name);
  const hasAttention = live.length > 0 || setup.length > 0;
  const isEmpty =
    live.length === 0 && setup.length === 0 && completed.length === 0;

  return (
    <AppShell email={email}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Good {timeOfDay}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {live.length} live · {setup.length} in setup · {completed.length}{" "}
            completed
          </p>
        </div>
        {!isEmpty ? <NewTournamentButton className="mt-3 sm:mt-0" /> : null}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <p className="text-muted-foreground">No tournaments yet</p>
          <NewTournamentButton />
        </div>
      ) : (
        <>
          {hasAttention ? (
            <section className="mt-8">
              <p
                className="mb-3 font-semibold uppercase"
                style={{
                  color: "#f97316",
                  fontSize: "11px",
                  letterSpacing: "0.12em",
                }}
              >
                ◆ Needs attention
              </p>

              <div className="flex flex-col gap-2.5">
                {live.map((tournament) => (
                  <TournamentCard
                    key={tournament.id}
                    tournament={tournament}
                    variant="live"
                  />
                ))}
                {setup.map((tournament) => (
                  <TournamentCard
                    key={tournament.id}
                    tournament={tournament}
                    variant="setup"
                  />
                ))}
              </div>
            </section>
          ) : null}

          <CompletedTournaments tournaments={completed} />
        </>
      )}
    </AppShell>
  );
}
