import { t, translateLabel, getLanguage, locale } from "../i18n";
import { validationMessage } from "@hotel/i18n";


import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BedDouble, CalendarDays, Check, ChevronDown, SlidersHorizontal, Users, X } from "lucide-react-native";
import { clientFiltersSchema } from "@hotel/contracts/clients";
import { theme } from "@hotel/design";
import type { ClientFilterOptions, ClientFilters } from "../api/types";
import { actionStyles } from "../components/actionStyles";
import { Button, Field, InlineState } from "../components/ui";
import { boardOptions, statusOptions } from "./filter-summary";
import { FilterDateField } from "./FilterDateField";

type Draft = Partial<Record<keyof ClientFilters, string>>;
type Props = { filters: ClientFilters; options: ClientFilterOptions; optionsLoading: boolean; optionsError: boolean; onRetryOptions: () => void; onApply: (filters: ClientFilters) => void; onClose: () => void };

export function ClientFiltersModal({ filters, options, optionsLoading, optionsError, onRetryOptions, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)])));
  const [errors, setErrors] = useState<Draft>({});
  const update = (key: keyof ClientFilters, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors({});
  };
  const apply = () => {
    const result = clientFiltersSchema.safeParse(Object.fromEntries(Object.entries(draft).filter(([, value]) => value?.trim() !== "")));
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.code === "custom" ? validationMessage(getLanguage(), issue) : String(issue.path[0]).includes("From") || String(issue.path[0]).includes("To") ? t("Enter a valid date.") : t("Enter a whole number from 0 to 1000.")])));
      return;
    }
    onApply(result.data);
  };
  const dateRange = (from: "stayFrom" | "addedFrom", to: "stayTo" | "addedTo", fromLabel: string, toLabel: string) => <View style={styles.row}>
    <View style={styles.column}><FilterDateField label={fromLabel} value={draft[from] ?? ""} onChange={(value) => update(from, value)} error={errors[from]} /></View>
    <View style={styles.column}><FilterDateField label={toLabel} value={draft[to] ?? ""} onChange={(value) => update(to, value)} error={errors[to]} /></View>
  </View>;
  const countRange = (label: string, min: keyof ClientFilters, max: keyof ClientFilters) => <View style={styles.range}>
    <Text style={styles.label}>{translateLabel(label)}</Text>
    <View style={styles.row}>
      <View style={styles.column}><Field label={t("{{v0}} · minimum", { v0: label })} placeholder={t("Any")} value={draft[min] ?? ""} onChangeText={(value) => update(min, value)} keyboardType="number-pad" maxLength={4} error={errors[min]} /></View>
      <View style={styles.column}><Field label={t("{{v0}} · maximum", { v0: label })} placeholder={t("Any")} value={draft[max] ?? ""} onChangeText={(value) => update(max, value)} keyboardType="number-pad" maxLength={4} error={errors[max]} /></View>
    </View>
  </View>;
  const choice = (key: keyof ClientFilters, label: string, items: Array<{ value: string; label: string }>) => <ChoiceField label={translateLabel(label)} value={draft[key] ?? ""} options={items} onChange={(value) => update(key, value)} />;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><SafeAreaView style={styles.sheet}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.headerCopy}><SlidersHorizontal size={20} color={theme.colors.action} /><Text accessibilityRole="header" style={styles.title}>{t("Filter clients")}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Close filters")} onPress={onClose} style={actionStyles.iconButton}><X size={20} color={theme.colors.textMuted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>{t("Find contacts by their stay or contact details. Leave any field empty to include all.")}</Text>
          <View style={styles.section}>
            <View style={styles.sectionTitle}><CalendarDays size={18} color={theme.colors.action} /><Text style={styles.sectionText}>{t("Reservation")}</Text></View>
            <Text style={styles.hint}>{t("Matches any linked stay overlapping these dates. Check-out day is excluded. All reservation filters apply to the same stay.")}</Text>
            {dateRange("stayFrom", "stayTo", t("Stay from"), t("Stay until"))}
            {countRange(t("Total guests"), "minGuests", "maxGuests")}
            {choice("status", t("Reservation status"), statusOptions)}
            <View style={styles.sectionTitle}><BedDouble size={18} color={theme.colors.textMuted} /><Text style={styles.label}>{t("Room & board")}</Text></View>
            {optionsLoading ? <View style={styles.loading}><ActivityIndicator color={theme.colors.action} /><Text style={styles.hint}>{t("Loading rooms and languages…")}</Text></View> : null}
            {optionsError ? <><InlineState tone="danger">{t("Could not load rooms and languages.")}</InlineState><Button variant="tertiary" onPress={onRetryOptions}>{t("Retry filter options")}</Button></> : null}
            {choice("roomId", t("Room category"), options.rooms.map((room) => ({ value: room.id, label: `${room.name}${room.archived ? t(" (archived)") : ""}` })))}
            {choice("mealPlan", t("Board basis"), boardOptions)}
            {countRange(t("Nights"), "minNights", "maxNights")}
          </View>
          <View style={styles.section}>
            <View style={styles.sectionTitle}><Users size={18} color={theme.colors.action} /><Text style={styles.sectionText}>{t("Guests per reservation")}</Text></View>
            <Text style={styles.hint}>{t("Total guests includes adults and children across all rooms in a request. Use the same minimum and maximum for an exact count.")}</Text>
            {countRange(t("Adults"), "minAdults", "maxAdults")}
            {countRange(t("Children"), "minChildren", "maxChildren")}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionText}>{t("Contact details")}</Text>
            {choice("source", t("Contact source"), [{ value: "inquiry", label: t("From enquiry") }, { value: "manual", label: t("Added manually") }])}
            {choice("locale", t("Language"), options.locales.map((locale) => ({ value: locale, label: languageLabel(locale) })))}
            {choice("contact", t("Contact method"), [{ value: "email", label: t("Has email") }, { value: "phone", label: t("Has phone") }, { value: "both", label: t("Has email & phone") }])}
            {choice("reservations", t("Reservation history"), [{ value: "with", label: t("With reservations") }, { value: "without", label: t("No reservations") }])}
            {errors.reservations ? <Text style={styles.error}>{errors.reservations}</Text> : null}
            {choice("notes", t("Client notes"), [{ value: "with", label: t("Has notes") }, { value: "without", label: t("No notes") }])}
            {dateRange("addedFrom", "addedTo", t("Added from (UTC)"), t("Added until (UTC)"))}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          {Object.keys(errors).length ? <Text accessibilityRole="alert" style={styles.error}>{t("Check the highlighted fields before applying.")}</Text> : null}
          <View style={styles.row}><View style={styles.column}><Button variant="tertiary" onPress={() => { setDraft({}); setErrors({}); }}>{t("Reset filters")}</Button></View><View style={styles.column}><Button onPress={apply}>{t("Apply filters")}</Button></View></View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView></View>
  </Modal>;
}

