import { t, translateLabel, locale } from "../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ArrowRight, ArrowUpRight, Baby, BedDouble, Check, ChevronDown, ChevronUp, CircleAlert, Clock, Copy, CreditCard, Inbox, Info, Languages, Mail, MessageCircle, Minus, UserRound, Users, X, type LucideIcon } from "lucide-react-native";
import { theme, type StatusColors } from "@hotel/design";
import { apiClient } from "@/api/client";
import type { DeliverySummary, HotelRequest, OfferShareMessage } from "@/api/types";
import { DetailLink } from "./DetailLink";
import { BoardBadge } from "./BoardBadge";
import { StatusPill } from "./StatusPill";
import { Tooltip } from "./Tooltip";
import { actionStyles } from "./actionStyles";
import { RequestClientStatus, useRequestClient } from "./RequestClientStatus";
import { requestAppearance, requestSendingDetails, requestStatusHelp } from "../requests/status";
import { contactUrl, formatOccupancyParts, formatPaymentLinkWait, formatStay, formatTimestamp, requestWait } from "../requests/presentation";
import { requestSourceLabels } from "../requests/sources";

type Props = {
  request: HotelRequest;
  demo?: boolean;
  onOpen?: () => void;
  onOpenClient: (clientId: string) => void;
  variant?: "card" | "page";
  onManualSent?: (request: HotelRequest) => void;
  children?: ReactNode;
};

