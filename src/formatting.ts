import type { FizzyCardSnapshot } from "./types";

const MAX_DESCRIPTION_CHARS = 12000;
const MAX_COMMENT_CHARS = 1500;

const truncate = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n…[truncated]`;
};

const formatDate = (value?: string): string => {
  if (!value) {
    return "unknown";
  }

  return value;
};

const toBulletList = (values: string[]): string => {
  if (values.length === 0) {
    return "- none";
  }

  return values.map((value) => `- ${value}`).join("\n");
};

export const formatCardSnapshot = (snapshot: FizzyCardSnapshot): string => {
  const { card, comments, commentsTruncated, fetchedAt, sourceUrl } = snapshot;
  const description = truncate(card.description?.trim() || "(none)", MAX_DESCRIPTION_CHARS);
  const stepLines = card.steps && card.steps.length > 0
    ? card.steps.map((step, index) => `- [${step.completed ? "x" : " "}] ${index + 1}. ${step.content}`)
    : ["- none"];

  const commentSections = comments.length > 0
    ? comments.map((comment, index) => {
      const author = comment.creator?.name || "Unknown";
      const body = truncate(comment.body?.plain_text?.trim() || "(empty)", MAX_COMMENT_CHARS);
      return [
        `### Comment ${index + 1}`,
        `- Author: ${author}`,
        `- Created: ${formatDate(comment.created_at)}`,
        "",
        body,
      ].join("\n");
    })
    : ["_No comments on this card._"];

  const metadata = [
    `- Title: ${card.title}`,
    `- Card number: ${card.number}`,
    `- Status: ${card.status || "unknown"}`,
    `- Closed: ${card.closed ? "yes" : "no"}`,
    `- Golden: ${card.golden ? "yes" : "no"}`,
    `- Board: ${card.board?.name || "unknown"}`,
    `- Column: ${card.column?.name || "untriaged / none"}`,
    `- Tags: ${card.tags && card.tags.length > 0 ? card.tags.join(", ") : "none"}`,
    `- Creator: ${card.creator?.name || "unknown"}`,
    `- Created at: ${formatDate(card.created_at)}`,
    `- Last active at: ${formatDate(card.last_active_at)}`,
    `- Has attachments: ${card.has_attachments ? "yes" : "no"}`,
    `- Source URL: ${sourceUrl}`,
    `- Card URL from API: ${card.url}`,
    `- Fetched at: ${fetchedAt}`,
  ];

  return [
    "# Fizzy card",
    "",
    ...metadata,
    "",
    "## Description",
    "",
    description,
    "",
    "## Steps",
    "",
    ...stepLines,
    "",
    "## Comments",
    "",
    `- Count included: ${comments.length}`,
    `- Truncated by limit: ${commentsTruncated ? "yes" : "no"}`,
    "",
    commentSections.join("\n\n"),
  ].join("\n");
};

export const buildLoadPrompt = (snapshot: FizzyCardSnapshot): string => {
  return [
    "A Fizzy card has been loaded into the current session context.",
    "Do not start editing files yet.",
    "Acknowledge that the card is loaded, briefly summarize it, and ask the user: \"What do you want to do?\"",
    "",
    formatCardSnapshot(snapshot),
  ].join("\n");
};

export const buildPlanPrompt = (snapshot: FizzyCardSnapshot): string => {
  return [
    "Create an implementation plan for this Fizzy card before making changes.",
    "Do not edit files yet.",
    "Call out assumptions, risks, and any missing details briefly.",
    "",
    formatCardSnapshot(snapshot),
  ].join("\n");
};

export const buildBuildPrompt = (snapshot: FizzyCardSnapshot): string => {
  return [
    "Implement the work described in this Fizzy card now.",
    "Use the card details below as the source of truth.",
    "If anything is ambiguous, make reasonable implementation choices and mention them briefly.",
    "",
    formatCardSnapshot(snapshot),
  ].join("\n");
};

export const buildToolSummary = (snapshot: FizzyCardSnapshot): string => {
  const { card, comments, commentsTruncated } = snapshot;
  const tags = card.tags && card.tags.length > 0 ? card.tags.join(", ") : "none";

  return [
    `Fetched Fizzy card #${card.number}: ${card.title}`,
    `Board: ${card.board?.name || "unknown"}`,
    `Column: ${card.column?.name || "untriaged / none"}`,
    `Status: ${card.status || "unknown"}`,
    `Tags: ${tags}`,
    `Steps: ${card.steps?.length ?? 0}`,
    `Comments included: ${comments.length}${commentsTruncated ? " (truncated)" : ""}`,
    "",
    formatCardSnapshot(snapshot),
  ].join("\n");
};

export const buildSessionName = (snapshot: FizzyCardSnapshot): string => {
  return `Fizzy #${snapshot.card.number}: ${snapshot.card.title}`;
};