function languageLabel(locale: string) {
  try { return `${new Intl.DisplayNames([getLanguage()], { type: "language" }).of(locale)} (${locale})`; } catch { return locale; }
}

function ChoiceField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const items = [{ value: "", label: t("Any") }, ...options];
  return <View style={styles.choice}>
    <Text style={styles.label}>{translateLabel(label)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${t(items.find((item) => item.value === value)?.label ?? value)}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((current) => !current)} style={styles.select}>
      <Text style={[styles.selectText, !value && styles.hint]}>{t(items.find((item) => item.value === value)?.label ?? value)}</Text><ChevronDown size={18} color={theme.colors.textMuted} />
    </Pressable>
    {open ? <ScrollView nestedScrollEnabled style={styles.options} keyboardShouldPersistTaps="handled">{items.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: item.value === value }} accessibilityLabel={`${t(label)}: ${t(item.label)}`} onPress={() => { onChange(item.value); setOpen(false); }} style={[styles.option, item.value === value && styles.optionSelected]}>
      <Text style={styles.selectText}>{translateLabel(item.label)}</Text>{item.value === value ? <Check size={18} color={theme.colors.action} /> : null}
    </Pressable>)}</ScrollView> : null}
  </View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(20, 30, 50, 0.35)", alignItems: "center", justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 640, maxHeight: "94%", backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: "hidden", flexShrink: 1 },
  keyboard: { flexShrink: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: theme.colors.border },
  headerCopy: { flexDirection: "row", alignItems: "center", gap: 10 }, title: { ...theme.typography.h3, color: theme.colors.text },
  content: { padding: 20, gap: 24 }, intro: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  section: { gap: 16, borderBottomWidth: 1, borderColor: theme.colors.border, paddingBottom: 24 }, sectionTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionText: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, hint: { ...theme.typography.caption, color: theme.colors.textMuted },
  row: { flexDirection: "row", gap: 12 }, column: { flex: 1, minWidth: 0 }, range: { gap: 10 }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  choice: { gap: 8 }, select: { minHeight: theme.controls.inputHeight, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  selectText: { ...theme.typography.bodySmall, color: theme.colors.text, flex: 1 }, options: { maxHeight: 240, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md },
  option: { minHeight: theme.controls.minTarget, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }, optionSelected: { backgroundColor: theme.colors.actionTint },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 }, footer: { padding: 16, borderTopWidth: 1, borderColor: theme.colors.border, gap: 10 }, error: { ...theme.typography.caption, color: theme.colors.danger },
});