export function RequestCard({ request, demo = false, onOpen, onOpenClient, variant = "card", onManualSent, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isPage = variant === "page";
  const { status, clientId } = useRequestClient(request.id);
  const appearance: StatusColors = requestAppearance(request);
  const sendingDetails = requestSendingDetails(request);
  const occupancy = formatOccupancyParts(request);
  const wait = requestWait(request);
  const selectable = !onOpen;
  const textPointerEvents = selectable ? "auto" : "none";
  const additional = isPage ? <View pointerEvents={textPointerEvents} style={styles.additional}>
    <View style={styles.sectionHeading}><Info size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t("More")}</Text></View>
    <View style={[styles.additionalDetails, styles.detailsInset]}>
      <AdditionalDetail icon={Inbox} tooltip={t("When the guest’s request arrived.")}><Text selectable={selectable} style={styles.caption}>{t("Received")}{" "}{formatTimestamp(request.receivedAt)}</Text></AdditionalDetail>
      {request.receivedVia ? <AdditionalDetail icon={Inbox}><Text selectable={selectable} style={styles.caption}>{t("Received via ·")}{" "}{t(requestSourceLabels[request.receivedVia])}</Text></AdditionalDetail> : null}
      {request.occupancy.childAges.length ? <AdditionalDetail icon={Baby}><Text selectable={selectable} style={styles.caption}>{t("Children’s ages:")}{" "}{request.occupancy.childAges.join(", ")}</Text></AdditionalDetail> : null}
      {request.note ? <AdditionalDetail icon={MessageCircle}><Text selectable={selectable} style={styles.text}>{t("Guest note:")}{" "}{request.note}</Text></AdditionalDetail> : null}
      {request.locale ? <AdditionalDetail icon={Languages}><Text selectable={selectable} style={styles.caption}>{t("Guest language:")}{" "}{request.locale}</Text></AdditionalDetail> : null}
      {request.offerExpiresAt ? <AdditionalDetail icon={Clock}><Text selectable={selectable} style={styles.caption}>{t("Offer expires:")}{" "}{formatTimestamp(request.offerExpiresAt)}</Text></AdditionalDetail> : null}
      {request.acceptedAt ? <AdditionalDetail icon={Check} tooltip={t("When the guest accepted the offer.")}><Text selectable={selectable} style={styles.caption}>{t("Accepted:")}{" "}{formatTimestamp(request.acceptedAt)}</Text></AdditionalDetail> : null}
      {request.paymentLinkSentAt ? <AdditionalDetail icon={CreditCard}><Text selectable={selectable} style={styles.caption}>{t("Payment link marked sent:")}{" "}{formatTimestamp(request.paymentLinkSentAt)}</Text></AdditionalDetail> : null}
      {request.attentionReason ? <AdditionalDetail icon={CircleAlert}><Text selectable={selectable} style={styles.error}>{t("Issue:")}{" "}{request.attentionReason.replace(/_/g, " ").toLowerCase()}</Text></AdditionalDetail> : null}
      {([request.email, request.whatsapp]).map((delivery, index) => delivery.lastErrorCode ? <AdditionalDetail key={index} icon={CircleAlert}><Text selectable={selectable} style={styles.error}>{index ? "WhatsApp" : t("Email")}: {delivery.lastErrorCode.replace(/_/g, " ").toLowerCase()}</Text></AdditionalDetail> : null)}
      {request.nextAction ? <AdditionalDetail icon={ArrowRight} tooltip={request.nextAction === "Review availability" ? t("Check room availability for these dates before sending a payment link.") : undefined}><Text selectable={selectable} style={styles.nextAction}>{t("Next:")}{" "}{translateLabel(request.nextAction)}</Text></AdditionalDetail> : null}
    </View>
  </View> : null;
  return <View style={isPage ? styles.page : [styles.card, { borderLeftColor: appearance.color }]}>
    {/* A sibling link covers the card. Controls above it stay independent, without nested links. */}
    {onOpen ? <DetailLink kind="reservation" id={request.id} label={t("Request #{{v0}} details", { v0: request.reservationNumber })} onOpen={onOpen} style={({ pressed }) => [StyleSheet.absoluteFill, styles.cardLink, pressed && styles.cardLinkActive]}>{null}</DetailLink> : null}
    <View pointerEvents="box-none" style={isPage ? styles.pageContent : styles.content}>
      {isPage ? <View style={styles.sectionHeading}><BedDouble size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t("Request")}</Text></View> : null}
      <View pointerEvents="box-none" style={styles.summary}>
        <View pointerEvents={textPointerEvents} style={request.mealPlan ? styles.boardSlot : undefined}><BoardBadge mealPlan={request.mealPlan} selectable={selectable} /></View>
        <View pointerEvents="box-none" style={styles.stayDetails}>
          <View pointerEvents={textPointerEvents} style={styles.stayCopy}>
            <Text selectable={selectable} style={styles.stayText}>{formatStay(request.checkIn, request.checkOut)} · {occupancy.nights}{" "}<Text style={styles.nightUnit}>{occupancy.nights === 1 ? t("night") : t("nights")}</Text> ·</Text>
            <View accessible accessibilityLabel={`${occupancy.people} ${occupancy.people === 1 ? t("person") : t("people")}`} style={styles.peopleCount}>
              <Text selectable={selectable} style={styles.stayText}>{occupancy.people}</Text>
              <Users aria-hidden size={theme.controls.helperIconSize} color={theme.colors.text} />
            </View>
            {isPage || request.occupancy.childAges.length > 0 ? <Text selectable={selectable} style={styles.text}>{occupancy.breakdown}</Text> : null}
          </View>
          <CopyValue value={request.reservationNumber} label={t("Request number")} display={`#${request.reservationNumber}`} selectable={selectable} />
          {isPage ? <View style={styles.statusSummary}><Text selectable style={styles.statusLabel}>{t("Status")}</Text><StatusPill label={translateLabel(request.statusLabel)} appearance={appearance} selectable={selectable} /></View> : null}
          {wait ? <WaitPill since={wait.since} description={wait.description} selectable={selectable} /> : null}
          {!isPage ? <RequestStatusDot label={translateLabel(request.statusLabel)} description={requestStatusHelp(request)} appearance={appearance} /> : null}
        </View>
        <View pointerEvents={textPointerEvents} style={styles.priceWrap}><Text selectable={selectable} style={styles.price}>{request.totalLabel === "—" ? "—" : new Intl.NumberFormat(locale(), { style: "currency", currency: request.currency }).format(request.totalCents / 100)}</Text></View>
      </View>
      <View pointerEvents="box-none" style={[styles.row, styles.detailsInset]}>
        <View pointerEvents={textPointerEvents} style={styles.entityLine}><BedDouble size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable={selectable} style={styles.text}>{request.roomLabel === "No offer created" ? t("No offer created") : request.roomLabel}</Text></View>
      </View>
      {sendingDetails.length ? <View pointerEvents={textPointerEvents} style={[styles.sendingDetails, styles.detailsInset]}>
        {sendingDetails.map(({ channel, label }) => {
          const Icon = channel === "email" ? Mail : channel === "whatsapp" ? MessageCircle : Clock;
          return <View key={channel ?? "sending"} style={styles.row}>
            <Icon size={theme.controls.helperIconSize} style={actionStyles.helperIcon} color={theme.colors.textMuted} />
            <Text selectable={selectable} style={styles.sendingLabel}>{channel ? `${channel === "email" ? t("Email") : "WhatsApp"} · ` : ""}{translateLabel(label)}</Text>
          </View>;
        })}
      </View> : null}
      {isPage ? <View style={[styles.sectionHeading, styles.clientHeading]}><UserRound size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t("Client")}</Text></View> : null}
      <View pointerEvents="box-none" style={[styles.nameRow, styles.detailsInset]}>
        <View pointerEvents="box-none" style={styles.clientDetails}>
          <View pointerEvents="box-none" style={styles.inline}>
            <View pointerEvents="box-none" style={styles.nameValue}>
            <View pointerEvents="none"><UserRound size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /></View>
            {status === "present" && clientId ? <DetailLink kind="client" id={clientId} label={t("View client {{v0}}", { v0: request.guestName })} onOpen={() => onOpenClient(clientId)} style={styles.nameButton}><Text selectable={selectable} style={styles.nameLink}>{request.guestName}</Text></DetailLink> : <View pointerEvents={textPointerEvents}><Text selectable={selectable} style={styles.name}>{request.guestName}</Text></View>}
            {isPage || expanded ? <CopyValue value={request.guestName} label={t("Client name")} iconOnly /> : null}
            </View>
            {!isPage ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t("Hide contact details") : t("Show contact details")} accessibilityState={{ expanded }} onPress={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
              {expanded ? <ChevronUp size={theme.controls.actionIconSize} color={theme.colors.textMuted} /> : <ChevronDown size={theme.controls.actionIconSize} color={theme.colors.textMuted} />}
            </Pressable> : null}
          </View>
          {status !== "present" && status !== "loading" ? <RequestClientStatus inquiryId={request.id} /> : null}
        </View>
      </View>
      {isPage || expanded ? <View pointerEvents="box-none" style={[styles.contacts, isPage && styles.pageContacts, isPage && styles.detailsInset]}>
        <ContactDetail channel="email" detail={request.email} selectable={selectable} offerContext={request.currentOfferId ? { inquiryId: request.id, demo, language: request.locale?.toLowerCase().startsWith("en") ? "en" : "it", offers: request.offers ?? [], onManualSent } : undefined} />
        <ContactDetail channel="whatsapp" detail={request.whatsapp} selectable={selectable} offerContext={request.currentOfferId ? { inquiryId: request.id, demo, language: request.locale?.toLowerCase().startsWith("en") ? "en" : "it", offers: request.offers ?? [], onManualSent } : undefined} />
      </View> : null}
      {additional}
      {children}
    </View>
  </View>;
}

