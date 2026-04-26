import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@mariozechner/pi-tui";

import type { FizzyAssignedTask } from "./types";

const MIN_CONTENT_WIDTH = 36;
const DATE_WIDTH = 10;
const MODAL_HEIGHT_RATIO = 0.8;
const NON_TASK_LINE_COUNT = 7;
const TASK_LINE_COUNT = 2;

const padRight = (value: string, width: number): string => {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
};

const formatDate = (value?: string): string => {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toISOString().slice(0, DATE_WIDTH);
};

export class FizzyListModal implements Component {
  private scrollOffset = 0;
  private selectedIndex = 0;

  public constructor(
    private readonly tasks: FizzyAssignedTask[],
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly done: (result: string | null) => void,
  ) {}

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data.toLowerCase() === "q") {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.keepSelectedTaskVisible();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex = Math.min(this.tasks.length - 1, this.selectedIndex + 1);
      this.keepSelectedTaskVisible();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.done(this.tasks[this.selectedIndex]?.sourceUrl ?? null);
    }
  }

  public render(width: number): string[] {
    const contentWidth = Math.max(MIN_CONTENT_WIDTH, width - 2);
    const border = this.theme.fg("border", "─");
    const title = this.theme.fg("accent", " Fizzy assigned tasks ");
    const visibleTaskCount = this.getVisibleTaskCount();
    this.keepSelectedTaskVisible(visibleTaskCount);
    const visibleTasks = this.tasks.slice(
      this.scrollOffset,
      this.scrollOffset + visibleTaskCount,
    );
    const lines = [
      this.topBorder(contentWidth, border, title),
      this.row("Latest 20 tasks assigned to this account", contentWidth, "dim"),
      this.row(this.getScrollSummary(visibleTasks.length), contentWidth, "dim"),
      this.row("", contentWidth),
    ];

    if (this.tasks.length === 0) {
      lines.push(this.row("No assigned tasks found.", contentWidth, "warning"));
    } else {
      for (const [relativeIndex, task] of visibleTasks.entries()) {
        const index = this.scrollOffset + relativeIndex;
        lines.push(...this.renderTask(task, contentWidth, index === this.selectedIndex));
      }
    }

    lines.push(
      this.row("", contentWidth),
      this.row("↑/↓ select · Enter load · Esc/q close", contentWidth, "dim"),
      this.bottomBorder(contentWidth, border),
    );

    return lines;
  }

  public invalidate(): void {}

  private getVisibleTaskCount(): number {
    const maxModalRows = Math.max(8, Math.floor(this.tui.terminal.rows * MODAL_HEIGHT_RATIO));
    const availableTaskRows = Math.max(1, maxModalRows - NON_TASK_LINE_COUNT);
    return Math.max(1, Math.floor(availableTaskRows / TASK_LINE_COUNT));
  }

  private getScrollSummary(visibleCount: number): string {
    if (this.tasks.length === 0) {
      return "No tasks to show";
    }

    const first = this.scrollOffset + 1;
    const last = this.scrollOffset + visibleCount;
    const suffix = this.tasks.length > visibleCount ? " · scroll for more" : "";
    return `Showing ${first}-${last} of ${this.tasks.length}${suffix}`;
  }

  private keepSelectedTaskVisible(visibleTaskCount: number = this.getVisibleTaskCount()): void {
    if (this.tasks.length === 0) {
      this.scrollOffset = 0;
      this.selectedIndex = 0;
      return;
    }

    const maxSelectedIndex = this.tasks.length - 1;
    this.selectedIndex = Math.min(this.selectedIndex, maxSelectedIndex);

    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    }

    const visibleEnd = this.scrollOffset + visibleTaskCount - 1;
    if (this.selectedIndex > visibleEnd) {
      this.scrollOffset = this.selectedIndex - visibleTaskCount + 1;
    }

    const maxScrollOffset = Math.max(0, this.tasks.length - visibleTaskCount);
    this.scrollOffset = Math.min(this.scrollOffset, maxScrollOffset);
  }

  private renderTask(
    task: FizzyAssignedTask,
    contentWidth: number,
    selected: boolean,
  ): string[] {
    const card = task.card;
    const meta = this.theme.fg(
      "dim",
      `#${card.number} · ${formatDate(card.last_active_at ?? card.created_at)}`,
    );
    const account = this.theme.fg("muted", task.account.name);
    const titleWidth = Math.max(8, contentWidth - 4 - DATE_WIDTH);
    const title = truncateToWidth(card.title, titleWidth);
    const prefix = selected ? this.theme.fg("accent", "›") : " ";
    const firstLine = `${prefix} ${meta} ${this.theme.fg("text", title)}`;
    const secondLine = this.theme.fg("dim", `    ${account} · ${task.sourceUrl}`);

    return [
      this.row(firstLine, contentWidth, undefined, selected),
      this.row(truncateToWidth(secondLine, contentWidth), contentWidth, undefined, selected),
    ];
  }

  private row(
    value: string,
    contentWidth: number,
    color?: "dim" | "muted" | "warning",
    selected: boolean = false,
  ): string {
    const visible = truncateToWidth(value, contentWidth);
    const colored = color ? this.theme.fg(color, visible) : visible;
    const body = padRight(colored, contentWidth);

    return this.theme.fg("border", "│")
      + (selected ? this.theme.bg("selectedBg", body) : body)
      + this.theme.fg("border", "│");
  }

  private topBorder(contentWidth: number, border: string, title: string): string {
    const titleWidth = visibleWidth(title);
    const leftWidth = Math.max(0, Math.floor((contentWidth - titleWidth) / 2));
    const rightWidth = Math.max(0, contentWidth - titleWidth - leftWidth);

    return this.theme.fg("border", "╭")
      + border.repeat(leftWidth)
      + title
      + border.repeat(rightWidth)
      + this.theme.fg("border", "╮");
  }

  private bottomBorder(contentWidth: number, border: string): string {
    return this.theme.fg("border", `╰${border.repeat(contentWidth)}╯`);
  }
}
