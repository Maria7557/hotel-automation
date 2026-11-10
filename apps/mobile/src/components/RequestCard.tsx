import { useEffect, useState, type ReactNode } from "react";
import { AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ArrowRight, ArrowUpRight, Baby, BedDouble, Check, ChevronDown, ChevronUp, CircleAlert, Clock, Copy, CreditCard, Inbox, Info, Languages, Mail, MessageCircle, Minus, UserRound, Users, type LucideIcon } from "lucide-react-native";
import { theme, type StatusColors } from "@hotel/design";
import type { DeliverySummary, HotelRequest } from "@/api/types";
import { DetailLink } from "./DetailLink";
import { NavigationLink } from "./NavigationLink";
import { BoardBadge } from "./BoardBadge";
import { StatusPill } from "./StatusPill";
import { Tooltip } from "./Tooltip";
import { actionStyles } from "./actionStyles";
import { RequestClientStatus, useRequestClient } from "./RequestClientStatus";
import { requestAppearance } from "../requests/status";
import { contactUrl, formatOccupancyParts, formatPaymentLinkWait, formatStay, formatTimestamp } from "../requests/presentation";

type Props = {
  request: HotelRequest;
  onOpen?: () => void;
  onOpenClient: (clientId: string) => void;
  variant?: "card" | "page";
  children?: ReactNode;
};