function RequestStatusDot({ label, description, appearance }: { label: string; description: string; appearance: StatusColors }) {
  return <Tooltip content={`${label}. ${description}`}>{({ triggerProps, visible, toggle }) => <Pressable
    {...triggerProps}
    accessibilityRole="button"
    accessibilityLabel={t("Status: {{v0}}", { v0: label })}
    accessibilityHint={translateLabel(description)}
    accessibilityState={{ expanded: visible }}
    hitSlop={theme.controls.helperHitSlop}
    onPress={(event) => { event.stopPropagation(); toggle(); }}
    style={styles.statusDotTrigger}
  >
    <View aria-hidden pointerEvents="none" style={[styles.statusDot, { borderColor: appearance.color, backgroundColor: appearance.backgroundColor }]} />
  </Pressable>}</Tooltip>;
}

function AdditionalDetail({ icon: Icon, children, tooltip }: { icon: LucideIcon; children: ReactNode; tooltip?: string | undefined }) {
  const detail = <>
    <Icon size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} />
    {children}
  </>;
  return tooltip ? <View style={styles.additionalHint}><Tooltip content={tooltip}>{({ triggerProps, visible, toggle }) => <Pressable
    {...triggerProps}
    accessibilityRole="button"
    accessibilityState={{ expanded: visible }}
    onPress={(event) => { event.stopPropagation(); toggle(); }}
    style={styles.additionalRow}
  >{detail}</Pressable>}</Tooltip></View> : <View style={styles.additionalRow}>{detail}</View>;
}

