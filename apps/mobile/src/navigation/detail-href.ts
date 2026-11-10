export function detailHref(kind: "reservation" | "client", id: string): string {
  return `#/${kind === "reservation" ? "reservations" : "clients"}/${encodeURIComponent(id)}`;
}

export function shouldOpenInApp(event: { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  return (event.button === undefined || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
