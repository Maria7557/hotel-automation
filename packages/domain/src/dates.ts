const DAY_MS = 86_400_000;

export function dateToEpochDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  const value = Date.UTC(year, month - 1, day) / DAY_MS;
  if (!Number.isInteger(value) || epochDayToDate(value) !== date) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
  return value;
}

export function epochDayToDate(epochDay: number): string {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10);
}

export function enumerateNights(start: string, endExclusive: string): string[] {
  const first = dateToEpochDay(start);
  const end = dateToEpochDay(endExclusive);
  if (first >= end) throw new Error("endExclusive must be later than start");

  return Array.from({ length: end - first }, (_, offset) =>
    epochDayToDate(first + offset),
  );
}