export function RequestCard({ request, onOpen, onOpenClient, variant = "card", children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isPage = variant === "page";
  const { status, clientId } = useRequestClient(request.id);
  const appearance = requestAppearance(request);
  const occupancy = formatOccupancyParts(request);
  const selectable = !onOpen;
  const textPointerEvents = selectable ? "auto" : "none";
  const additional = isPage ? <View pointerEvents={textPointerEvents} style={styles.additional}>
    <View style={styles.sectionHeading}><Info size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable accessibilityRole="header" style={styles.sectionTitle}>More</Text></View>
    <View style={[styles.additionalDetails, styles.detailsInset]}>
      <AdditionalDetail icon={Inbox} tooltip="When the guest’s request arrived."><Text selectable={selectable} style={styles.caption}>Received {formatTimestamp(request.receivedAt)}</Text></AdditionalDetail>
      {request.receivedVia ? <AdditionalDetail icon={Inbox}><Text selectable={selectable} style={styles.caption}>Added by staff · {request.receivedVia === "phone" ? "Phone call" : request.receivedVia === "walk_in" ? "Walk-in" : "Other conversation"}</Text></AdditionalDetail> : null}
      {request.occupancy.childAges.length ? <AdditionalDetail icon={Baby}><Text selectable={selectable} style={styles.caption}>Children’s ages: {request.occupancy.childAges.join(", ")}</Text></AdditionalDetail> : null}
      {request.note ? <AdditionalDetail icon={MessageCircle}><Text selectable={selectable} style={styles.text}>Guest note: {request.note}</Text></AdditionalDetail> : null}
      {request.locale ? <AdditionalDetail icon={Languages}><Text selectable={selectable} style={styles.caption}>Guest language: {request.locale}</Text></AdditionalDetail> : null}
      {request.offerExpiresAt ? <AdditionalDetail icon={Clock}><Text selectable={selectable} style={styles.caption}>Offer expires: {formatTimestamp(request.offerExpiresAt)}</Text></AdditionalDetail> : null}
      {request.acceptedAt ? <AdditionalDetail icon={Check} tooltip="When the guest accepted the offer."><Text selectable={selectable} style={styles.caption}>Accepted: {formatTimestamp(request.acceptedAt)}</Text></AdditionalDetail> : null}
      {request.paymentLinkSentAt ? <AdditionalDetail icon={CreditCard}><Text selectable={selectable} style={styles.caption}>Payment link marked sent: {formatTimestamp(request.paymentLinkSentAt)}</Text></AdditionalDetail> : null}
      {request.attentionReason ? <AdditionalDetail icon={CircleAlert}><Text selectable={selectable} style={styles.error}>Issue: {request.attentionReason.replace(/_/g, " ").toLowerCase()}</Text></AdditionalDetail> : null}
      {([request.email, request.whatsapp]).map((delivery, index) => delivery.lastErrorCode ? <AdditionalDetail key={index} icon={CircleAlert}><Text selectable={selectable} style={styles.error}>{index ? "WhatsApp" : "Email"}: {delivery.lastErrorCode.replace(/_/g, " ").toLowerCase()}</Text></AdditionalDetail> : null)}
      {request.nextAction ? <AdditionalDetail icon={ArrowRight} tooltip={request.nextAction === "Review availability" ? "Check room availability for these dates before sending a payment link." : undefined}><Text selectable={selectable} style={styles.nextAction}>Next: {request.nextAction}</Text></AdditionalDetail> : null}
    </View>
  </View> : null;
  return <View style={isPage ? styles.page : [styles.card, { borderLeftColor: appearance.color }]}>
    {/* A sibling link covers the card. Controls above it stay independent, without nested links. */}
    {onOpen ? <DetailLink kind="reservation" id={request.id} label={`Reservation #${request.reservationNumber} details`} onOpen={onOpen} style={({ pressed }) => [StyleSheet.absoluteFill, styles.cardLink, pressed && styles.cardLinkActive]}>{null}</DetailLink> : null}
    <View pointerEvents="box-none" style={isPage ? styles.pageContent : styles.content}>
      {isPage ? <View style={styles.sectionHeading}><BedDouble size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable accessibilityRole="header" style={styles.sectionTitle}>Reservation</Text></View> : null}
      <View pointerEvents="box-none" style={styles.summary}>
        <View pointerEvents={textPointerEvents} style={request.mealPlan ? styles.boardSlot : undefined}><BoardBadge mealPlan={request.mealPlan} selectable={selectable} /></View>
        <View pointerEvents="box-none" style={styles.stayDetails}>
          <View pointerEvents={textPointerEvents} style={styles.stayCopy}>
            <Text selectable={selectable} style={styles.stayText}>{formatStay(request.checkIn, request.checkOut)} · {occupancy.nights}{" "}<Text style={styles.nightUnit}>{occupancy.nights === 1 ? "night" : "nights"}</Text> ·</Text>
            <View accessible accessibilityLabel={`${occupancy.people} ${occupancy.people === 1 ? "person" : "people"}`} style={styles.peopleCount}>
              <Text selectable={selectable} style={styles.stayText}>{occupancy.people}</Text>
              <Users aria-hidden size={theme.controls.helperIconSize} color={theme.colors.text} />
            </View>
            {isPage || request.occupancy.childAges.length > 0 ? <Text selectable={selectable} style={styles.text}>{occupancy.breakdown}</Text> : null}
          </View>
          <CopyValue value={request.reservationNumber} label="Reservation number" display={`#${request.reservationNumber}`} selectable={selectable} />
          {isPage ? <StatusPill label={request.statusLabel} appearance={appearance} selectable={selectable} /> : null}
          {request.status === "payment" && !request.paymentLinkSentAt && request.acceptedAt ? <WaitPill since={request.acceptedAt} description="User waiting for payment link" selectable={selectable} /> : null}
          {request.status === "waiting" && request.offerSentAt ? <WaitPill since={request.offerSentAt} description="Waiting for user reply" selectable={selectable} /> : null}
          {request.status === "new" || request.status === "attention" ? <WaitPill since={request.receivedAt} description="Waiting for action since request received" selectable={selectable} /> : null}
          {!isPage ? <RequestStatusDot label={request.statusLabel} appearance={appearance} /> : null}
        </View>
        <View pointerEvents={textPointerEvents} style={styles.priceWrap}><Text selectable={selectable} style={styles.price}>{request.totalLabel}</Text></View>
      </View>
      <View pointerEvents="box-none" style={[styles.row, styles.detailsInset]}>
        <View pointerEvents={textPointerEvents} style={styles.entityLine}><BedDouble size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable={selectable} style={styles.text}>{request.roomLabel}</Text></View>
      </View>
      {isPage ? <View style={[styles.sectionHeading, styles.clientHeading]}><UserRound size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /><Text selectable accessibilityRole="header" style={styles.sectionTitle}>Client</Text></View> : null}
      <View pointerEvents="box-none" style={[styles.nameRow, styles.detailsInset]}>
        <View pointerEvents="box-none" style={styles.clientDetails}>
          <View pointerEvents="box-none" style={styles.inline}>
            <View pointerEvents="box-none" style={styles.nameValue}>
            <View pointerEvents="none"><UserRound size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.textMuted} /></View>
            {status === "present" && clientId ? <DetailLink kind="client" id={clientId} label={`View client ${request.guestName}`} onOpen={() => onOpenClient(clientId)} style={styles.nameButton}><Text selectable={selectable} style={styles.nameLink}>{request.guestName}</Text></DetailLink> : <View pointerEvents={textPointerEvents}><Text selectable={selectable} style={styles.name}>{request.guestName}</Text></View>}
            {isPage || expanded ? <CopyValue value={request.guestName} label="Client name" iconOnly /> : null}
            </View>
            {!isPage ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Hide contact details" : "Show contact details"} accessibilityState={{ expanded }} onPress={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
              {expanded ? <ChevronUp size={theme.controls.actionIconSize} color={theme.colors.textMuted} /> : <ChevronDown size={theme.controls.actionIconSize} color={theme.colors.textMuted} />}
            </Pressable> : null}
          </View>
          {status !== "present" && status !== "loading" ? <RequestClientStatus inquiryId={request.id} /> : null}
        </View>
      </View>
      {isPage || expanded ? <View pointerEvents="box-none" style={[styles.contacts, isPage && styles.pageContacts, isPage && styles.detailsInset]}>
        <ContactDetail channel="email" detail={request.email} selectable={selectable} />
        <ContactDetail channel="whatsapp" detail={request.whatsapp} selectable={selectable} />
      </View> : null}
      {additional}
      {children}
    </View>
  </View>;
}

