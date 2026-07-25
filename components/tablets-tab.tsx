"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Court } from "@/lib/data/courts";

const FALLBACK_ORIGIN = "https://queue.clash.co.nz";

type TabletsTabProps = {
  initialCourts: Court[];
  tournament: { id: string; name: string };
};

function displayHostPath(origin: string, courtId: string): string {
  try {
    const host = new URL(origin).host;
    return `${host}/tablet/${courtId}`;
  } catch {
    return `queue.clash.co.nz/tablet/${courtId}`;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const input = document.createElement("input");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

export function TabletsTab({ initialCourts, tournament }: TabletsTabProps) {
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  if (initialCourts.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-[10px] px-6 py-16 text-center"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <p className="max-w-sm text-sm text-muted-foreground">
          No courts configured yet — add courts in the Courts tab before
          setting up tablets.
        </p>
        <Button
          asChild
          className="mt-5 bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
        >
          <Link href={`/t/${tournament.id}?tab=courts`}>Go to Courts</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-white">Tablet URLs</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Point each court&apos;s tablet at its unique URL below. The tablet
          will pick up matches assigned to that court automatically.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {initialCourts.map((court) => {
          const fullUrl = `${origin}/tablet/${court.id}`;
          const displayUrl = displayHostPath(origin, court.id);

          return (
            <li
              key={court.id}
              className="flex flex-col gap-2 rounded-lg px-3 py-3 sm:flex-row sm:items-center sm:gap-3"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <p className="shrink-0 text-[13px] font-medium text-white sm:w-36">
                {court.name}
              </p>
              <p className="min-w-0 flex-1 break-all font-mono text-[11px] text-muted-foreground sm:text-xs">
                {displayUrl}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-white"
                  onClick={async () => {
                    const ok = await copyText(fullUrl);
                    if (ok) {
                      toast.success(`Copied ${court.name} tablet URL`);
                    } else {
                      toast.error("Copy this URL manually", {
                        description: fullUrl,
                      });
                    }
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-white"
                >
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${court.name} tablet URL`}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
