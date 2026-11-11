import { t, translateLabel } from "../i18n";
import { StyleSheet, Text, View } from "react-native";
import type { OfferQuote, ReservationOffer } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { extraChargeLabels, offerMoney } from "./offer-format";

export function OfferDetails({ offer, compact = false }: { offer: ReservationOffer | OfferQuote; compact?: boolean }) {
  const occupancy = offer.occupancy;
  if (compact) return <View style={styles.content}>
    <Text style={styles.body}>{offer.planName} · {offer.mealPlan ?? t("Board needed")}</Text>
    {offer.extras?.length ? <Text style={styles.hint}>{t("Extras")}: {offer.extras.map(({ name }) => name).join(", ")}</Text> : null}
    <View style={styles.total}><Text style={styles.strong}>{t("Total")}</Text><Text selectable style={styles.price}>{offerMoney(offer.totalCents, offer.currency)}</Text></View>
  </View>;
  return <View style={styles.content}>
    {offer.checkIn && offer.checkOut ? <Text selectable style={styles.body}>{offer.checkIn} — {offer.checkOut} · {(Date.parse(offer.checkOut) - Date.parse(offer.checkIn)) / 86400000} {" "}{t("nights")}</Text> : null}
    <Text style={styles.body}>{occupancy ? t("{{v0}} adults{{v1}} · ", { v0: occupancy.adults, v1: occupancy.childAges.length ? t(" · children aged {{v0}}", { v0: occupancy.childAges.join(", ") }) : "" }) : ""}{offer.mealPlan ?? t("Board needed")}</Text>
    <Text style={styles.body}>{offer.planName}</Text>
    {offer.description ? <Text selectable style={styles.hint}>{offer.description}</Text> : null}
    {offer.accommodationCents !== undefined ? <PriceRow label={t("Accommodation & board")} cents={offer.accommodationCents} currency={offer.currency} /> : null}
    {(offer.extras ?? []).map((extra) => <View key={extra.id} style={styles.extra}>
      <PriceRow label={extra.name} cents={extra.totalCents} currency={offer.currency} />
      <Text style={styles.hint}>{offerMoney(extra.unitPriceCents, offer.currency)} · {translateLabel(extraChargeLabels[extra.chargeMode])} · ×{extra.quantity}</Text>
      {extra.description ? <Text style={styles.hint}>{extra.description}</Text> : null}
    </View>)}
    {!offer.extras?.length ? <Text style={styles.hint}>{t("Extras: none selected")}</Text> : null}
    {offer.discountPercent ? <PriceRow label={t("Discount ({{v0}}%)", { v0: offer.discountPercent })} cents={-(offer.discountCents ?? 0)} currency={offer.currency} /> : null}
    <View style={styles.total}><Text style={styles.strong}>{t("Total stay")}</Text><Text selectable style={styles.price}>{offerMoney(offer.totalCents, offer.currency)}</Text></View>
    {offer.depositPercent !== undefined ? <PriceRow label={t("Deposit ({{v0}}%)", { v0: offer.depositPercent })} cents={offer.depositCents ?? 0} currency={offer.currency} /> : null}
    {offer.cancellationPolicy ? <View style={styles.extra}><Text style={styles.strong}>{t("Cancellation policy")}</Text><Text selectable style={styles.hint}>{offer.cancellationPolicy}</Text></View> : null}
    {offer.note ? <View style={styles.extra}><Text style={styles.strong}>{t("Guest note")}</Text><Text selectable style={styles.body}>{offer.note}</Text></View> : null}
  </View>;
}
function PriceRow({ label, cents, currency }: { label: string; cents: number; currency: string }) {
  return <View style={styles.row}><Text style={[styles.body, styles.grow]}>{label}</Text><Text selectable style={styles.body}>{offerMoney(cents, currency)}</Text></View>;
}
const styles = StyleSheet.create({
  content: { gap: theme.spacing[2] }, body: { ...theme.typography.bodySmall, color: theme.colors.text }, hint: { ...theme.typography.caption, color: theme.colors.textSecondary }, strong: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  price: { ...theme.typography.h3, color: theme.colors.text }, row: { flexDirection: "row", gap: theme.spacing[3], justifyContent: "space-between" }, grow: { flex: 1 }, extra: { gap: theme.spacing[1] }, total: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3], borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.spacing[3], marginTop: theme.spacing[2] },
});
