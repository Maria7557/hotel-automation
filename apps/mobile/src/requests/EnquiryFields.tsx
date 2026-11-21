import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import { Check, Minus, Plus } from "lucide-react-native";
import { DEFAULT_GUEST_LANGUAGE, type EnquiryDetails, type MealPlan } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { t } from "../i18n";
import { FilterDateField } from "../clients/FilterDateField";
import { Field, Button } from "../components/ui";
import { GuestLanguageField } from "../components/GuestLanguageField";
import { MealPlanField } from "../components/MealPlanField";
import { NumberSelectField } from "../components/NumberSelectField";
import { ChildrenCountField, ChildAgeFields } from "./ChildrenFields";

export type RoomDraft = { mealPlan: MealPlan | null; adults: string; childAges: string[] };
export type EnquiryDraft = {
  firstName: string; lastName: string; email: string; phone: string; language: string;
  checkIn: string; checkOut: string; alternativeDates: Array<{ checkIn: string; checkOut: string }>;
  rooms: RoomDraft[]; note: string; consents: { privacy: boolean; marketing: boolean };
};
type InitialEnquiry = {
  guest: { name: string; email: string | null; phone: string | null; language: string };
  checkIn: string; checkOut: string; occupancy: { adults: number; childAges: number[] }; mealPlan: MealPlan | null; note: string;
  details?: EnquiryDetails | null | undefined;
};
export function newEnquiryDraft(initial?: InitialEnquiry | null): EnquiryDraft {
  const [firstName = "", ...surname] = initial?.guest.name.trim().split(/\s+/) ?? [];
  return {
    firstName: initial?.details?.firstName ?? firstName, lastName: initial?.details?.lastName ?? surname.join(" "),
    email: initial?.guest.email ?? "", phone: initial?.guest.phone ?? "", language: initial?.guest.language ?? DEFAULT_GUEST_LANGUAGE,
    checkIn: initial?.checkIn ?? "", checkOut: initial?.checkOut ?? "",
    alternativeDates: initial?.details?.alternativeDates?.map((range) => ({ ...range })) ?? [],
    rooms: [
      { mealPlan: initial?.mealPlan ?? null, adults: String(initial?.occupancy.adults ?? 2), childAges: initial?.occupancy.childAges.map(String) ?? [] },
      ...(initial?.details?.additionalRooms ?? []).map((room) => ({ mealPlan: room.mealPlan, adults: String(room.occupancy.adults), childAges: room.occupancy.childAges.map(String) })),
    ],
    note: initial?.note ?? "", consents: { privacy: false, marketing: false },
  };
}
const integer = (value: string) => /^\d+$/.test(value) ? Number(value) : NaN;
export function enquiryInput(value: EnquiryDraft) {
  const roomInput = (room: RoomDraft) => ({ mealPlan: room.mealPlan, occupancy: { adults: integer(room.adults), childAges: room.childAges.map(integer) } });
  const primary = roomInput(value.rooms[0]!);
  return {
    guest: { name: [value.firstName.trim(), value.lastName.trim()].filter(Boolean).join(" "), email: value.email.trim() || null, phone: value.phone.trim() || null, language: value.language },
    checkIn: value.checkIn, checkOut: value.checkOut, ...primary, note: value.note,
    details: { firstName: value.firstName, lastName: value.lastName, alternativeDates: value.alternativeDates, additionalRooms: value.rooms.slice(1).map(roomInput), consents: value.consents },
  };
}
export function enquiryFieldError(errors: Record<string, string>, path: string): string | undefined {
  return errors[path] ?? Object.entries(errors).find(([key]) => key.startsWith(path + "."))?.[1];
}

export function RoomGuestFields({ value, onChange, errors = {}, prefix = "", disabled = false }: {
  value: RoomDraft; onChange: (patch: Partial<RoomDraft>) => void; errors?: Record<string, string>; prefix?: string; disabled?: boolean;
}) {
  const [width, setWidth] = useState(0);
  return <View style={styles.fields} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <View style={[styles.row, width < 480 && styles.stacked]}>
      <View style={styles.column}><MealPlanField value={value.mealPlan} onChange={(mealPlan) => onChange({ mealPlan })} disabled={disabled} error={enquiryFieldError(errors, prefix + "mealPlan")} /></View>
      <View style={styles.column}><NumberSelectField label={t("Adults")} value={value.adults} onChange={(adults) => onChange({ adults })} disabled={disabled} error={enquiryFieldError(errors, prefix + "occupancy.adults")} /></View>
      <View style={styles.column}><ChildrenCountField value={value.childAges} onChange={(childAges) => onChange({ childAges })} disabled={disabled} /></View>
    </View>
    <ChildAgeFields value={value.childAges} onChange={(childAges) => onChange({ childAges })} disabled={disabled} error={enquiryFieldError(errors, prefix + "occupancy.childAges")} />
  </View>;
}