function RequestStatusDot({ label, appearance }: { label: string; appearance: StatusColors }) {
  return <Tooltip content={label}>{({ triggerProps, visible, toggle }) => <Pressable
    {...triggerProps}
    accessibilityRole="button"
    accessibilityLabel={`Status: ${label}`}
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
  return label ? <Tooltip content={description}>{({ triggerProps, visible, toggle }) => <Pressable
    {...triggerProps}
    accessibilityRole="button"
    accessibilityLabel={`${description}: ${label}`}
    accessibilityState={{ expanded: visible }}
    hitSlop={theme.controls.helperHitSlop}
    onPress={(event) => { event.stopPropagation(); toggle(); }}
  >
    <StatusPill label={label} icon={<Clock size={theme.controls.helperIconSize} color={theme.colors.textMuted} />} tone="neutral" selectable={selectable} />
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
      <Pressable accessibilityRole="button" accessibilityLabel={state === "copied" ? `${title} copied` : `Copy ${label.toLowerCase()}: ${value}`} hitSlop={theme.controls.helperHitSlop} onPress={(event) => { event.stopPropagation(); void copy(); }} style={({ pressed }) => [styles.copy, (iconOnly || selectable) && styles.copyIconOnly, pressed && styles.pressed]}>
        {!selectable && !iconOnly ? <Text style={styles.text}>{display}</Text> : null}
        <View pointerEvents="none" style={actionStyles.helperIconButton}>{state === "copied" ? <Check size={theme.controls.helperIconSize} color={theme.colors.success} /> : <Copy size={theme.controls.helperIconSize} color={theme.colors.helperIcon} />}</View>
      </Pressable>
    </View>
    {state !== "idle" ? <Text pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.caption, state === "failed" && styles.error]}>{state === "copied" ? "Copied" : "Could not copy. Try again."}</Text> : null}
  </View>;
}

