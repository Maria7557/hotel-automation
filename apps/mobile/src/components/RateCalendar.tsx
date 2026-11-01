import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { theme } from "@hotel/design";
import type { RatePeriod } from "@/api/types";

type RateCalendarProps = {
  rates: RatePeriod[];
  selectedStart?: string | undefined;
  selectedEndInclusive?: string | undefined;
  editingRateId?: string | undefined;
  onRangeChange?: (start: string, endInclusive: string | null) => void;
  onBlockedRange?: () => void;
  disabled?: boolean;
};

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function RateCalendar({
  rates,
  selectedStart,
  selectedEndInclusive,
  editingRateId,
  onRangeChange,
  onBlockedRange,
  disabled = false,
}: RateCalendarProps) {
  const { width } = useWindowDimensions();
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(selectedStart ?? todayIso()));
  const interactive = Boolean(onRangeChange);

  const activeRates = useMemo(() => rates.filter((rate) => rate.active), [rates]);
  const months = [visibleMonth, addMonths(visibleMonth, 1)];

  const selectDate = (date: string) => {
    if (!onRangeChange || disabled || isCovered(date, activeRates, editingRateId)) return;
    if (!selectedStart || selectedEndInclusive) {
      onRangeChange(date, null);
      return;
    }
    if (date < selectedStart) {
      onRangeChange(date, null);
      return;
    }
    if (rangeHasCoverage(selectedStart, date, activeRates, editingRateId)) {
      onBlockedRange?.();
      return;
    }
    onRangeChange(selectedStart, date);
  };

  return (
    <View style={styles.calendarCard}>
      <View style={styles.calendarHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show previous months"
          disabled={disabled}
          onPress={() => setVisibleMonth((current) => addMonths(current, -1))}
          style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
        >
          <ChevronLeft size={21} color={theme.colors.text} />
        </Pressable>
        <View style={styles.legend}>
          <LegendSwatch style={styles.legendCovered} label="Rate set" />
          <LegendSwatch style={styles.legendMissing} label="No rate" />
          {interactive ? <LegendSwatch style={styles.legendSelected} label="Selected" /> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show next months"
          disabled={disabled}
          onPress={() => setVisibleMonth((current) => addMonths(current, 1))}
          style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
        >
          <ChevronRight size={21} color={theme.colors.text} />
        </Pressable>
      </View>

      <View style={[styles.months, width < 760 && styles.monthsStacked]}>
        {months.map((month) => (
          <Month
            key={month}
            month={month}
            rates={activeRates}
            selectedStart={selectedStart}
            selectedEndInclusive={selectedEndInclusive}
            editingRateId={editingRateId}
            interactive={interactive}
            disabled={disabled}
            onSelect={selectDate}
          />
        ))}
      </View>
      {interactive ? (
        <Text style={styles.calendarHint}>
          {selectedStart
            ? selectedEndInclusive
              ? `${formatLongDate(selectedStart)} — ${formatLongDate(selectedEndInclusive)}`
              : "Now choose the last night in the period."
            : "Choose the first night, then the last night."}
        </Text>
      ) : null}
    </View>
  );
}

function Month({
  month,
  rates,
  selectedStart,
  selectedEndInclusive,
  editingRateId,
  interactive,
  disabled,
  onSelect,
}: {
  month: string;
  rates: RatePeriod[];
  selectedStart?: string | undefined;
  selectedEndInclusive?: string | undefined;
  editingRateId?: string | undefined;
  interactive: boolean;
  disabled: boolean;
  onSelect: (date: string) => void;
}) {
  const cells = monthCells(month);
  return (
    <View style={styles.month}>
      <Text style={styles.monthTitle}>{formatMonth(month)}</Text>
      <View style={styles.weekRow}>
        {weekdayLabels.map((label, index) => (
          <Text key={label} style={[styles.weekday, index > 4 && styles.weekend]}>{label}</Text>
        ))}
      </View>
      <View style={styles.daysGrid}>
        {cells.map((date, index) => {
          if (!date) return <View key={`blank-${index}`} style={styles.dayCell} />;
          const matchingRates = rates.filter((candidate) => candidate.start <= date && date < candidate.endExclusive);
          const rate = matchingRates.find((candidate) => candidate.id !== editingRateId) ?? matchingRates[0];
          const coveredByOther = matchingRates.some((candidate) => candidate.id !== editingRateId);
          const selected = Boolean(selectedStart &&
            (selectedEndInclusive
              ? selectedStart <= date && date <= selectedEndInclusive
              : selectedStart === date));
          const unavailable = disabled || (interactive && coveredByOther);
          return (
            <Pressable
              key={date}
              accessibilityRole={interactive ? "button" : undefined}
              accessibilityLabel={`${formatLongDate(date)}${rate ? `, ${formatCalendarPrice(rate.nightlyBaseCents)} per night` : ", no rate"}`}
              accessibilityState={interactive ? { disabled: unavailable, selected } : undefined}
              disabled={!interactive || unavailable}
              onPress={() => onSelect(date)}
              style={({ pressed }) => [
                styles.dayCell,
                rate ? styles.dayCovered : styles.dayMissing,
                interactive && !coveredByOther && styles.daySelectable,
                selected && styles.daySelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{Number(date.slice(-2))}</Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.dayPrice,
                  !rate && styles.dayMissingText,
                  selected && styles.dayPriceSelected,
                ]}
              >
                {rate ? formatCalendarPrice(rate.nightlyBaseCents) : "No rate"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function LegendSwatch({ style, label }: { style: object; label: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendSwatch, style]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function monthCells(month: string): Array<string | null> {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return [];
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(isoDate(year, monthNumber, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isCovered(date: string, rates: RatePeriod[], editingRateId?: string): boolean {
  return rates.some((rate) => rate.id !== editingRateId && rate.start <= date && date < rate.endExclusive);
}

function rangeHasCoverage(start: string, endInclusive: string, rates: RatePeriod[], editingRateId?: string): boolean {
  let date = start;
  while (date <= endInclusive) {
    if (isCovered(date, rates, editingRateId)) return true;
    date = addDays(date, 1);
  }
  return false;
}

function monthStart(date: string): string { return `${date.slice(0, 7)}-01`; }
function addMonths(date: string, amount: number): string {
  const [year, month] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1 + amount, 1));
  return isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
}
function addDays(date: string, amount: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}
function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
function formatCalendarPrice(cents: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

const styles = StyleSheet.create({
  calendarCard: { gap: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing[4] },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3] },
  monthButton: { width: 44, height: 44, borderRadius: theme.radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border },
  legend: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  legendSwatch: { width: 12, height: 12, borderRadius: 4, borderWidth: 1 },
  legendCovered: { backgroundColor: theme.colors.background, borderColor: theme.colors.borderStrong },
  legendMissing: { backgroundColor: theme.colors.warningTint, borderColor: theme.colors.warning },
  legendSelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  legendText: { ...theme.typography.caption, color: theme.colors.textMuted },
  months: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[5] },
  monthsStacked: { flexDirection: "column" },
  month: { flex: 1, width: "100%", minWidth: 0 },
  monthTitle: { ...theme.typography.h3, color: theme.colors.text, textAlign: "center", marginBottom: theme.spacing[3] },
  weekRow: { flexDirection: "row", marginBottom: theme.spacing[1] },
  weekday: { width: "14.2857%", ...theme.typography.captionMedium, color: theme.colors.textSecondary, textAlign: "center" },
  weekend: { color: theme.colors.textMuted },
  daysGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.2857%", minHeight: 68, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: theme.radii.md, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 2 },
  dayCovered: { backgroundColor: theme.colors.background },
  dayMissing: { backgroundColor: theme.colors.warningTint },
  daySelectable: { borderColor: theme.colors.surface },
  daySelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  dayNumber: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  dayNumberSelected: { color: theme.colors.onAction },
  dayPrice: { ...theme.typography.captionMedium, color: theme.colors.textSecondary, maxWidth: "100%" },
  dayMissingText: { color: theme.colors.warning },
  dayPriceSelected: { color: theme.colors.onAction },
  calendarHint: { ...theme.typography.bodySmallMedium, color: theme.colors.action, textAlign: "center" },
  pressed: { opacity: 0.64 },
});
