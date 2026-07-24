import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrCreatePlayerForImport } from "@/lib/data/entrants";

export class HumanitixConfigError extends Error {
  readonly code = "HUMANITIX_API_KEY_MISSING" as const;

  constructor(
    message = "Humanitix API key not configured - contact Armani."
  ) {
    super(message);
    this.name = "HumanitixConfigError";
  }
}

export class HumanitixResponseError extends Error {
  readonly code = "HUMANITIX_UNEXPECTED_RESPONSE" as const;

  constructor(
    message = "Humanitix API response unexpected - check logs"
  ) {
    super(message);
    this.name = "HumanitixResponseError";
  }
}

export type HumanitixTicket = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  ticketStatus: string | null;
};

export type HumanitixImportResult = {
  added: number;
  skipped: number;
  errors: string[];
};

const HUMANITIX_API_BASE = "https://api.humanitix.com/v1";

const SUCCESS_STATUSES = new Set([
  "complete",
  "completed",
  "active",
  "paid",
  "checked_in",
  "valid",
]);

function requireApiKey(): string {
  const key = process.env.HUMANITIX_API_KEY;
  if (!key) {
    throw new HumanitixConfigError();
  }
  return key;
}

function isSuccessfulTicket(ticket: Record<string, unknown>): boolean {
  const status = (
    ticket.ticketStatus ??
    ticket.status ??
    ticket.ticket_status ??
    ""
  )
    .toString()
    .toLowerCase()
    .trim();

  // If Humanitix omits status, treat as successful (matches CSP sync behaviour).
  if (!status) return true;
  return SUCCESS_STATUSES.has(status);
}

function mapTicket(raw: Record<string, unknown>): HumanitixTicket | null {
  const id = (raw.id ?? raw._id ?? raw.ticketId ?? raw.ticket_id) as
    | string
    | undefined;
  if (!id) return null;

  const firstName =
    (raw.firstName as string | null) ??
    (raw.first_name as string | null) ??
    null;
  const lastName =
    (raw.lastName as string | null) ??
    (raw.last_name as string | null) ??
    null;
  const email =
    ((raw.order as { email?: string } | undefined)?.email as string | null) ??
    (raw.email as string | null) ??
    (raw.buyerEmail as string | null) ??
    null;
  const ticketStatus =
    (raw.ticketStatus as string | null) ??
    (raw.status as string | null) ??
    (raw.ticket_status as string | null) ??
    null;

  return { id: String(id), firstName, lastName, email, ticketStatus };
}

/**
 * Fetch tickets for a Humanitix event.
 * Auth uses `x-api-key` (same as CSP's working client), not Bearer Authorization.
 */
export async function fetchEventTickets(
  humanitixEventId: string
): Promise<HumanitixTicket[]> {
  const apiKey = requireApiKey();
  const slug = humanitixEventId.split("/").filter(Boolean).pop();
  if (!slug) {
    throw new Error("Invalid Humanitix event ID");
  }

  const res = await fetch(
    `${HUMANITIX_API_BASE}/events/${encodeURIComponent(slug)}/tickets?page=1`,
    {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.error("[humanitix] non-JSON response", text.slice(0, 500));
    throw new HumanitixResponseError();
  }

  if (!res.ok) {
    console.error("[humanitix] API error", res.status, json);
    throw new Error(`Humanitix API error: ${res.status}`);
  }

  const body = json as Record<string, unknown>;
  const rawTickets = body.tickets ?? body.data ?? body;
  if (!Array.isArray(rawTickets)) {
    console.error("[humanitix] unexpected response shape", json);
    throw new HumanitixResponseError();
  }

  const tickets: HumanitixTicket[] = [];
  for (const item of rawTickets) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!isSuccessfulTicket(row)) continue;
    const mapped = mapTicket(row);
    if (mapped) tickets.push(mapped);
  }

  return tickets;
}

export async function importFromHumanitix(
  tournamentId: string,
  humanitixEventId: string
): Promise<HumanitixImportResult> {
  requireApiKey();

  const admin = createAdminClient();
  const result: HumanitixImportResult = { added: 0, skipped: 0, errors: [] };

  let tickets: HumanitixTicket[];
  try {
    tickets = await fetchEventTickets(humanitixEventId);
  } catch (err) {
    if (
      err instanceof HumanitixConfigError ||
      err instanceof HumanitixResponseError
    ) {
      throw err;
    }
    throw err;
  }

  for (const ticket of tickets) {
    try {
      const displayName = [ticket.firstName, ticket.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (!displayName && !ticket.email) {
        result.skipped++;
        result.errors.push(`Ticket ${ticket.id}: missing name and email`);
        continue;
      }

      const nameForPlayer = displayName || ticket.email!.split("@")[0];
      const { id: playerId } = await resolveOrCreatePlayerForImport(
        nameForPlayer,
        ticket.email
      );

      const { data: existing } = await admin
        .from("tournament_entrants")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("player_id", playerId)
        .maybeSingle();

      if (existing) {
        result.skipped++;
        continue;
      }

      const now = new Date().toISOString();
      const { error } = await admin.from("tournament_entrants").insert({
        tournament_id: tournamentId,
        player_id: playerId,
        entrant_status: "confirmed",
        status: "registered",
        confirmed_at: now,
        registration_source: "humanitix",
        humanitix_ticket_id: ticket.id,
      });

      if (error) {
        if (error.code === "23505") {
          result.skipped++;
          continue;
        }
        result.errors.push(`Ticket ${ticket.id}: ${error.message}`);
        continue;
      }

      result.added++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Ticket ${ticket.id}: ${message}`);
    }
  }

  return result;
}
