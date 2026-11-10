import { copyFor } from "./content.js";
import type { OfferSnapshot } from "./types.js";
import { boardAppearance } from "@hotel/design";
import { escapeHtml } from "./security.js";

export function boardLabel(value: unknown, locale?: string): string {
  const copy = copyFor(locale);
  const code = value === "breakfast" ? "BB" : value;
  if (code === "BB" || code === "HB" || code === "FB") return `${code} · ${copy.boardNames[code]}`;
  // Historical snapshots are immutable and must not acquire meals they never included.
  if (code === "room_only") return copy.roomOnly;
  return `${copy.board}: ${locale?.startsWith("it") ? "da confermare" : "needs confirmation"}`;
}

export function offerBoardLabel(snapshot: OfferSnapshot, locale?: string): string {
  if (snapshot.guestSnapshot.mealPlan) return boardLabel(snapshot.guestSnapshot.mealPlan, locale);
  const plans = [...new Set(snapshot.options.map((option) => option.mealPlan))];
  return boardLabel(plans.length === 1 ? plans[0] : undefined, locale);
}

export function renderBoardBadge(value: unknown, locale?: string): string {
  const code = value === "breakfast" ? "BB" : value;
  if (code !== "BB" && code !== "HB" && code !== "FB") return escapeHtml(boardLabel(value, locale));
  const appearance = boardAppearance[code];
  const coverage = appearance.segments / 3 * 100;
  return `<span class="board-badge" data-board="${code}" aria-label="${escapeHtml(boardLabel(code, locale))}" title="${escapeHtml(boardLabel(code, locale))}" style="display:inline-block;position:relative;vertical-align:middle;box-sizing:border-box;width:29px;height:26px;overflow:hidden;border:0;border-radius:0;background:${appearance.background};color:${appearance.text};text-align:center"><strong style="display:block;font-size:14px;height:23px;line-height:23px;letter-spacing:.5px">${code}</strong><span aria-hidden="true" data-coverage="${appearance.segments}/3" style="display:block;height:3px;line-height:0;font-size:0;background:${appearance.track}"><span style="display:block;width:${coverage}%;height:3px;background:${appearance.fill}"></span></span></span>`;
}

export function renderOfferBoardBadge(snapshot: OfferSnapshot, locale?: string): string {
  const plans = [...new Set(snapshot.options.map((option) => option.mealPlan))];
  return renderBoardBadge(snapshot.guestSnapshot.mealPlan ?? (plans.length === 1 ? plans[0] : undefined), locale);
}