export function EnquiryFields({ value, onChange, errors = {}, disabled = false, staff = false, contactsVisible = true, noteHelper }: {
  value: EnquiryDraft; onChange: (value: EnquiryDraft) => void; errors?: Record<string, string>; disabled?: boolean; staff?: boolean; contactsVisible?: boolean; noteHelper?: string;
}) {
  const [width, setWidth] = useState(0);
  const patch = (change: Partial<EnquiryDraft>) => onChange({ ...value, ...change });
  const row = [styles.row, width < 480 && styles.stacked];
  const dateFields = (range: { checkIn: string; checkOut: string }, change: (next: typeof range) => void, prefix = "", alternate = 0) => <View style={row}>
    <View style={styles.column}><FilterDateField label={alternate ? t("Alternative {{v0}} check-in", { v0: alternate }) : t("Check-in")} value={range.checkIn} onChange={(checkIn) => change({ ...range, checkIn })} error={enquiryFieldError(errors, prefix + "checkIn")} disabled={disabled} /></View>
    <View style={styles.column}><FilterDateField label={alternate ? t("Alternative {{v0}} check-out", { v0: alternate }) : t("Check-out")} value={range.checkOut} onChange={(checkOut) => change({ ...range, checkOut })} error={enquiryFieldError(errors, prefix + "checkOut")} disabled={disabled} /></View>
  </View>;
  return <View style={styles.fields} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {contactsVisible ? <>
      <View style={row}>
        <View style={styles.column}><Field label={t("First name")} value={value.firstName} onChangeText={(firstName) => patch({ firstName })} autoComplete="given-name" textContentType="givenName" autoCapitalize="words" autoCorrect={false} maxLength={80} editable={!disabled} error={enquiryFieldError(errors, "details.firstName") ?? errors["guest.name"]} /></View>
        <View style={styles.column}><Field label={t("Last name")} value={value.lastName} onChangeText={(lastName) => patch({ lastName })} autoComplete="family-name" textContentType="familyName" autoCapitalize="words" autoCorrect={false} maxLength={80} editable={!disabled} error={enquiryFieldError(errors, "details.lastName")} /></View>
      </View>
      <View style={row}>
        <View style={styles.column}><Field label={t("Email")} value={value.email} onChangeText={(email) => patch({ email })} autoComplete="email" textContentType="emailAddress" keyboardType="email-address" inputMode="email" autoCapitalize="none" autoCorrect={false} maxLength={320} editable={!disabled} error={errors["guest.email"]} /></View>
        <View style={styles.column}><Field label={t("Phone / WhatsApp")} value={value.phone} onChangeText={(phone) => patch({ phone })} autoComplete="tel" textContentType="telephoneNumber" keyboardType="phone-pad" inputMode="tel" autoCapitalize="none" autoCorrect={false} maxLength={50} editable={!disabled} error={errors["guest.phone"]} helper={t("Include the country code, e.g. +39.")} /></View>
      </View>
    </> : null}
    {dateFields(value, (range) => patch(range))}
    {value.alternativeDates.map((range, index) => <View key={index} style={styles.fields}>
      <Button signalAction="ui.EnquiryFields.patch.press" signalPlacement="EnquiryFields.patch" variant="tertiary" icon={Minus} disabled={disabled} onPress={() => patch({ alternativeDates: value.alternativeDates.filter((_, i) => i !== index) })}>{t("Remove alternative dates")}{" "}{index + 1}</Button>
      {dateFields(range, (next) => patch({ alternativeDates: value.alternativeDates.map((current, i) => i === index ? next : current) }), `details.alternativeDates.${index}.`, index + 1)}
    </View>)}
    {value.alternativeDates.length < 3 ? <Button signalAction="ui.EnquiryFields.patch.press" signalPlacement="EnquiryFields.patch" variant="tertiary" icon={Plus} disabled={disabled} onPress={() => patch({ alternativeDates: [...value.alternativeDates, { checkIn: "", checkOut: "" }] })}>{t("Add alternative dates")}</Button> : null}
    {value.rooms.map((room, index) => <View key={index} style={styles.fields}>
      {index ? <View style={styles.roomHeading}><Text style={styles.label}>{t("Room {{v0}}", { v0: index + 1 })}</Text><Button signalAction="ui.EnquiryFields.patch.press" signalPlacement="EnquiryFields.patch" variant="tertiary" icon={Minus} disabled={disabled} onPress={() => patch({ rooms: value.rooms.filter((_, i) => i !== index) })}>{t("Remove room")}</Button></View> : null}
      <RoomGuestFields value={room} onChange={(change) => patch({ rooms: value.rooms.map((current, i) => i === index ? { ...current, ...change } : current) })} errors={errors} prefix={index ? `details.additionalRooms.${index - 1}.` : ""} disabled={disabled} />
    </View>)}
    {value.rooms.length < 6 ? <Button signalAction="ui.EnquiryFields.patch.press" signalPlacement="EnquiryFields.patch" variant="tertiary" icon={Plus} disabled={disabled} onPress={() => patch({ rooms: [...value.rooms, { mealPlan: null, adults: "2", childAges: [] }] })}>{t("Add room")}</Button> : null}
    <Field label={t("Message (optional)")} value={value.note} onChangeText={(note) => patch({ note })} error={errors.note} helper={noteHelper} autoComplete="off" multiline numberOfLines={4} maxLength={2000} style={styles.message} editable={!disabled} />
    {contactsVisible ? <GuestLanguageField value={value.language} onChange={(language) => patch({ language })} error={errors["guest.language"]} disabled={disabled} /> : null}
    <ConsentField label={staff ? t("Guest agreed to receive offers and news") : t("I agree to receive offers and news (optional)")} checked={value.consents.marketing} onChange={(marketing) => patch({ consents: { ...value.consents, marketing } })} disabled={disabled} />
    <ConsentField label={staff ? t("Guest consented to data processing") : t("I consent to the processing of my data")} checked={value.consents.privacy} onChange={(privacy) => patch({ consents: { ...value.consents, privacy } })} disabled={disabled} />
    <Pressable signalAction="ui.EnquiryFields.control.press" signalPlacement="EnquiryFields.control" accessibilityRole="link" onPress={() => { void Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL ? new URL(process.env.EXPO_PUBLIC_API_URL).origin : "https://ospio.online"}/privacy.html`); }}><Text style={styles.link}>{t("Privacy Policy")}</Text></Pressable>
    {enquiryFieldError(errors, "details.consents") ? <Text accessibilityRole="alert" style={styles.error}>{enquiryFieldError(errors, "details.consents")}</Text> : null}
    {staff ? <Text style={styles.hint}>{t("Record only consent the guest actually provided.")}</Text> : null}
    {value.rooms.length > 1 || value.alternativeDates.length ? <Text style={styles.hint}>{t("Requests with multiple rooms or alternative dates are saved for staff review before an offer is sent.")}</Text> : null}
  </View>;
}

function ConsentField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return <Pressable signalAction="ui.ConsentField.onChange.press" signalPlacement="ConsentField.onChange" accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => onChange(!checked)} style={styles.consent}>
    <View style={[styles.checkbox, checked && styles.checked]}>{checked ? <Check size={16} color={theme.colors.onAction} /> : null}</View><Text style={styles.consentText}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  fields: { gap: theme.spacing[4] }, row: { flexDirection: "row", gap: theme.spacing[3] }, stacked: { flexDirection: "column" }, column: { flex: 1, minWidth: 0 },
  roomHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3] }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  message: { minHeight: 112, paddingTop: theme.spacing[3], textAlignVertical: "top" }, consent: { flexDirection: "row", gap: theme.spacing[3], alignItems: "center", minHeight: 44 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.borderStrong, alignItems: "center", justifyContent: "center" }, checked: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  consentText: { ...theme.typography.bodySmall, color: theme.colors.text, flex: 1 }, link: { ...theme.typography.bodySmallMedium, color: theme.colors.action, textDecorationLine: "underline" }, hint: { ...theme.typography.caption, color: theme.colors.textSecondary }, error: { ...theme.typography.caption, color: theme.colors.danger },
});
