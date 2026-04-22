import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  loadFizzyAuthConfig,
  resolveConfiguredSecret,
} from "./auth";
import type {
  FizzyCard,
  FizzyCardReference,
  FizzyCardSnapshot,
  FizzyCloseResult,
  FizzyColumn,
  FizzyComment,
  FizzyCommentCreateResult,
  FizzyAssignResult,
  FizzyEnsureAssignedResult,
  FizzyEnsureDoingResult,
  FizzyMoveToColumnResult,
  FizzyUser,
} from "./types";

const MAX_COMMENTS = 40;
const LINK_HEADER_SEPARATOR = /,\s*(?=<)/;
const CARD_URL_PATTERN = /^\/(?<accountSlug>[^/]+)\/cards\/(?<cardNumber>\d+)(?:\/)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const ensureArray = <T>(value: unknown): T[] => {
  return Array.isArray(value) ? (value as T[]) : [];
};

export const parseFizzyCardUrl = (input: string): FizzyCardReference => {
  const value = input.trim();
  if (!value) {
    throw new Error("Missing Fizzy card URL.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Expected a full Fizzy card URL like https://app.fizzy.do/6182909/cards/89.");
  }

  const match = url.pathname.match(CARD_URL_PATTERN);
  if (!match?.groups?.accountSlug || !match.groups.cardNumber) {
    throw new Error("Expected a Fizzy card URL like https://app.fizzy.do/6182909/cards/89.");
  }

  return {
    accountSlug: match.groups.accountSlug,
    cardNumber: Number.parseInt(match.groups.cardNumber, 10),
    origin: url.origin,
    url: url.toString(),
  };
};

const createHeaders = (
  token: string,
  extraHeaders: HeadersInit = {},
): HeadersInit => {
  return {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    ...extraHeaders,
  };
};

const getNextPageUrl = (response: Response): string | null => {
  const linkHeader = response.headers.get("link");
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(LINK_HEADER_SEPARATOR)) {
    const match = part.match(/<([^>]+)>;\s*rel=\"([^\"]+)\"/);
    if (match?.[2] === "next") {
      return match[1];
    }
  }

  return null;
};

const parseJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from Fizzy but received: ${text.slice(0, 300)}`);
  }
};

const fetchJson = async (
  url: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<unknown> => {
  const response = await fetch(url, {
    headers,
    method: "GET",
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.trim() ? ` ${body.trim().slice(0, 300)}` : "";
    throw new Error(
      `Fizzy request failed (${response.status} ${response.statusText}) for ${url}.${detail}`,
    );
  }

  return parseJson(response);
};

const sendJson = async (
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  token: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> => {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: createHeaders(token, {
      "Content-Type": "application/json",
    }),
    method,
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = text.trim() ? ` ${text.trim().slice(0, 300)}` : "";
    throw new Error(
      `Fizzy request failed (${response.status} ${response.statusText}) for ${url}.${detail}`,
    );
  }

  return response;
};

const fetchPaginatedComments = async (
  url: string,
  headers: HeadersInit,
  signal?: AbortSignal,
  maxComments: number = MAX_COMMENTS,
): Promise<{ comments: FizzyComment[]; truncated: boolean }> => {
  const comments: FizzyComment[] = [];
  let nextUrl: string | null = url;
  let truncated = false;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers,
      method: "GET",
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body.trim() ? ` ${body.trim().slice(0, 300)}` : "";
      throw new Error(
        `Fizzy comments request failed (${response.status} ${response.statusText}) for ${nextUrl}.${detail}`,
      );
    }

    const payload = await parseJson(response);
    const page = ensureArray<FizzyComment>(payload);

    for (const comment of page) {
      comments.push(comment);
      if (comments.length >= maxComments) {
        truncated = true;
        return { comments, truncated };
      }
    }

    nextUrl = getNextPageUrl(response);
    if (nextUrl) {
      truncated = truncated || comments.length >= maxComments;
    }
  }

  return { comments, truncated };
};

const normalizeUser = (value: unknown): FizzyUser => {
  if (!isRecord(value)) {
    throw new Error("Fizzy user response was not an object.");
  }

  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";

  if (!id || !name) {
    throw new Error("Fizzy user response was missing id or name.");
  }

  return value as FizzyUser;
};

const normalizeColumn = (value: unknown): FizzyColumn => {
  if (!isRecord(value)) {
    throw new Error("Fizzy column response was not an object.");
  }

  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";

  if (!id || !name) {
    throw new Error("Fizzy column response was missing id or name.");
  }

  return value as FizzyColumn;
};

const normalizeCard = (value: unknown): FizzyCard => {
  if (!isRecord(value)) {
    throw new Error("Fizzy card response was not an object.");
  }

  const title = typeof value.title === "string" ? value.title : "Untitled";
  const url = typeof value.url === "string" ? value.url : "";
  const id = typeof value.id === "string" ? value.id : "";
  const number = typeof value.number === "number"
    ? value.number
    : Number.parseInt(String(value.number ?? ""), 10);

  if (!id || !Number.isFinite(number) || !url) {
    throw new Error("Fizzy card response was missing id, number, or url.");
  }

  return value as FizzyCard;
};

const resolveCardRequestContext = async (
  sourceUrl: string,
  pi: ExtensionAPI,
): Promise<{
  baseUrl: string;
  cardUrl: string;
  headers: HeadersInit;
  reference: FizzyCardReference;
  token: string;
}> => {
  const reference = parseFizzyCardUrl(sourceUrl);
  const auth = await loadFizzyAuthConfig();
  const token = await resolveConfiguredSecret(auth.key, pi);
  const baseUrl = auth.baseUrl ?? reference.origin;
  const cardUrl = `${baseUrl}/${reference.accountSlug}/cards/${reference.cardNumber}`;

  return {
    baseUrl,
    cardUrl,
    headers: createHeaders(token),
    reference,
    token,
  };
};

export const fetchFizzyCardSnapshot = async (
  sourceUrl: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyCardSnapshot> => {
  const { baseUrl, cardUrl, headers, reference } = await resolveCardRequestContext(
    sourceUrl,
    pi,
  );

  const rawCard = await fetchJson(cardUrl, headers, signal);
  const card = normalizeCard(rawCard);

  const commentsUrl = typeof card.comments_url === "string" && card.comments_url.length > 0
    ? card.comments_url
    : `${baseUrl}/${reference.accountSlug}/cards/${reference.cardNumber}/comments`;

  const { comments, truncated } = await fetchPaginatedComments(
    commentsUrl,
    headers,
    signal,
  );

  return {
    card,
    comments,
    commentsTruncated: truncated,
    fetchedAt: new Date().toISOString(),
    sourceUrl: reference.url,
  };
};

export const addFizzyComment = async (
  sourceUrl: string,
  body: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyCommentCreateResult> => {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    throw new Error("Comment body cannot be empty.");
  }

  const { cardUrl, reference, token } = await resolveCardRequestContext(sourceUrl, pi);
  const response = await sendJson(
    `${cardUrl}/comments`,
    "POST",
    token,
    { comment: { body: trimmedBody } },
    signal,
  );
  const payload = await parseJson(response);
  const comment = payload as FizzyComment;

  if (!isRecord(comment) || typeof comment.id !== "string") {
    throw new Error("Fizzy comment response was missing an id.");
  }

  return {
    comment,
    sourceUrl: reference.url,
  };
};

export const markFizzyCardDone = async (
  sourceUrl: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyCloseResult> => {
  const { cardUrl, reference, token } = await resolveCardRequestContext(sourceUrl, pi);
  await sendJson(cardUrl + "/closure", "POST", token, {}, signal);

  return {
    closedAt: new Date().toISOString(),
    sourceUrl: reference.url,
  };
};

export const moveFizzyCardToColumn = async (
  sourceUrl: string,
  columnName: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyMoveToColumnResult> => {
  const normalizedColumnName = columnName.trim();
  if (!normalizedColumnName) {
    throw new Error("Column name cannot be empty.");
  }

  const targetColumnKey = normalizedColumnName.toLowerCase();
  const isMaybeColumn = targetColumnKey === "maybe" || targetColumnKey === "maybe?";
  const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
  const currentColumnName = snapshot.card.column?.name?.trim().toLowerCase();

  if (isMaybeColumn) {
    if (!snapshot.card.column) {
      return {
        action: "already_in_column",
        column: { id: "maybe", name: "Maybe?" },
        sourceUrl: snapshot.sourceUrl,
      };
    }

    const { token } = await resolveCardRequestContext(sourceUrl, pi);
    await sendJson(`${snapshot.card.url}/triage`, "DELETE", token, {}, signal);

    return {
      action: "moved",
      column: { id: "maybe", name: "Maybe?" },
      sourceUrl: snapshot.sourceUrl,
    };
  }

  if (currentColumnName === targetColumnKey) {
    return {
      action: "already_in_column",
      column: snapshot.card.column as FizzyColumn,
      sourceUrl: snapshot.sourceUrl,
    };
  }

  const boardUrl = snapshot.card.board.url;
  if (!boardUrl) {
    throw new Error(
      `Fizzy card board URL was missing, so the card could not be moved to ${normalizedColumnName}.`,
    );
  }

  const { token } = await resolveCardRequestContext(sourceUrl, pi);
  const columnsPayload = await fetchJson(`${boardUrl}/columns`, createHeaders(token), signal);
  const columns = ensureArray<unknown>(columnsPayload).map((column) => normalizeColumn(column));
  let targetColumn = columns.find(
    (column) => column.name.trim().toLowerCase() === targetColumnKey,
  );
  let action: FizzyMoveToColumnResult["action"] = "moved";

  if (!targetColumn) {
    const createdResponse = await sendJson(
      `${boardUrl}/columns`,
      "POST",
      token,
      { column: { name: normalizedColumnName } },
      signal,
    );
    targetColumn = normalizeColumn(await parseJson(createdResponse));
    action = "created_and_moved";
  }

  await sendJson(
    `${snapshot.card.url}/triage`,
    "POST",
    token,
    { column_id: targetColumn.id },
    signal,
  );

  return {
    action,
    column: targetColumn,
    sourceUrl: snapshot.sourceUrl,
  };
};

export const ensureFizzyCardInDoing = async (
  sourceUrl: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyEnsureDoingResult> => {
  const result = await moveFizzyCardToColumn(sourceUrl, "Doing", pi, signal);

  return {
    action: result.action === "already_in_column" ? "already_in_doing" : result.action,
    column: result.column,
    sourceUrl: result.sourceUrl,
  };
};

const fetchMyIdentity = async (
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<FizzyUser> => {
  const payload = await fetchJson(`${baseUrl}/my/identity`, createHeaders(token), signal);

  if (!isRecord(payload) || !Array.isArray(payload.accounts)) {
    throw new Error("Fizzy identity response did not contain accounts.");
  }

  for (const account of payload.accounts) {
    if (!isRecord(account) || !isRecord(account.user)) {
      continue;
    }
    return normalizeUser(account.user);
  }

  throw new Error("Fizzy identity response did not contain a user.");
};

const getCardAssignees = (snapshot: FizzyCardSnapshot): FizzyUser[] => {
  return Array.isArray((snapshot.card as Record<string, unknown>).assignees)
    ? ((snapshot.card as Record<string, unknown>).assignees as unknown[])
        .filter((assignee): assignee is Record<string, unknown> => isRecord(assignee))
        .map((assignee) => normalizeUser(assignee))
    : [];
};

export const assignFizzyCardToSelf = async (
  sourceUrl: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyAssignResult> => {
  const { cardUrl, reference, token, baseUrl } = await resolveCardRequestContext(sourceUrl, pi);
  const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);

  const currentAssignees = getCardAssignees(snapshot);
  const me = await fetchMyIdentity(baseUrl, token, signal);
  const alreadyAssigned = currentAssignees.some((user) => user.id === me.id);

  await sendJson(`${cardUrl}/self_assignment`, "POST", token, {}, signal);

  // Re-fetch card to determine final state since the self-assignment endpoint toggles
  const refreshed = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
  const refreshedAssignees = getCardAssignees(refreshed);
  const nowAssigned = refreshedAssignees.some((user) => user.id === me.id);

  return {
    action: alreadyAssigned && !nowAssigned
      ? "unassigned"
      : nowAssigned
      ? alreadyAssigned
        ? "already_assigned"
        : "assigned"
      : "unassigned",
    assignee: me,
    sourceUrl: reference.url,
  };
};

export const ensureFizzyCardAssignedToSelf = async (
  sourceUrl: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FizzyEnsureAssignedResult> => {
  const { cardUrl, reference, token, baseUrl } = await resolveCardRequestContext(sourceUrl, pi);
  const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
  const currentAssignees = getCardAssignees(snapshot);
  const me = await fetchMyIdentity(baseUrl, token, signal);
  const alreadyAssigned = currentAssignees.some((user) => user.id === me.id);

  if (alreadyAssigned) {
    return {
      action: "already_assigned",
      assignee: me,
      sourceUrl: reference.url,
    };
  }

  await sendJson(`${cardUrl}/self_assignment`, "POST", token, {}, signal);

  const refreshed = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
  const refreshedAssignees = getCardAssignees(refreshed);
  const nowAssigned = refreshedAssignees.some((user) => user.id === me.id);

  if (!nowAssigned) {
    throw new Error("Fizzy did not report pi as assigned after the self-assignment request.");
  }

  return {
    action: "assigned",
    assignee: me,
    sourceUrl: reference.url,
  };
};
