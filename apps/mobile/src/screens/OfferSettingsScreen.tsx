import { t, translateLabel } from "../i18n";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ArrowLeft, Plus } from "lucide-react-native";
import { offerSettingsSchema, type ExtraChargeMode, type OfferExtra, type OfferSettings } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { apiClient } from "../api/client";
import { Button, Field, InlineState, uiStyles } from "../components/ui";
import { actionStyles } from "../components/actionStyles";
import { extraChargeLabels, newOfferKey, offerMoney } from "../requests/offer-format";
import { priceCents } from "../requests/offer-input";

type ExtraDraft = OfferExtra & { price: string };
export function OfferSettingsScreen({ demo, currency, onBack }: { demo: boolean; currency: string; onBack: () => void }) {
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [deposit, setDeposit] = useState("30");
  const [policy, setPolicy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const apply = (value: OfferSettings) => { setExtras(value.extras.map((extra) => ({ ...extra, price: (extra.unitPriceCents / 100).toFixed(2) }))); setDeposit(String(value.defaultDepositPercent)); setPolicy(value.cancellationPolicy); };
  useEffect(() => {
    let active = true; setLoading(true); setError(null);
    void apiClient.getOfferSettings({ demo }).then((value) => { if (active) { apply(value); setLoaded(true); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("Could not load extras.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, reload]);
  const update = (id: string, patch: Partial<ExtraDraft>) => { setSaved(false); setExtras((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); };
  const save = async () => {
    const result = offerSettingsSchema.safeParse({ extras: extras.map(({ price, ...extra }) => ({ ...extra, unitPriceCents: priceCents(price) })), defaultDepositPercent: deposit.trim() ? Number(deposit.replace(",", ".")) : NaN, cancellationPolicy: policy });
    if (!result.success) { setError("Enter a name and valid price for every extra, and a deposit from 0 to 100%."); return; }
    setSaving(true); setError(null); setSaved(false);
    try { apply(await apiClient.saveOfferSettings(result.data, { demo })); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save offer settings.")); }
    finally { setSaving(false); }
  };
  return <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.heading}><Pressable accessibilityRole="button" accessibilityLabel={t("Back to Settings")} onPress={onBack} style={actionStyles.iconButton}><ArrowLeft size={20} color={theme.colors.text} /></Pressable><Text accessibilityRole="header" style={styles.title}>{t("Extras & offer defaults")}</Text></View>
    <Text style={styles.hint}>{t("Create services once and select them in any offer. Their charges are added automatically; sent offers keep their original prices and terms.")}</Text>
    {loading ? <ActivityIndicator color={theme.colors.action} /> : <View pointerEvents={saving ? "none" : "auto"} style={styles.section}>
      <View style={styles.card}><Text style={styles.subTitle}>{t("Offer defaults")}</Text><Text style={styles.hint}>{t("Website requests send automatically. A guest note holds the request for staff review.")}</Text><Field label={t("Default deposit (%)")} value={deposit} onChangeText={(value) => { setDeposit(value); setSaved(false); }} keyboardType="decimal-pad" /><Field label={t("Default cancellation policy")} value={policy} onChangeText={(value) => { setPolicy(value); setSaved(false); }} multiline numberOfLines={4} maxLength={4000} /></View>
      <Text accessibilityRole="header" style={styles.subTitle}>{t("Extras ·")}{" "}{extras.length}/50</Text>
      {extras.map((extra, index) => <View key={extra.id} style={styles.card}>
        <View style={styles.heading}><Text style={styles.subTitle}>{extra.name || t("New extra {{v0}}", { v0: index + 1 })}</Text><Switch accessibilityLabel={t("Extra {{v0}} available", { v0: index + 1 })} value={extra.active} onValueChange={(active) => update(extra.id, { active })} trackColor={{ true: theme.colors.action }} /></View>
        <Field label={t("Extra {{v0}} name", { v0: index + 1 })} value={extra.name} onChangeText={(name) => update(extra.id, { name })} maxLength={160} />
        <Field label={t("Extra {{v0}} description", { v0: index + 1 })} value={extra.description} onChangeText={(description) => update(extra.id, { description })} multiline maxLength={1000} />
        <Field label={t("Extra {{v0}} price ({{v1}})", { v0: index + 1, v1: currency })} value={extra.price} onChangeText={(price) => update(extra.id, { price })} keyboardType="decimal-pad" helper={t("Price for one unit, based on the charging method below.")} />
        <View style={styles.choices}>{(Object.keys(extraChargeLabels) as ExtraChargeMode[]).map((chargeMode) => <Pressable key={chargeMode} accessibilityRole="radio" accessibilityLabel={t("Extra {{v0}}: {{v1}}", { v0: index + 1, v1: t(extraChargeLabels[chargeMode]) })} accessibilityState={{ checked: extra.chargeMode === chargeMode }} onPress={() => update(extra.id, { chargeMode })} style={[styles.choice, extra.chargeMode === chargeMode && styles.selected]}><Text style={styles.body}>{translateLabel(extraChargeLabels[chargeMode])}</Text></Pressable>)}</View>
        <View style={styles.heading}><View style={styles.grow}><Text style={styles.body}>{t("Include by default")}</Text><Text style={styles.hint}>{t("Added to automatic offers; staff can remove it.")}</Text></View><Switch accessibilityLabel={t("Extra {{v0}} include by default", { v0: index + 1 })} value={extra.defaultSelected} onValueChange={(defaultSelected) => update(extra.id, { defaultSelected })} trackColor={{ true: theme.colors.action }} /></View>
        <Text style={styles.hint}>{extra.active ? t("Available") : t("Hidden from new offers")} · {Number.isFinite(priceCents(extra.price)) ? offerMoney(priceCents(extra.price), currency) : t("Enter a price")} · {translateLabel(extraChargeLabels[extra.chargeMode])}</Text>
        <Button variant="tertiary" onPress={() => { setExtras((items) => items.filter(({ id }) => id !== extra.id)); setSaved(false); }}>{t("Remove extra")}{" "}{index + 1}</Button>
      </View>)}
      <Button icon={Plus} variant="secondary" disabled={extras.length >= 50} onPress={() => { setExtras((items) => [...items, { id: newOfferKey(), name: "", description: "", unitPriceCents: 0, price: "", chargeMode: "per_stay", active: true, defaultSelected: false }]); setSaved(false); }}>{t("Add extra")}</Button>
    </View>}
    {error ? <><InlineState tone="danger">{translateLabel(error)}</InlineState>{!extras.length && !loading ? <Button variant="tertiary" onPress={() => setReload((value) => value + 1)}>{t("Reload settings")}</Button> : null}</> : null}
    {saved ? <InlineState tone="success">{demo ? t("Offer settings saved in this demo.") : t("Offer settings saved. New offers will use these prices and defaults.")}</InlineState> : null}
    {demo ? <Text style={styles.hint}>{t("Demo mode · changes stay in this preview.")}</Text> : null}
    <Button loading={saving} disabled={loading || !loaded} onPress={() => void save()}>{t("Save extras & defaults")}</Button>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: theme.controls.contentInset, paddingBottom: theme.spacing[8], gap: theme.spacing[5], width: "100%", maxWidth: 860, alignSelf: "center" }, title: { ...theme.typography.h3, color: theme.colors.text, flex: 1 }, subTitle: { ...theme.typography.h4, color: theme.colors.text, flexShrink: 1 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3] }, section: { gap: theme.spacing[4] }, card: { padding: theme.spacing[4], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, gap: theme.spacing[4] },
  body: { ...theme.typography.bodySmall, color: theme.colors.text }, hint: { ...theme.typography.bodySmall, color: theme.colors.textSecondary }, grow: { flex: 1 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] }, choice: { padding: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, minHeight: theme.controls.minTarget }, selected: { backgroundColor: theme.colors.actionTint, borderColor: theme.colors.action },
});