function WaitPill({ since, description, selectable }: { since: string; description: string; selectable: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!Number.isFinite(Date.parse(since))) return;
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [since]);
  const label = formatPaymentLinkWait(since, now);
  return label ? <Tooltip content={translateLabel(description)}>{({ triggerProps, visible, toggle }) => <Pressable
    {...triggerProps}
    accessibilityRole="button"
    accessibilityLabel={`${description}: ${label}`}
    accessibilityState={{ expanded: visible }}
    hitSlop={theme.controls.helperHitSlop}
    onPress={(event) => { event.stopPropagation(); toggle(); }}
  >
    <StatusPill label={translateLabel(label)} icon={<Clock size={theme.controls.helperIconSize} color={theme.colors.textMuted} />} tone="neutral" selectable={selectable} />
  </Pressable>}</Tooltip> : null;
}

export function CopyValue({ value, label, display = value, iconOnly = false, selectable = false }: { value: string; label: string; display?: string; iconOnly?: boolean; selectable?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 3_000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try { setState(await Clipboard.setStringAsync(value) ? "copied" : "failed"); }
    catch { setState("failed"); }
  };
  const title = label.charAt(0).toUpperCase() + label.slice(1);
  return <View pointerEvents="box-none" style={styles.copyWrap}>
    <View pointerEvents="box-none" style={styles.copyRow}>
      {selectable && !iconOnly ? <Text selectable style={styles.text}>{display}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={state === "copied" ? t("{{v0}} copied", { v0: title }) : t("Copy {{v0}}: {{v1}}", { v0: label.toLowerCase(), v1: value })} hitSlop={theme.controls.helperHitSlop} onPress={(event) => { event.stopPropagation(); void copy(); }} style={({ pressed }) => [styles.copy, (iconOnly || selectable) && styles.copyIconOnly, pressed && styles.pressed]}>
        {!selectable && !iconOnly ? <Text style={styles.text}>{display}</Text> : null}
        <View pointerEvents="none" style={actionStyles.helperIconButton}>{state === "copied" ? <Check size={theme.controls.helperIconSize} color={theme.colors.success} /> : <Copy size={theme.controls.helperIconSize} color={theme.colors.helperIcon} />}</View>
      </Pressable>
    </View>
    {state !== "idle" ? <Text pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.caption, state === "failed" && styles.error]}>{state === "copied" ? t("Copied") : t("Could not copy. Try again.")}</Text> : null}
  </View>;
}

type OfferContext = { inquiryId: string; demo: boolean; language: "en" | "it"; offers: NonNullable<HotelRequest["offers"]>; onManualSent?: ((request: HotelRequest) => void) | undefined };

