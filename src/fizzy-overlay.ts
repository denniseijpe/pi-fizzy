import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth, type Component } from "@mariozechner/pi-tui";

import type { ActiveFizzyCardState } from "./session-state";

const MAX_TITLE_WIDTH = 32;

const truncateTitle = (value: string, maxWidth: number = MAX_TITLE_WIDTH): string => {
  if (value.length <= maxWidth) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxWidth - 1))}…`;
};

const padRight = (value: string, width: number): string => {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
};

export class FizzyOverlay implements Component {
  private activeCard: ActiveFizzyCardState | null = null;

  public constructor(private readonly theme: Theme) {}

  public setActiveCard(activeCard: ActiveFizzyCardState | null): void {
    this.activeCard = activeCard;
  }

  public render(width: number): string[] {
    const innerWidth = Math.max(18, width - 2);
    const border = this.theme.fg("border", "─");
    const title = this.theme.fg("accent", "Fizzy");
    const body = this.activeCard
      ? truncateTitle(this.activeCard.title)
      : this.theme.fg("dim", "No active card");
    const meta = this.activeCard
      ? this.theme.fg("dim", `#${this.activeCard.cardNumber}`)
      : this.theme.fg("dim", "idle");

    return [
      this.theme.fg("border", `╭${border.repeat(innerWidth)}╮`),
      this.theme.fg("border", "│") + padRight(` ${title} ${meta}`, innerWidth) + this.theme.fg("border", "│"),
      this.theme.fg("border", "│") + padRight(` ${body}`, innerWidth) + this.theme.fg("border", "│"),
      this.theme.fg("border", `╰${border.repeat(innerWidth)}╯`),
    ];
  }

  public invalidate(): void {}
}
