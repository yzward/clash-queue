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
                <p className="truncate text-sm font-medium text-white">
                  {tournament.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatNZDate(tournament.held_at)}
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
