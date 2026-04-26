import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type OverlayHandle,
  type TUI,
} from "@mariozechner/pi-tui";
import { Type } from "typebox";

import {
  addFizzyComment,
  assignFizzyCardToSelf,
  ensureFizzyCardInDoing,
  fetchFizzyCardSnapshot,
  fetchLatestAssignedFizzyTasks,
  markFizzyCardDone,
  moveFizzyCardToColumn,
} from "./fizzy-api";
import { FizzyListModal } from "./fizzy-list-modal";
import { FizzyOverlay } from "./fizzy-overlay";
import {
  buildBuildPrompt,
  buildLoadPrompt,
  buildPlanPrompt,
  buildSessionName,
  buildToolSummary,
} from "./formatting";
import {
  persistActiveFizzyCard,
  restoreActiveFizzyCard,
  type ActiveFizzyCardState,
} from "./session-state";
import type { FizzyAssignedTask, FizzyCardSnapshot } from "./types";

type FizzyMode = "build" | "load" | "plan";

const CARD_COMPLETION_LIMIT = 50;
const MAX_CARD_COMPLETIONS = 20;
const CARD_COMPLETION_CACHE_MS = 30_000;

const queueUserMessage = (
  pi: ExtensionAPI,
  prompt: string,
  busy: boolean,
): { delivery: "now" | "followUp" } => {
  if (busy) {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    return { delivery: "followUp" };
  }

  pi.sendUserMessage(prompt);
  return { delivery: "now" };
};

