import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { FizzyCardSnapshot } from "./types";

export const CURRENT_FIZZY_CARD_ENTRY = "fizzy-current-card";

export interface ActiveFizzyCardState {
  accountSlug: string;
  cardId: string;
  cardNumber: number;
  fetchedAt: string;
  mode?: "build" | "load" | "plan";
  sourceUrl: string;
  title: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const normalizeActiveFizzyCardState = (
  value: unknown,
): ActiveFizzyCardState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const sourceUrl = typeof value.sourceUrl === "string" ? value.sourceUrl.trim() : "";
  const accountSlug = typeof value.accountSlug === "string"
    ? value.accountSlug.trim()
    : "";
  const cardId = typeof value.cardId === "string" ? value.cardId.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const fetchedAt = typeof value.fetchedAt === "string"
    ? value.fetchedAt.trim()
    : "";
  const cardNumber = typeof value.cardNumber === "number"
    ? value.cardNumber
    : Number.parseInt(String(value.cardNumber ?? ""), 10);
  const mode = value.mode === "build" || value.mode === "load" || value.mode === "plan"
    ? value.mode
    : undefined;

  if (!sourceUrl || !accountSlug || !cardId || !title || !fetchedAt) {
    return null;
  }

  if (!Number.isFinite(cardNumber)) {
    return null;
  }

  return {
    accountSlug,
    cardId,
    cardNumber,
    fetchedAt,
    mode,
    sourceUrl,
    title,
  };
};

export const buildActiveFizzyCardState = (
  snapshot: FizzyCardSnapshot,
  mode?: "build" | "load" | "plan",
): ActiveFizzyCardState => {
  const url = new URL(snapshot.sourceUrl);
  const accountSlug = url.pathname.split("/")[1] || "";

  return {
    accountSlug,
    cardId: snapshot.card.id,
    cardNumber: snapshot.card.number,
    fetchedAt: snapshot.fetchedAt,
    mode,
    sourceUrl: snapshot.sourceUrl,
    title: snapshot.card.title,
  };
};

export const persistActiveFizzyCard = (
  pi: ExtensionAPI,
  snapshot: FizzyCardSnapshot,
  mode?: "build" | "load" | "plan",
): ActiveFizzyCardState => {
  const state = buildActiveFizzyCardState(snapshot, mode);
  pi.appendEntry<ActiveFizzyCardState>(CURRENT_FIZZY_CARD_ENTRY, state);
  return state;
};

export const restoreActiveFizzyCard = (
  ctx: ExtensionContext,
): ActiveFizzyCardState | null => {
  const entries = ctx.sessionManager.getBranch();
  let state: ActiveFizzyCardState | null = null;

  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== CURRENT_FIZZY_CARD_ENTRY) {
      continue;
    }

    const candidate = normalizeActiveFizzyCardState(entry.data);
    if (candidate) {
      state = candidate;
    }
  }

  return state;
};
