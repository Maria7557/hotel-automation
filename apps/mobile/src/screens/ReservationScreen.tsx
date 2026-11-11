import { t, translateLabel } from "../i18n";
import { requestLabel } from "../requests/status";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, CopyPlus, Plus } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient } from "@/api/client";
import type { HotelRequest } from "@/api/types";
import { RequestCard } from "@/components/RequestCard";
import { actionStyles } from "@/components/actionStyles";
import { PaymentLinkSentAction } from "@/components/PaymentLinkSentAction";
import { Button, EmptyState, InlineState, uiStyles } from "@/components/ui";
import { ReservationOffers } from "../requests/ReservationOffers";
import { ManualRequestModal } from "../requests/ManualRequestModal";

export function ReservationScreen({ id, demo, onBack, onOpenClient, onOpenRequest, onChanged }: { id: string; demo: boolean; onBack: () => void; onOpenClient: (id: string) => void; onOpenRequest: (id: string) => void; onChanged: () => void }) {
  const [request, setRequest] = useState<HotelRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [duplicating, setDuplicating] = useState(false);
  const [createOfferSignal, setCreateOfferSignal] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void apiClient.getRequest(id, { demo }).then((value) => { if (active) setRequest(value); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : t("Could not load request.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, demo, reload]);
  useEffect(() => {
    const deadline = Date.parse(request?.processingDeadlineAt ?? "");
    if (request?.status !== "new" || !Number.isFinite(deadline)) return;
    const timer = setTimeout(() => setReload((value) => value + 1), Math.max(250, deadline - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [request?.id, request?.status, request?.processingDeadlineAt]);
  const markSent = async () => {
    if (!request) return;
    setSaving(true); setError(null);
    try {
      await apiClient.markPaymentLinkSent(id, { demo });
      const { nextAction: _next, ...rest } = request;
      const completed: HotelRequest = { ...rest, status: "completed", statusLabel: requestLabel("completed"), paymentLinkSentAt: new Date().toISOString() };
      setRequest(completed); onChanged();
    } catch { setError("Could not mark the payment link as sent. Try again."); }
    finally { setSaving(false); }
  };
  return <><ScrollView style={uiStyles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && !!request} onRefresh={() => setReload((value) => value + 1)} tintColor={theme.colors.action} />}>
    <View style={styles.heading}><Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={onBack} style={styles.back}><ArrowLeft size={theme.controls.actionIconSize} color={theme.colors.text} /></Pressable><Text selectable accessibilityRole="header" style={styles.title}>{t("Request")}{request ? ` #${request.reservationNumber}` : ""}</Text>{request ? <View style={styles.actions}><Button variant="create" icon={Plus} disabled={loading || saving || !!request.acceptedAt || request.status === "payment" || request.status === "completed"} onPress={() => setCreateOfferSignal((value) => value + 1)}>{request.offers?.length ? t("Edit offers") : t("Create offer")}</Button><Button variant="tertiary" icon={CopyPlus} disabled={loading || saving} onPress={() => setDuplicating(true)}>{t("Duplicate")}</Button></View> : null}</View>
    {loading && !request ? <ActivityIndicator color={theme.colors.action} /> : null}
    {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
    {!loading && !request ? <><EmptyState title={t("Request unavailable")} description={t("Try again or go back to the request list.")} /><Button onPress={() => setReload((value) => value + 1)}>{t("Try again")}</Button></> : null}
    {request ? <RequestCard request={request} demo={demo} onOpenClient={onOpenClient} variant="page" onManualSent={(updated) => { setRequest(updated); onChanged(); }}>{request.status === "payment" ? <PaymentLinkSentAction busy={saving} onPress={() => void markSent()} /> : null}</RequestCard> : null}
    {request ? <ReservationOffers request={request} demo={demo} createSignal={createOfferSignal} onSent={(updated) => { setRequest(updated); onChanged(); }} /> : null}
  </ScrollView>{duplicating && request ? <ManualRequestModal demo={demo} initialRequest={request} onClose={() => setDuplicating(false)} onCreated={(result) => { setDuplicating(false); onChanged(); onOpenRequest(result.inquiryId); }} /> : null}</>;
}
const styles = StyleSheet.create({
  content: { padding: theme.controls.contentInset, paddingBottom: theme.spacing[8], gap: theme.spacing[6] }, heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.controls.actionGap }, back: { ...actionStyles.iconButton }, title: { ...theme.typography.h3, color: theme.colors.text, flex: 1, minWidth: 160 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], justifyContent: "flex-end", flexShrink: 1, marginLeft: "auto" },
});
