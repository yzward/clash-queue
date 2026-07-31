import { AlertTriangle } from "lucide-react";

import type { PreflightCheck } from "@/lib/preflight/checks";

export function LiveWithFailingChecksWarning({
  failingChecks,
}: {
  failingChecks: PreflightCheck[];
}) {
  const n = failingChecks.length;
  const checkWord = n === 1 ? "check" : "checks";
  const needWord = n === 1 ? "needs" : "need";

  return (
    <div
      className="flex gap-3 rounded-[10px] px-4 py-3.5"
      style={{
        background: "rgba(239,68,68,0.05)",
        border: "1px solid rgba(239,68,68,0.25)",
        borderLeft: "3px solid #ef4444",
      }}
    >
      <AlertTriangle
        className="mt-0.5 shrink-0"
        style={{ color: "#ef4444", width: 20, height: 20 }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-white">
          This tournament is live but setup is incomplete
        </p>
        <p
          className="mt-1 text-[11px] leading-relaxed"
          style={{ color: "rgba(255,255,255,0.7)" }}
        >
          It&apos;s marked live, but {n} setup {checkWord} still {needWord}{" "}
          attention. Scoring may fail or produce inconsistent results until
          resolved.
        </p>
        {n > 0 ? (
          <ul className="mt-2.5 space-y-0">
            {failingChecks.map((check) => (
              <li
                key={check.id}
                className="py-2"
                style={{ borderTop: "1px solid rgba(239,68,68,0.12)" }}
              >
                <p className="text-[12px] font-medium text-white">
                  {check.title}
                </p>
                {check.detail ? (
                  <p
                    className="mt-0.5 text-[10px]"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                  >
                    {check.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
