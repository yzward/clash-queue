/**
 * Challonge API v2.1 client
 *
 * Verified 2026-07-24 against Open Division Test (url: nl7udlbm / id: 18249513):
 * - Auth: Authorization: <v1 key> + Authorization-Type: v1 works (no Bearer prefix)
 * - Content-Type: application/vnd.api+json, Accept: application/json required
 * - Responses are JSON:API: { data: { id, type, attributes, relationships } }
 *   or { data: [ ... ] } for collections
 * - Tournament `state` observed: "group_stages_underway" (not only "underway"/"complete")
 * - Group stages live under attributes.group_stage_options
 *   ({ group_size, participant_count_to_advance_per_group, stage_type, ... })
 * - Participant ids are strings in data.id; attributes include name, seed, misc
 * - Match player ids live in relationships.player1/player2.data.id (not attributes)
 * - URL slug (nl7udlbm) and numeric id both work in /tournaments/{id}.json paths
 *
 * Write shapes (2026-07-25, from Challonge v2.1 OpenAPI / Apidog; live POST
 * verification blocked locally because CHALLONGE_API_KEY is Sensitive on Vercel
 * and `vercel env pull` returns an empty placeholder):
 * - POST /tournaments/{id}/participants.json
 *   body: { data: { type: "participant", attributes: { name, seed?, misc? } } }
 * - POST /tournaments/{id}/participants/bulk_add.json
 *   body: { data: { type: "Participants", attributes: { participants: [{ name, ... }] } } }
 *   max 20 per request
 */

import type {
  ChallongeMatch,
  ChallongeParticipant,
  ChallongeTournament,
  ChallongeGroupStageOptions,
} from "@/lib/challonge/types";

const BASE_URL = "https://api.challonge.com/v2.1";
const TIMEOUT_MS = 10_000;

export class ChallongeError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ChallongeError";
    this.status = status;
    this.body = body ?? null;
  }
}

export class ChallongePushError extends Error {
  readonly code = "CHALLONGE_PUSH_ERROR" as const;
  status: number;
  body: unknown;

  constructor(message: string, status = 400, body?: unknown) {
    super(message);
    this.name = "ChallongePushError";
    this.status = status;
    this.body = body ?? null;
  }
}

/** Bracket states where Challonge rejects new participants. */
export const CHALLONGE_PUSH_BLOCKED_STATES = new Set([
  "underway",
  "group_stages_underway",
  "complete",
]);

type JsonApiResource = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    {
      data?: { id?: string; type?: string } | { id?: string; type?: string }[] | null;
      links?: { related?: string; meta?: { count?: number } };
      meta?: { count?: number };
    }
  >;
};

type JsonApiDocument = {
  data?: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  errors?: Array<{ detail?: string; title?: string; status?: string }>;
};

export type ChallongeParticipantInput = {
  name: string;
  seed?: number;
  misc?: string;
};

export type ChallongePushedParticipant = {
  id: string;
  name: string;
  seed: number | null;
};

function getApiKey(): string {
  const key = process.env.CHALLONGE_API_KEY;
  if (!key) {
    throw new ChallongeError(
      500,
      "Missing CHALLONGE_API_KEY. Set it in .env.local."
    );
  }
  return key;
}

export async function challongeRequest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: getApiKey(),
        "Authorization-Type": "v1",
        "Content-Type": "application/vnd.api+json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const doc = body as JsonApiDocument | null;
      const apiMessage =
        doc?.errors?.[0]?.detail ||
        doc?.errors?.[0]?.title ||
        (typeof body === "string" ? body.slice(0, 200) : null) ||
        response.statusText;

      throw new ChallongeError(
        response.status,
        `Challonge ${response.status}: ${apiMessage}`,
        body
      );
    }

    return body as T;
  } catch (error) {
    if (error instanceof ChallongeError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ChallongeError(408, "Challonge request timed out after 10s");
    }
    throw new ChallongeError(
      0,
      error instanceof Error ? error.message : "Challonge request failed"
    );
  } finally {
    clearTimeout(timeout);
  }
}

function relationshipCount(
  resource: JsonApiResource,
  key: string
): number | null {
  const rel = resource.relationships?.[key];
  if (!rel) return null;
  if (typeof rel.links?.meta?.count === "number") return rel.links.meta.count;
  if (typeof rel.meta?.count === "number") return rel.meta.count;
  if (Array.isArray(rel.data)) return rel.data.length;
  return null;
}

function relationshipId(
  resource: JsonApiResource,
  key: string
): string | null {
  const data = resource.relationships?.[key]?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ? String(data.id) : null;
}

