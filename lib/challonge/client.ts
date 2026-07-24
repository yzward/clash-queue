/**
 * Challonge API v2.1 client
 *
 * Verified 2026-07-24 against Open Division Test (url: nl7udlbm / id: 18249513):
 * - Auth: Authorization: <v1 key> + Authorization-Type: v1 works (no Bearer prefix)
 * - Content-Type: application/vnd.api+json, Accept: application/json required
 * - Responses are JSON:API: { data: { id, type, attributes, relationships } }
 *   or { data: [ ... ] } for collections
 * - Tournament `state` observed: "group_stages_underway" (not only "underway"/"complete")
 * - Group stages live under attributes.group_stage_enabled + attributes.group_stage_options
 *   ({ group_size, participant_count_to_advance_per_group, stage_type, ... })
 * - Participant ids are strings in data.id; attributes include name, seed, misc
 * - Match player ids live in relationships.player1/player2.data.id (not attributes)
 * - URL slug (nl7udlbm) and numeric id both work in /tournaments/{id}.json paths
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
