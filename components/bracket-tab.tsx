"use client";

import { ExternalLink, GitBranch } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getChallongeViewerUrls } from "@/lib/challonge/client";

type BracketTournament = {
  id: string;
  name: string;
  challonge_id: string | null;
};

export function BracketTab({
  tournament,
}: {
  tournament: BracketTournament;
}) {
  const challongeId = tournament.challonge_id?.trim() || null;

  if (!challongeId) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-[10px] px-6 py-16 text-center"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          className="mb-4 flex size-12 items-center justify-center rounded-full"
          style={{ background: "rgba(167,139,250,0.12)" }}
        >
          <GitBranch className="size-5 text-[#a78bfa]" />
        </div>
        <h2 className="text-base font-medium text-white">No bracket linked</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Link a Challonge bracket in Settings to see the bracket structure
          here.
        </p>
        <Button
          asChild
          className="mt-5 bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
        >
          <Link href={`/t/${tournament.id}?tab=settings`}>Go to Settings</Link>
        </Button>
      </div>
    );
  }

  const { publicUrl, embedUrl } = getChallongeViewerUrls(challongeId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-white">Bracket</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live bracket embedded from Challonge. Actions like reporting scores
            must be done through Clash Queue (Arena), not the embed.
          </p>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-white"
        >
          <a href={publicUrl} target="_blank" rel="noopener noreferrer">
            Open on Challonge
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>

      <div
        className="w-full overflow-hidden rounded-[10px]"
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          minHeight: 700,
          aspectRatio: "16 / 10",
          background: "#ffffff",
        }}
      >
        <iframe
          src={embedUrl}
          title="Challonge bracket embed"
          loading="lazy"
          className="h-full min-h-[700px] w-full border-0"
          style={{ minHeight: 700 }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Bracket rendered by Challonge. For issues with the embed, use the
        external link above.
      </p>
    </div>
  );
}