function normaliseTournament(resource: JsonApiResource): ChallongeTournament {
  const attrs = resource.attributes ?? {};
  const timestamps = (attrs.timestamps ?? {}) as Record<string, unknown>;
  const groupOpts = attrs.group_stage_options as
    | ChallongeGroupStageOptions
    | null
    | undefined;

  const matchesCount =
    relationshipCount(resource, "matches") ??
    (typeof attrs.matches_count === "number" ? attrs.matches_count : 0);

  return {
    id: String(resource.id ?? ""),
    name: String(attrs.name ?? ""),
    url: String(attrs.url ?? ""),
    state: String(attrs.state ?? "pending"),
    tournament_type: String(attrs.tournament_type ?? ""),
    participants_count:
      typeof attrs.participants_count === "number"
        ? attrs.participants_count
        : (relationshipCount(resource, "participants") ?? 0),
    matches_count: matchesCount ?? 0,
    full_challonge_url:
      typeof attrs.full_challonge_url === "string"
        ? attrs.full_challonge_url
        : null,
    group_stage_enabled: Boolean(attrs.group_stage_enabled),
    group_stage_options: groupOpts ?? null,
    starts_at:
      typeof attrs.starts_at === "string"
        ? attrs.starts_at
        : typeof timestamps.starts_at === "string"
          ? timestamps.starts_at
          : null,
    started_at:
      typeof timestamps.started_at === "string" ? timestamps.started_at : null,
    completed_at:
      typeof timestamps.completed_at === "string"
        ? timestamps.completed_at
        : null,
  };
}

function normaliseParticipant(
  resource: JsonApiResource
): ChallongeParticipant {
  const attrs = resource.attributes ?? {};
  const states = (attrs.states ?? {}) as Record<string, unknown>;

  return {
    id: String(resource.id ?? ""),
    name: String(attrs.name ?? ""),
    seed: typeof attrs.seed === "number" ? attrs.seed : null,
    misc: typeof attrs.misc === "string" ? attrs.misc : attrs.misc == null ? null : String(attrs.misc),
    username: typeof attrs.username === "string" ? attrs.username : null,
    final_rank: typeof attrs.final_rank === "number" ? attrs.final_rank : null,
    group_id: typeof attrs.group_id === "number" ? attrs.group_id : null,
    tournament_id:
      typeof attrs.tournament_id === "number" ? attrs.tournament_id : null,
    active: typeof states.active === "boolean" ? states.active : null,
  };
}

function normaliseMatch(resource: JsonApiResource): ChallongeMatch {
  const attrs = resource.attributes ?? {};
  const timestamps = (attrs.timestamps ?? {}) as Record<string, unknown>;

  return {
    id: String(resource.id ?? ""),
    state: String(attrs.state ?? ""),
    round: typeof attrs.round === "number" ? attrs.round : null,
    identifier: typeof attrs.identifier === "string" ? attrs.identifier : null,
    scores: typeof attrs.scores === "string" ? attrs.scores : null,
    suggested_play_order:
      typeof attrs.suggested_play_order === "number"
        ? attrs.suggested_play_order
        : null,
    winner_id:
      attrs.winner_id == null ? null : String(attrs.winner_id),
    player1_id: relationshipId(resource, "player1"),
    player2_id: relationshipId(resource, "player2"),
    underway_at:
      typeof timestamps.underway_at === "string"
        ? timestamps.underway_at
        : null,
    started_at:
      typeof timestamps.started_at === "string" ? timestamps.started_at : null,
  };
}

export async function getChallongeTournament(
  id: string
): Promise<ChallongeTournament> {
  const doc = await challongeRequest<JsonApiDocument>(
    `/tournaments/${encodeURIComponent(id)}.json`
  );

  if (!doc.data || Array.isArray(doc.data)) {
    throw new ChallongeError(404, `Tournament ${id} not found in Challonge response`);
  }

  return normaliseTournament(doc.data);
}

export async function getChallongeParticipants(
  id: string
): Promise<ChallongeParticipant[]> {
  const doc = await challongeRequest<JsonApiDocument>(
    `/tournaments/${encodeURIComponent(id)}/participants.json`
  );

  const rows = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
  return rows.map(normaliseParticipant);
}

export async function getChallongeMatches(
  id: string
): Promise<ChallongeMatch[]> {
  const doc = await challongeRequest<JsonApiDocument>(
    `/tournaments/${encodeURIComponent(id)}/matches.json`
  );

  const rows = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
  return rows.map(normaliseMatch);
}