export function ContactDetail({ channel, detail, showDeliveryStatus = true, selectable = false, offerContext }: { channel: "email" | "whatsapp"; detail: DeliverySummary; showDeliveryStatus?: boolean; selectable?: boolean; offerContext?: OfferContext }) {
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const label = channel === "email" ? t("Email") : "WhatsApp";
  const Icon = channel === "email" ? Mail : MessageCircle;
  const url = contactUrl(channel, detail.recipient);
  const send = async () => {
    if (!url) return;
    setError(null);
    if (offerContext) {
      setPreviewOpen(true);
      return;
    }
    try {
      await Linking.openURL(url);
    } catch { setError(t("Could not open {{v0}}. Copy the contact and try again.", { v0: label })); }
  };
  const delivery = {
    sent: { label: t("Sent"), Icon: Check, color: theme.colors.success },
    pending: { label: t("Pending"), Icon: Clock, color: theme.colors.warning },
    failed: { label: t("Failed"), Icon: CircleAlert, color: theme.colors.danger },
    unused: { label: t("Not sent"), Icon: Minus, color: theme.colors.textMuted },
  }[detail.status];
  const DeliveryIcon = delivery.Icon;
  const processedAt = detail.processedAt ? formatTimestamp(detail.processedAt) : null;
  const deliveryText = detail.status === "sent" && processedAt
    ? processedAt
    : `${delivery.label}${processedAt ? ` · ${processedAt}` : ""}`;
  const deliveryHelp = detail.status === "sent"
    ? t("The offer was sent through {{v0}}. The time shows when sending was processed, not when the guest read it.", { v0: label })
    : detail.status === "pending"
      ? t("The offer is awaiting automatic sending through {{v0}}. It is queued, processing, waiting for a connection, or scheduled for an automatic retry. Sending is expected to complete automatically when the channel is ready; check the connection if it stays unavailable.", { v0: label })
      : detail.status === "failed"
        ? t("Automatic sending through {{v0}} stopped or its outcome could not be confirmed. Check the delivery issue before resending. The time shows the last processed attempt.", { v0: label })
        : t("No offer was sent through {{v0}} for this request.", { v0: label });
  return <View pointerEvents="box-none" style={styles.contact}>
    <View pointerEvents="box-none" style={styles.contactRow}>
      <View pointerEvents="box-none" style={styles.contactValue}>
        <View pointerEvents="none" style={actionStyles.icon}><Icon size={theme.controls.actionIconSize} color={theme.colors.textMuted} /></View>
        {detail.recipient ? <CopyValue value={detail.recipient} label={translateLabel(label)} selectable={selectable} /> : <View pointerEvents={selectable ? "auto" : "none"}><Text selectable={selectable} style={styles.caption}>{t("No")}{" "}{label.toLowerCase()} {" "}{t("provided")}</Text></View>}
      </View>
      {url ? <Pressable accessibilityRole="button" accessibilityLabel={offerContext ? t("Preview offer for {{v0}}", { v0: label }) : t("Open {{v0}} for {{v1}}", { v0: label, v1: detail.recipient ?? "" })} onPress={(event) => { event.stopPropagation(); void send(); }} style={({ pressed }) => [styles.send, pressed && styles.pressed]}><Text style={styles.link}>{offerContext ? t("Preview") : label}</Text><ArrowUpRight size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.action} /></Pressable> : null}
    </View>
    {showDeliveryStatus ? <View pointerEvents="box-none" style={styles.deliveryStatus}>
      <Tooltip content={deliveryHelp}>{({ triggerProps, visible, toggle }) => <Pressable
        {...triggerProps}
        accessibilityRole="button"
        accessibilityLabel={t("{{v0}} offer: {{v1}}{{v2}}", { v0: label, v1: delivery.label, v2: processedAt ? `, ${processedAt}` : "" })}
        accessibilityState={{ expanded: visible }}
        hitSlop={theme.controls.helperHitSlop}
        onPress={(event) => { event.stopPropagation(); toggle(); }}
        style={styles.deliveryIndicator}
      >
        <View style={styles.deliveryIcon}><DeliveryIcon size={theme.controls.helperIconSize} color={delivery.color} /></View>
        <Text selectable={selectable} style={styles.caption}>{deliveryText}</Text>
      </Pressable>}</Tooltip>
    </View> : null}
    {error ? <Text selectable={selectable} pointerEvents={selectable ? "auto" : "none"} accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
    {previewOpen && offerContext && detail.recipient ? <OfferSharePreview channel={channel} recipient={detail.recipient} context={offerContext} onClose={() => setPreviewOpen(false)} /> : null}
  </View>;
}

