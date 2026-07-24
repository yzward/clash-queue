"use client";

import Link from "next/link";
import { useTransition } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";

import { refreshPreflight } from "@/app/t/[id]/actions";
import { Button } from "@/components/ui/button";
import type {
  PreflightCheck,
  PreflightResult,
} from "@/lib/preflight/checks";
import { cn } from "@/lib/utils";
import { useState } from "react";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

function ProgressRing({ percent }: { percent: number }) {
  const size = 44;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
        {percent}%
      </span>
    </div>
  );
}

function StatusIcon({ check }: { check: PreflightCheck }) {
  const base =
    "flex size-[18px] shrink-0 items-center justify-center rounded-full";

  if (check.status === "pass") {
    return (
      <span className={base} style={{ background: "rgba(34,197,94,0.2)" }}>
        <Check className="size-3" style={{ color: "#86efac" }} strokeWidth={3} />
      </span>
    );
  }

  if (check.severity === "amber") {
    return (
      <span className={base} style={{ background: "rgba(251,191,36,0.2)" }}>
        <AlertTriangle
          className="size-3"
          style={{ color: "#fbbf24" }}
          strokeWidth={2.5}
        />
      </span>
    );
  }

  return (
    <span className={base} style={{ background: "rgba(239,68,68,0.2)" }}>
      <X className="size-3" style={{ color: "#f87171" }} strokeWidth={3} />
    </span>
  );
}

function CheckFixButton({
  check,
}: {
  check: PreflightCheck;
}) {
  const action = check.fix_action;
  if (!action || check.status === "pass") return null;

  const isRed = check.severity === "red";
  const className = cn(
    "inline-flex h-6 items-center rounded-md px-2 text-[10px] font-semibold transition-opacity hover:opacity-90",
    isRed
      ? "bg-[#ef4444] text-white"
      : "border border-[#fbbf24]/50 bg-transparent text-[#fbbf24]"
  );

  if ("tab" in action) {
    return (
      <Link href={`?tab=${action.tab}`} className={className}>
        {action.label}
      </Link>
    );
  }

  if ("external" in action && action.external) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {action.label}
      </a>
    );
  }

  if ("action" in action) {
    // Stub — sync_participants server action comes later
    return (
      <button type="button" className={className} title="Coming soon" disabled>
        {action.label}
      </button>
    );
  }

  return null;
}

function rowBackground(check: PreflightCheck): string {
  if (check.status === "pass") return "rgba(34,197,94,0.06)";
  if (check.severity === "amber") return "rgba(251,191,36,0.06)";
  return "rgba(239,68,68,0.06)";
}

export function PreflightCard({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: PreflightResult;
}) {
  const [data, setData] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const passed = data.checks.filter((c) => c.status === "pass").length;
  const total = data.checks.length;
  const needingAction = total - passed;
  const percent = total === 0 ? 0 : Math.round((passed / total) * 100);

  function handleRefresh() {
    startTransition(async () => {
      const next = await refreshPreflight(tournamentId);
      setData(next);
    });
  }

  return (
    <div
      className="rounded-[10px] px-4 py-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-start gap-3">
        <ProgressRing percent={percent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-white">
              Pre-flight checklist
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleRefresh}
              disabled={isPending}
              aria-label="Refresh pre-flight checks"
              className="text-muted-foreground"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {passed} of {total} ready
            {needingAction > 0 ? ` · ${needingAction} need action` : ""}
          </p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-1.5">
        {data.checks.map((check) => (
          <li
            key={check.id}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
            style={{ background: rowBackground(check) }}
          >
            <StatusIcon check={check} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-white">{check.title}</p>
              {check.detail ? (
                <p className="text-[10px] text-muted-foreground">
                  {check.detail}
                </p>
              ) : null}
            </div>
            <CheckFixButton check={check} />
          </li>
        ))}
      </ul>

      <div
        className="mt-4 flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="text-xs text-muted-foreground">
          Complete all checks to unlock
        </p>
        <button
          type="button"
          disabled={!data.ready_to_start}
          title={data.ready_to_start ? "Coming soon" : undefined}
          className={cn(
            "inline-flex items-center justify-center px-4 py-2 text-sm font-semibold transition-opacity",
            data.ready_to_start
              ? "bg-[#a78bfa] text-[#0a0a12] hover:opacity-90"
              : "cursor-not-allowed text-[#a78bfa]/50"
          )}
          style={{
            clipPath: LOGO_CLIP,
            background: data.ready_to_start
              ? "#a78bfa"
              : "rgba(167,139,250,0.15)",
          }}
        >
          Start tournament →
        </button>
      </div>
    </div>
  );
}
