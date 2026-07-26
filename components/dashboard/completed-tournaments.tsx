"use client";

import Link from "next/link";
import { useState } from "react";

import type { DashboardTournament } from "@/lib/data/tournaments";
import { formatNZDate } from "@/lib/utils/dates";

export function CompletedTournaments({
  tournaments,
}: {
  tournaments: DashboardTournament[];
}) {
  const [open, setOpen] = useState(false);

  if (tournaments.length === 0) return null;

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <span
          className="inline-block text-[10px] transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        Completed ({tournaments.length})
      </button>

      {open ? (
        <ul className="mt-3 divide-y divide-border">
          {tournaments.map((tournament) => (
            <li
              key={tournament.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium text-white">
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
                <p className="text-xs text-muted-foreground">
                  {formatNZDate(tournament.held_at)}
                  {" · "}
                  {tournament.is_ranking_tournament ? "Ranked" : "Casual"}
                </p>
              </div>
              <Link
                href={`/t/${tournament.id}`}
                className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                View →
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