export default function fizzyExtension(pi: ExtensionAPI) {
  let activeCard: ActiveFizzyCardState | null = null;
  let doingEnsuredForSourceUrl: string | null = null;
  let overlay: FizzyOverlay | null = null;
  let overlayHandle: OverlayHandle | null = null;
  let overlayTui: TUI | null = null;
  let cardCompletionCache:
    | { fetchedAt: number; promise: Promise<FizzyAssignedTask[]> }
    | null = null;

  const getCardCompletionTasks = (): Promise<FizzyAssignedTask[]> => {
    const now = Date.now();

    if (
      cardCompletionCache
      && now - cardCompletionCache.fetchedAt < CARD_COMPLETION_CACHE_MS
    ) {
      return cardCompletionCache.promise;
    }

    const promise = fetchLatestAssignedFizzyTasks(
      pi,
      undefined,
      CARD_COMPLETION_LIMIT,
    ).catch((error: unknown) => {
      if (cardCompletionCache?.promise === promise) {
        cardCompletionCache = null;
      }
      throw error;
    });

    cardCompletionCache = { fetchedAt: now, promise };
    return promise;
  };

  const taskToAutocompleteItem = (task: FizzyAssignedTask): AutocompleteItem => {
    const column = task.card.column?.name?.trim();
    const descriptionParts = [task.card.title, task.account.name];
    if (column) {
      descriptionParts.push(column);
    }

    return {
      description: descriptionParts.join(" · "),
      label: `#${task.card.number}`,
      value: task.sourceUrl,
    };
  };

  const filterCardCompletionTasks = (
    tasks: FizzyAssignedTask[],
    query: string,
  ): FizzyAssignedTask[] => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return tasks.slice(0, MAX_CARD_COMPLETIONS);
    }

    if (/^#?\d+$/.test(trimmedQuery)) {
      const numericQuery = trimmedQuery.replace(/^#/, "");
      const numericMatches = tasks.filter((task) => {
        return String(task.card.number).startsWith(numericQuery);
      });

      if (numericMatches.length > 0) {
        return numericMatches.slice(0, MAX_CARD_COMPLETIONS);
      }
    }

    return fuzzyFilter(tasks, trimmedQuery, (task) => {
      const column = task.card.column?.name ?? "";
      return `${task.card.number} ${task.card.title} ${task.account.name} ${column}`;
    }).slice(0, MAX_CARD_COMPLETIONS);
  };

  const getCardArgumentCompletions = async (
    prefix: string,
  ): Promise<AutocompleteItem[] | null> => {
    if (/^https?:\/\//.test(prefix.trim())) {
      return null;
    }

    try {
      const tasks = await getCardCompletionTasks();
      const matches = filterCardCompletionTasks(tasks, prefix);
      const items = matches.map(taskToAutocompleteItem);

      return items.length > 0 ? items : null;
    } catch {
      return null;
    }
  };

  const syncOverlay = (): void => {
    if (!overlay) {
      return;
    }

    overlay.setActiveCard(activeCard);
    if (overlayHandle) {
      overlayHandle.setHidden(!activeCard);
    }
    overlayTui?.requestRender();
  };

  const ensureOverlay = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || overlay) {
      syncOverlay();
      return;
    }

    void ctx.ui.custom(
      (tui, theme) => {
        overlayTui = tui;
        overlay = new FizzyOverlay(theme);
        overlay.setActiveCard(activeCard);
        return overlay;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-right",
          margin: { right: 2, top: 1 },
          nonCapturing: true,
          visible: (termWidth: number) => termWidth >= 70,
          width: 40,
        },
        onHandle: (handle) => {
          overlayHandle = handle;
          syncOverlay();
        },
      },
    );
  };

  const setActiveCard = (
    snapshot: FizzyCardSnapshot,
    mode?: FizzyMode,
  ): ActiveFizzyCardState => {
    activeCard = persistActiveFizzyCard(pi, snapshot, mode);
    doingEnsuredForSourceUrl = null;
    syncOverlay();
    return activeCard;
  };

  const restoreState = (ctx: ExtensionContext): void => {
    activeCard = restoreActiveFizzyCard(ctx);
    doingEnsuredForSourceUrl = null;
    syncOverlay();
  };

  const requireSourceUrl = (url?: string): string => {
    const trimmed = url?.trim();
    if (trimmed) {
      return trimmed;
    }

    if (activeCard?.sourceUrl) {
      return activeCard.sourceUrl;
    }

    throw new Error(
      "No active Fizzy card on this session. Run /fizzy, /fizzydo, or /fizzyplan first, or pass a card URL.",
    );
  };

  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx);
    ensureOverlay(ctx);
  });

  const ensureDoingColumnForActiveCard = async (
    ctx: ExtensionContext,
    sourceUrl?: string,
  ): Promise<void> => {
    const resolvedSourceUrl = sourceUrl?.trim() || activeCard?.sourceUrl;
    if (!resolvedSourceUrl || doingEnsuredForSourceUrl === resolvedSourceUrl) {
      return;
    }

    try {
      const result = await ensureFizzyCardInDoing(resolvedSourceUrl, pi, ctx.signal);
      doingEnsuredForSourceUrl = resolvedSourceUrl;

      if (result.action === "created_and_moved") {
        ctx.ui.notify("Created Fizzy column \"Doing\" and moved the card there.", "info");
      } else if (result.action === "moved") {
        ctx.ui.notify("Moved the Fizzy card to the Doing column.", "info");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not move Fizzy card to Doing: ${message}`, "warning");
    }
  };

  const startFromFizzy = async (
    mode: FizzyMode,
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    const url = args.trim();
    if (!url) {
      const commandName = mode === "build"
        ? "fizzydo"
        : mode === "plan"
        ? "fizzyplan"
        : "fizzy";
      ctx.ui.notify(
        `Usage: /${commandName} https://app.fizzy.do/<account>/cards/<number>`,
        "warning",
      );
      return;
    }

    ctx.ui.notify(`Fetching Fizzy card for ${mode}...`, "info");

    try {
      const snapshot = await fetchFizzyCardSnapshot(url, pi, ctx.signal);
      setActiveCard(snapshot, mode);
      pi.setSessionName(buildSessionName(snapshot));

      if (mode === "build" || mode === "plan") {
        await ensureDoingColumnForActiveCard(ctx, snapshot.sourceUrl);
      }

      const prompt = mode === "load"
        ? buildLoadPrompt(snapshot)
        : mode === "plan"
        ? buildPlanPrompt(snapshot)
        : buildBuildPrompt(snapshot);

      const result = queueUserMessage(pi, prompt, !ctx.isIdle());
      if (mode === "load") {
        ctx.ui.notify("Fizzy card loaded. What do you want to do?", "info");
      }

      if (result.delivery === "followUp") {
        const commandName = mode === "build"
          ? "fizzydo"
          : mode === "plan"
          ? "fizzyplan"
          : "fizzy";
        ctx.ui.notify(`Queued /${commandName} as a follow-up.`, "info");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Fizzy failed: ${message}`, "error");
    }
  };

  pi.registerTool({
    name: "fizzy_get_card",
    label: "Fizzy Get Card",
    description: "Fetch a Fizzy card plus recent comments from a Fizzy card URL.",
    promptSnippet: "Fetch a Fizzy card by URL, including description, steps, and recent comments.",
    promptGuidelines: [
      "Use fizzy_get_card when the user references a Fizzy card URL and you need the live card details.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({
        description: "Fizzy card URL, for example https://app.fizzy.do/6182909/cards/89. Optional if this session already has a current Fizzy card.",
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const sourceUrl = requireSourceUrl(params.url);
      const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
      setActiveCard(snapshot, activeCard?.mode);
      return {
        content: [{ type: "text", text: buildToolSummary(snapshot) }],
        details: snapshot,
      };
    },
  });

  pi.registerTool({
    name: "fizzy_add_comment",
    label: "Fizzy Add Comment",
    description: "Add a comment to a Fizzy card. Uses the current Fizzy card in this session if no URL is provided.",
    promptSnippet: "Add a comment to the current Fizzy card, or to a specific Fizzy card URL.",
    promptGuidelines: [
      "Use fizzy_add_comment to post progress updates, summaries, or handoff notes back to Fizzy.",
      "If the user refers to the current Fizzy task, omit the URL and rely on session state.",
    ],
    parameters: Type.Object({
      body: Type.String({
        description: "Comment text to post to the card.",
      }),
      url: Type.Optional(Type.String({
        description: "Optional Fizzy card URL. If omitted, the tool uses the current Fizzy card stored on this session.",
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const sourceUrl = requireSourceUrl(params.url);
      const result = await addFizzyComment(sourceUrl, params.body, pi, signal);
      const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
      setActiveCard(snapshot, activeCard?.mode);
      return {
        content: [{
          type: "text",
          text: `Added comment to Fizzy card #${snapshot.card.number}: ${snapshot.card.title}`,
        }],
        details: {
          body: params.body,
          comment: result.comment,
          snapshot,
        },
      };
    },
  });

  pi.registerTool({
    name: "fizzy_move_to_column",
    label: "Fizzy Move To Column",
    description: "Move a Fizzy card to a named column, creating the column if it does not exist. Uses the current Fizzy card in this session if no URL is provided.",
    promptSnippet: "Move the current Fizzy card to a named column, or move a specific Fizzy card URL to that column.",
    promptGuidelines: [
      "Use fizzy_move_to_column when the user asks to move a Fizzy card to Doing, Review, Maybe, or any other named column.",
      "If the user refers to the current Fizzy task, omit the URL and rely on session state.",
      "This tool creates the target column if it does not already exist.",
    ],
    parameters: Type.Object({
      columnName: Type.String({
        description: "Target column name, for example Doing, Review, or QA.",
      }),
      url: Type.Optional(Type.String({
        description: "Optional Fizzy card URL. If omitted, the tool uses the current Fizzy card stored on this session.",
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const sourceUrl = requireSourceUrl(params.url);
      const moveResult = await moveFizzyCardToColumn(
        sourceUrl,
        params.columnName,
        pi,
        signal,
      );
      const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
      setActiveCard(snapshot, activeCard?.mode);
      return {
        content: [{
          type: "text",
          text: moveResult.action === "created_and_moved"
            ? `Created Fizzy column \"${moveResult.column.name}\" and moved card #${snapshot.card.number} there.`
            : moveResult.action === "already_in_column"
            ? `Fizzy card #${snapshot.card.number} is already in column \"${moveResult.column.name}\".`
            : `Moved Fizzy card #${snapshot.card.number} to column \"${moveResult.column.name}\".`,
        }],
        details: {
          moveResult,
          snapshot,
        },
      };
    },
  });

  pi.registerTool({
    name: "fizzy_mark_done",
    label: "Fizzy Mark Done",
    description: "Mark a Fizzy card as done. Uses the current Fizzy card in this session if no URL is provided.",
    promptSnippet: "Mark the current Fizzy card done, or mark a specific Fizzy card URL done.",
    promptGuidelines: [
      "Use fizzy_mark_done when the user asks to close, finish, or mark a Fizzy issue done.",
      "If the user refers to the current Fizzy task, omit the URL and rely on session state.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({
        description: "Optional Fizzy card URL. If omitted, the tool uses the current Fizzy card stored on this session.",
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const sourceUrl = requireSourceUrl(params.url);
      const closeResult = await markFizzyCardDone(sourceUrl, pi, signal);
      const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
      setActiveCard(snapshot, activeCard?.mode);
      return {
        content: [{
          type: "text",
          text: `Marked Fizzy card #${snapshot.card.number} done: ${snapshot.card.title}`,
        }],
        details: {
          closeResult,
          snapshot,
        },
      };
    },
  });

  pi.registerTool({
    name: "fizzy_assign",
    label: "Fizzy Assign",
    description: "Assign the current user (pi) to a Fizzy card. Uses the current Fizzy card in this session if no URL is provided. Toggles assignment, so calling it again will unassign.",
    promptSnippet: "Assign pi to the current Fizzy card, or to a specific Fizzy card URL.",
    promptGuidelines: [
      "Use fizzy_assign when the user asks to assign themselves, take ownership, or pick up a Fizzy card.",
      "If the user refers to the current Fizzy task, omit the URL and rely on session state.",
      "This tool toggles assignment, so calling it again on an already-assigned card will unassign.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({
        description: "Optional Fizzy card URL. If omitted, the tool uses the current Fizzy card stored on this session.",
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const sourceUrl = requireSourceUrl(params.url);
      const assignResult = await assignFizzyCardToSelf(sourceUrl, pi, signal);
      const snapshot = await fetchFizzyCardSnapshot(sourceUrl, pi, signal);
      setActiveCard(snapshot, activeCard?.mode);

      const text = assignResult.action === "assigned"
        ? `Assigned ${assignResult.assignee.name} to Fizzy card #${snapshot.card.number}: ${snapshot.card.title}`
        : assignResult.action === "already_assigned"
        ? `${assignResult.assignee.name} is already assigned to Fizzy card #${snapshot.card.number}: ${snapshot.card.title}`
        : `Unassigned ${assignResult.assignee.name} from Fizzy card #${snapshot.card.number}: ${snapshot.card.title}`;

      return {
        content: [{ type: "text", text }],
        details: {
          assignResult,
          snapshot,
        },
      };
    },
  });

  pi.registerCommand("fizzycurrent", {
    description: "Show the current active Fizzy card stored on this session",
    handler: async (_args, ctx) => {
      if (!activeCard) {
        ctx.ui.notify("No active Fizzy card on this session.", "warning");
        return;
      }

      ctx.ui.notify(
        `Current Fizzy card: #${activeCard.cardNumber} ${activeCard.title} (${activeCard.sourceUrl})`,
        "info",
      );
      ensureOverlay(ctx);
    },
  });

  pi.registerCommand("fizzy", {
    description: "Fetch a Fizzy card and store it on the session without starting work",
    getArgumentCompletions: getCardArgumentCompletions,
    handler: async (args, ctx) => {
      await startFromFizzy("load", args, ctx);
    },
  });

  pi.registerCommand("fizzylist", {
    description: "Show the latest 20 Fizzy tasks assigned to the account",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/fizzylist requires interactive mode.", "error");
        return;
      }

      ctx.ui.notify("Fetching Fizzy tasks...", "info");

      try {
        const tasks = await fetchLatestAssignedFizzyTasks(pi, ctx.signal, 20);
        const selectedUrl = await ctx.ui.custom<string | null>(
          (tui, theme, _keybindings, done) => {
            return new FizzyListModal(tasks, theme, tui, done);
          },
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              maxHeight: "80%",
              minWidth: 54,
              width: "76%",
            },
          },
        );

        if (selectedUrl) {
          await startFromFizzy("load", selectedUrl, ctx);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not fetch Fizzy tasks: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("fizzydo", {
    description: "Fetch a Fizzy card and immediately start implementing it",
    getArgumentCompletions: getCardArgumentCompletions,
    handler: async (args, ctx) => {
      await startFromFizzy("build", args, ctx);
    },
  });

  pi.registerCommand("fizzyplan", {
    description: "Fetch a Fizzy card and start by producing an implementation plan",
    getArgumentCompletions: getCardArgumentCompletions,
    handler: async (args, ctx) => {
      await startFromFizzy("plan", args, ctx);
    },
  });
}