function OfferSharePreview({ channel, recipient, context, onClose }: { channel: "email" | "whatsapp"; recipient: string; context: OfferContext; onClose: () => void }) {
  const [language, setLanguage] = useState<"en" | "it">(context.language);
  const [message, setMessage] = useState<OfferShareMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const sendKey = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void apiClient.getOfferShareMessage(context.inquiryId, channel, { demo: context.demo, language })
      .then((value) => { if (active) setMessage(value); })
      .catch(() => { if (active) { setMessage(null); setError(t("Preview unavailable")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [channel, context.demo, context.inquiryId, language]);
  const open = async () => {
    if (!message) return;
    setOpening(true); setError(null);
    try {
      const destination = contactUrl(channel, recipient, { text: message.text, ...(message.channel === "email" ? { subject: message.subject } : {}) });
      if (!destination) throw new Error("Invalid contact");
      await Linking.openURL(destination);
      sendKey.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      setConfirmOpen(true);
    } catch { setError(t("Could not open {{v0}}. Copy the contact and try again.", { v0: channel === "email" ? t("Email") : "WhatsApp" })); }
    finally { setOpening(false); }
  };
  const confirmSent = async () => {
    if (!sendKey.current) return;
    setConfirming(true); setError(null);
    try {
      const updated = await apiClient.markManualOfferSent(context.inquiryId, channel, language, sendKey.current, { demo: context.demo });
      context.onManualSent?.(updated);
      onClose();
    } catch { setError(t("Could not mark sent. Try again.")); }
    finally { setConfirming(false); }
  };
  if (confirmOpen) return <Modal visible transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
    <View style={styles.previewBackdrop}><View style={styles.confirmSheet}>
      <Text accessibilityRole="header" style={styles.previewTitle}>{t("Sent?")}</Text>
      {error ? <InlinePreviewError>{error}</InlinePreviewError> : null}
      <View style={styles.confirmActions}>
        <Pressable accessibilityRole="button" disabled={confirming} onPress={() => { setConfirmOpen(false); setError(null); }} style={({ pressed }) => [styles.confirmSecondary, pressed && styles.pressed, confirming && styles.disabled]}><Text style={styles.confirmSecondaryText}>{t("Not yet")}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={confirming} onPress={() => void confirmSent()} style={({ pressed }) => [styles.confirmPrimary, pressed && styles.pressed, confirming && styles.disabled]}>{confirming ? <ActivityIndicator color={theme.colors.onAction} /> : <Text style={styles.previewSendText}>{t("Yes")}</Text>}</Pressable>
      </View>
    </View></View>
  </Modal>;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.previewBackdrop}><View style={styles.previewSheet}>
      <View style={styles.previewHeader}><Text accessibilityRole="header" style={styles.previewTitle}>{t("Send offer")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Close")} onPress={onClose} style={actionStyles.iconButton}><X size={20} color={theme.colors.textMuted} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.previewContent}>
        <Text style={styles.previewLabel}>{t("Offer")}</Text>
        {context.offers[0] ? <Text style={styles.caption}>{formatStay(context.offers[0].checkIn, context.offers[0].checkOut)}</Text> : null}
        {context.offers.map((offer) => <View key={offer.id} style={styles.previewOffer}><Text style={styles.previewOfferTitle}>{offer.roomName}</Text><Text style={styles.caption}>{offer.mealPlan} · {new Intl.NumberFormat(locale(), { style: "currency", currency: offer.currency }).format(offer.totalCents / 100)}</Text></View>)}
        <Text style={styles.previewLabel}>{t("Language")}</Text>
        <View style={styles.languageRow}>{([['it', 'Italiano'], ['en', 'English']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: language === value }} onPress={() => setLanguage(value)} style={[styles.languageChoice, language === value && styles.languageChoiceActive]}><Text style={[styles.languageText, language === value && styles.languageTextActive]}>{label}</Text></Pressable>)}</View>
        <Text style={styles.previewLabel}>{t("Message")}</Text>
        {loading ? <ActivityIndicator color={theme.colors.action} /> : message ? <View style={styles.messagePreview}>{message.channel === "email" ? <Text style={styles.previewOfferTitle}>{message.subject}</Text> : null}<Text selectable style={styles.previewMessage}>{message.text}</Text></View> : null}
        {error ? <InlinePreviewError>{error}</InlinePreviewError> : null}
      </ScrollView>
      <View style={styles.previewFooter}><Pressable accessibilityRole="button" disabled={!message || opening || loading} onPress={() => void open()} style={({ pressed }) => [styles.previewSend, pressed && styles.pressed, (!message || opening || loading) && styles.disabled]}>{opening ? <ActivityIndicator color={theme.colors.onAction} /> : <><Text style={styles.previewSendText}>{channel === "email" ? t("Email") : "WhatsApp"}</Text><ArrowUpRight size={18} color={theme.colors.onAction} /></>}</Pressable></View>
    </View></View>
  </Modal>;
}

function InlinePreviewError({ children }: { children: string }) {
  return <Text accessibilityRole="alert" style={styles.error}>{translateLabel(children)}</Text>;
}

const styles = StyleSheet.create({
  card: { position: "relative", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderLeftWidth: 4, borderRadius: theme.radii.lg },
  cardLink: { borderRadius: theme.radii.lg }, cardLinkActive: { backgroundColor: theme.colors.surfaceMuted },
  content: { padding: theme.spacing[4], gap: theme.spacing[1] },
  sendingDetails: { gap: theme.spacing[1] }, sendingLabel: { ...theme.typography.captionMedium, color: theme.colors.textSecondary, flexShrink: 1 },
  page: { flex: 1 }, pageContent: { gap: theme.spacing[1] },
  sectionHeading: { ...actionStyles.row, marginBottom: theme.spacing[2] }, sectionTitle: { ...theme.typography.h4, color: theme.colors.text },
  clientHeading: { marginTop: theme.spacing[4] },
  summary: { minHeight: theme.controls.actionSize, flexDirection: "row", alignItems: "flex-start", gap: theme.controls.actionGap },
  boardSlot: { width: theme.controls.actionSize, height: theme.controls.actionSize, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  stayDetails: { ...actionStyles.row, flex: 1 }, stayCopy: { minHeight: theme.controls.actionSize, flexDirection: "row", flexWrap: "wrap", alignItems: "center", alignContent: "center", columnGap: theme.controls.helperGap, flexShrink: 1 },
  statusSummary: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }, statusLabel: { ...theme.typography.caption, color: theme.colors.textMuted },
  peopleCount: { ...actionStyles.associated, flexShrink: 0 },
  statusDotTrigger: { minHeight: theme.controls.helperSize, alignItems: "center", justifyContent: "center" },
  statusDot: { width: theme.spacing[2], height: theme.spacing[2], borderWidth: 1, borderRadius: theme.radii.pill },
  stayText: { ...theme.typography.button, color: theme.colors.text, flexShrink: 1, minWidth: 0 },
  nightUnit: { fontFamily: theme.typography.bodySmall.fontFamily },
  priceWrap: { minHeight: theme.controls.actionSize, justifyContent: "center", flexShrink: 0, marginLeft: "auto" }, price: { ...theme.typography.bodyMedium, color: theme.colors.text, textAlign: "right" },
  row: { ...actionStyles.row, minHeight: theme.controls.helperSize, alignContent: "center" },
  detailsInset: { paddingLeft: theme.controls.actionSize + theme.controls.actionGap },
  entityLine: { ...actionStyles.associated, flexShrink: 1 },
  text: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, flexShrink: 1, minWidth: 0 },
  nameRow: { ...actionStyles.row, minHeight: theme.controls.actionSize, alignContent: "center" }, clientDetails: { ...actionStyles.row, flex: 1 },
  nameValue: { ...actionStyles.associated, flexShrink: 1 },
  inline: { ...actionStyles.row, flexShrink: 1 }, name: { ...theme.typography.bodySmall, color: theme.colors.text, flexShrink: 1 }, nameLink: { ...theme.typography.bodySmall, color: theme.colors.action, textDecorationLine: "underline" }, nameButton: { minHeight: theme.controls.actionSize, justifyContent: "center", flexShrink: 1 },
  toggle: { ...actionStyles.iconButton },
  contacts: { flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing[6], rowGap: theme.controls.actionGap }, contact: { flexShrink: 1, maxWidth: "100%", gap: theme.spacing[1] }, contactRow: { ...actionStyles.row, flexShrink: 1 }, contactValue: { ...actionStyles.associated, minHeight: theme.controls.actionSize, flexShrink: 1, minWidth: 0, maxWidth: "100%" }, send: { ...actionStyles.control, paddingHorizontal: theme.spacing[2], flexShrink: 0 }, deliveryStatus: { ...actionStyles.row },
  pageContacts: { flexDirection: "column", flexWrap: "nowrap", rowGap: theme.spacing[1], columnGap: 0 },
  deliveryIndicator: { ...actionStyles.helperContent },
  deliveryIcon: { ...actionStyles.icon, alignItems: "center", justifyContent: "center" },
  copyWrap: { flexShrink: 1, maxWidth: "100%" }, copyRow: { ...actionStyles.helperContent, flexShrink: 1 }, copy: { ...actionStyles.helperContent, flexShrink: 1 }, copyIconOnly: { width: theme.controls.helperSize, flexShrink: 0 },
  additional: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: theme.spacing[4], paddingTop: theme.spacing[4], gap: theme.spacing[1] },
  additionalDetails: { gap: theme.spacing[1] }, additionalRow: { ...actionStyles.associated, minHeight: theme.controls.helperSize }, additionalHint: { alignSelf: "flex-start", maxWidth: "100%" },
  caption: { ...theme.typography.caption, color: theme.colors.textMuted, flexShrink: 1 }, error: { ...theme.typography.caption, color: theme.colors.danger, flexShrink: 1 }, nextAction: { ...theme.typography.bodySmallMedium, color: theme.colors.textSecondary, flexShrink: 1 },
  link: { ...actionStyles.label, color: theme.colors.action }, pressed: { opacity: 0.65 }, disabled: { opacity: 0.45 },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(20, 30, 50, 0.35)", alignItems: "center", justifyContent: "center", padding: theme.spacing[4] },
  previewSheet: { width: "100%", maxWidth: 560, maxHeight: "92%", backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: "hidden" },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.controls.contentInset, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  previewTitle: { ...theme.typography.h3, color: theme.colors.text }, previewContent: { padding: theme.controls.contentInset, gap: theme.spacing[3] },
  previewLabel: { ...theme.typography.captionMedium, color: theme.colors.textMuted, textTransform: "uppercase" },
  previewOffer: { padding: theme.spacing[3], borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceMuted, gap: theme.spacing[1] }, previewOfferTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  languageRow: { flexDirection: "row", gap: theme.spacing[2] }, languageChoice: { minHeight: theme.controls.minTarget, paddingHorizontal: theme.spacing[4], alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.pill }, languageChoiceActive: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint }, languageText: { ...theme.typography.bodySmallMedium, color: theme.colors.textSecondary }, languageTextActive: { color: theme.colors.action },
  messagePreview: { padding: theme.spacing[4], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, gap: theme.spacing[2], backgroundColor: theme.colors.surface }, previewMessage: { ...theme.typography.bodySmall, color: theme.colors.text, lineHeight: 21 },
  previewFooter: { padding: theme.spacing[4], borderTopWidth: 1, borderTopColor: theme.colors.border }, previewSend: { minHeight: theme.controls.minTarget, borderRadius: theme.radii.md, backgroundColor: theme.colors.action, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[2] }, previewSendText: { ...theme.typography.button, color: theme.colors.onAction },
  confirmSheet: { width: "100%", maxWidth: 360, backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.controls.contentInset, gap: theme.spacing[5] },
  confirmActions: { flexDirection: "row", gap: theme.spacing[2] },
  confirmSecondary: { flex: 1, minHeight: theme.controls.minTarget, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" },
  confirmSecondaryText: { ...theme.typography.button, color: theme.colors.text },
  confirmPrimary: { flex: 1, minHeight: theme.controls.minTarget, borderRadius: theme.radii.md, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center" },
});