export function ContactDetail({ channel, detail, showDeliveryStatus = true, selectable = false }: { channel: "email" | "whatsapp"; detail: DeliverySummary; showDeliveryStatus?: boolean; selectable?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const label = channel === "email" ? "Email" : "WhatsApp";
  const Icon = channel === "email" ? Mail : MessageCircle;
  const url = contactUrl(channel, detail.recipient);
  const send = async () => {
    if (!url) return;
    setError(null);
    try { await Linking.openURL(url); }
    catch { setError(`Could not open ${label}. Copy the contact and try again.`); }
  };
  const delivery = {
    sent: { label: "Sent", Icon: Check, color: theme.colors.success },
    pending: { label: "Pending", Icon: Clock, color: theme.colors.warning },
    failed: { label: "Failed", Icon: CircleAlert, color: theme.colors.danger },
    unused: { label: "Not sent", Icon: Minus, color: theme.colors.textMuted },
  }[detail.status];
  const DeliveryIcon = delivery.Icon;
  const processedAt = detail.processedAt ? formatTimestamp(detail.processedAt) : null;
  const deliveryText = detail.status === "sent" && processedAt
    ? processedAt
    : `${delivery.label}${processedAt ? ` · ${processedAt}` : ""}`;
  const deliveryHelp = detail.status === "sent"
    ? `The offer was sent through ${label}. The time shows when sending was processed, not when the guest read it.`
    : detail.status === "pending"
      ? `The offer is queued or being sent through ${label}. Sending has not been confirmed yet.`
      : detail.status === "failed"
        ? `Sending the offer through ${label} failed or needs checking. The time shows the last processed attempt.`
        : `No offer was sent through ${label} for this request.`;
  return <View pointerEvents="box-none" style={styles.contact}>
    <View pointerEvents="box-none" style={styles.contactRow}>
      <View pointerEvents="box-none" style={styles.contactValue}>
        <View pointerEvents="none" style={actionStyles.icon}><Icon size={theme.controls.actionIconSize} color={theme.colors.textMuted} /></View>
        {detail.recipient ? <CopyValue value={detail.recipient} label={label} selectable={selectable} /> : <View pointerEvents={selectable ? "auto" : "none"}><Text selectable={selectable} style={styles.caption}>No {label.toLowerCase()} provided</Text></View>}
      </View>
      {url ? <NavigationLink href={url} accessibilityLabel={`Send ${label} to ${detail.recipient}`} onPress={() => void send()} style={styles.send}><Text style={styles.link}>Send</Text><ArrowUpRight size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.action} /></NavigationLink> : null}
    </View>
    {showDeliveryStatus ? <View pointerEvents="box-none" style={styles.deliveryStatus}>
      <Tooltip content={deliveryHelp}>{({ triggerProps, visible, toggle }) => <Pressable
        {...triggerProps}
        accessibilityRole="button"
        accessibilityLabel={`${label} offer: ${delivery.label}${processedAt ? `, ${processedAt}` : ""}`}
        accessibilityState={{ expanded: visible }}
        hitSlop={theme.controls.helperHitSlop}
        onPress={(event) => { event.stopPropagation(); toggle(); }}
        style={styles.deliveryIndicator}
      >
        <View style={styles.deliveryIcon}><DeliveryIcon size={theme.controls.helperIconSize} color={delivery.color} /></View>
        <Text selectable={selectable} style={styles.caption}>{deliveryText}</Text>
      </Pressable>}</Tooltip>
    </View> : null}
    {error ? <Text selectable={selectable} pointerEvents={selectable ? "auto" : "none"} accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { position: "relative", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderLeftWidth: 4, borderRadius: theme.radii.lg },
  cardLink: { borderRadius: theme.radii.lg }, cardLinkActive: { backgroundColor: theme.colors.surfaceMuted },
  content: { padding: theme.spacing[4], gap: theme.spacing[1] },
  page: { flex: 1 }, pageContent: { gap: theme.spacing[1] },
  sectionHeading: { ...actionStyles.row, marginBottom: theme.spacing[2] }, sectionTitle: { ...theme.typography.h4, color: theme.colors.text },
  clientHeading: { marginTop: theme.spacing[4] },
  summary: { minHeight: theme.controls.actionSize, flexDirection: "row", alignItems: "flex-start", gap: theme.controls.actionGap },
  boardSlot: { width: theme.controls.actionSize, height: theme.controls.actionSize, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  stayDetails: { ...actionStyles.row, flex: 1 }, stayCopy: { minHeight: theme.controls.actionSize, flexDirection: "row", flexWrap: "wrap", alignItems: "center", alignContent: "center", columnGap: theme.controls.helperGap, flexShrink: 1 },
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
  link: { ...actionStyles.label, color: theme.colors.action }, pressed: { opacity: 0.65 },
});