function flattenPushedParticipant(
  resource: JsonApiResource
): ChallongePushedParticipant {
  const attrs = resource.attributes ?? {};
  return {
    id: String(resource.id ?? ""),
    name: String(attrs.name ?? ""),
    seed: typeof attrs.seed === "number" ? attrs.seed : null,
  };
}

function extractPushErrorMessage(err: unknown): string {
  if (err instanceof ChallongeError) {
    const doc = err.body as JsonApiDocument | null;
    const detail =
      doc?.errors?.[0]?.detail ||
      doc?.errors?.[0]?.title ||
      err.message.replace(/^Challonge \d+:\s*/, "");
    return detail || "Challonge rejected the participant";
  }
  if (err instanceof Error) return err.message;
  return "Challonge push failed";
}

/**
 * Create a single Challonge participant.
 * Body shape: { data: { type: "participant", attributes: { name, seed?, misc? } } }
 * (v2.1 Create Participant OpenAPI default type is singular "participant".)
 */
export async function pushParticipant(
  challongeId: string,
  participant: ChallongeParticipantInput
): Promise<ChallongePushedParticipant> {
  const attributes: Record<string, unknown> = {
    name: participant.name,
  };
  if (participant.seed != null) attributes.seed = participant.seed;
  if (participant.misc != null) attributes.misc = participant.misc;

  try {
    const doc = await challongeRequest<JsonApiDocument>(
      `/tournaments/${encodeURIComponent(challongeId)}/participants.json`,
      {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "participant",
            attributes,
          },
        }),
      }
    );

    if (!doc.data || Array.isArray(doc.data)) {
      console.error("[challonge:push] unexpected create response", doc);
      throw new ChallongePushError(
        "Challonge returned an unexpected participant response"
      );
    }

    const created = flattenPushedParticipant(doc.data);
    if (!created.id) {
      throw new ChallongePushError("Challonge did not return a participant id");
    }
    return created;
  } catch (err) {
    if (err instanceof ChallongePushError) throw err;
    console.error("[challonge:push]", err);
    if (err instanceof ChallongeError && err.status >= 400 && err.status < 500) {
      throw new ChallongePushError(
        extractPushErrorMessage(err),
        err.status,
        err.body
      );
    }
    throw err;
  }
}

/**
 * Bulk-create Challonge participants.
 *
 * Endpoint (v2.1 OpenAPI): POST /tournaments/{id}/participants/bulk_add.json
 * Body: { data: { type: "Participants", attributes: { participants: [{ name, seed?, misc? }] } } }
 * Max 20 participants per request.
 *
 * Live bulk verification was not possible locally (Sensitive env key not pullable via
 * `vercel env pull`). This function only calls the bulk endpoint — callers that need
 * per-entrant failure isolation should fall back to sequential `pushParticipant`
 * with a 100ms delay (same reliability preference CSP used for v1 sync-out).
 */
export async function pushParticipantsBulk(
  challongeId: string,
  participants: ChallongeParticipantInput[]
): Promise<ChallongePushedParticipant[]> {
  if (participants.length === 0) return [];

  const created: ChallongePushedParticipant[] = [];

  for (let i = 0; i < participants.length; i += 20) {
    const chunk = participants.slice(i, i + 20);

    try {
      const doc = await challongeRequest<JsonApiDocument>(
        `/tournaments/${encodeURIComponent(challongeId)}/participants/bulk_add.json`,
        {
          method: "POST",
          body: JSON.stringify({
            data: {
              type: "Participants",
              attributes: {
                participants: chunk.map((p) => {
                  const row: Record<string, unknown> = { name: p.name };
                  if (p.seed != null) row.seed = p.seed;
                  if (p.misc != null) row.misc = p.misc;
                  return row;
                }),
              },
            },
          }),
        }
      );

      const rows = Array.isArray(doc.data)
        ? doc.data
        : doc.data
          ? [doc.data]
          : [];

      if (rows.length === 0) {
        throw new ChallongePushError(
          "Challonge bulk_add returned no participants"
        );
      }

      for (const row of rows) {
        created.push(flattenPushedParticipant(row));
      }
    } catch (err) {
      console.error("[challonge:push] bulk_add failed", err);
      if (err instanceof ChallongePushError) throw err;
      if (err instanceof ChallongeError && err.status >= 400 && err.status < 500) {
        throw new ChallongePushError(
          extractPushErrorMessage(err),
          err.status,
          err.body
        );
      }
      throw err;
    }
  }

  return created;
}
