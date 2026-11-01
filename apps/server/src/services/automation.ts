import { randomUUID } from "node:crypto";

import { buildOfferDraft } from "@hotel/domain";

import { toDomainHotel, toDomainInquiry, toDomainRatePeriod, toDomainRoom } from "../adapters/domain.js";
import { errors } from "../lib/errors.js";
import { createPublicToken, hashPublicToken, sealPrivateValue } from "../lib/public-token.js";
import { createTestOfferToken, verifyTestOfferToken } from "../lib/test-offer-token.js";
import type {
  AutomationRepository,
  DeliveryRecord,
  InquiryAttentionReason,
  InquiryBundle,
  InquiryRecord,
  OfferRecord,
} from "../repositories/types.js";

export type PublicInquiryInput = {
  guest: { name: string; email: string | null; phone: string | null; language: string };
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; childAges: number[] };
  note: string;
  source: Record<string, unknown>;
};

export type TestOfferSample = {
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  guestCount?: number;
};

export class AutomationService {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly authSecret: string,
    private readonly publicBaseUrl: string,
  ) {}

  async intake(publicKey: string, origin: string | undefined, idempotencyKey: string, input: PublicInquiryInput) {
    const hotel = await this.repository.findPublicHotelByKey(publicKey);
    if (!hotel) throw errors.publicHotelNotFound();
    if (!origin || !hotel.allowedOrigins.includes(origin)) throw errors.originNotAllowed();
    if (idempotencyKey.length < 1 || idempotencyKey.length > 160) throw errors.idempotencyKeyRequired();

    const now = new Date();
    const inquiryId = randomUUID();
    const inquiry: InquiryRecord = {
      id: inquiryId,
      hotelId: hotel.id,
      idempotencyKey,
      guestName: input.guest.name,
      guestEmail: input.guest.email,
      guestPhone: input.guest.phone,
      locale: input.guest.language,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      occupancy: input.occupancy,
      source: { ...input.source, origin },
      note: input.note,
      attentionReason: null,
      currentOfferId: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const catalog = await this.repository.listCatalogForHotel(hotel.id);
    const result = buildOfferDraft({
      hotel: toDomainHotel(hotel),
      rooms: catalog.rooms.map(toDomainRoom),
      ratePeriods: catalog.ratePeriods.map(toDomainRatePeriod),
      inquiry: toDomainInquiry(inquiry),
    });

    if (!result.ok) {
      const bundle = await this.repository.createInquiryBundle({
        inquiry: {
          ...this.persistableInquiry(inquiry),
          attentionReason: result.attentionReason,
          source: { ...inquiry.source, automationIssues: result.issues },
        },
      });
      return this.intakeResponse(bundle);
    }

    const rawToken = createPublicToken();
    const tokenHash = hashPublicToken(rawToken);
    const offerId = randomUUID();
    const proposalUrl = `${this.publicBaseUrl}/proposal/${rawToken}`;
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1_000);
    const offer = {
      id: offerId,
      hotelId: hotel.id,
      inquiryId,
      version: 1,
      state: "active" as const,
      publicTokenHash: tokenHash,
      snapshot: JSON.parse(JSON.stringify({ schemaVersion: 1, ...result.draft })) as Record<string, unknown>,
      expiresAt,
      acceptedAt: null,
      selectedOptionIndex: null,
      revokedAt: null,
    };
    const recipients = [
      ...(input.guest.email ? [{ channel: "email" as const, recipient: input.guest.email }] : []),
      ...(input.guest.phone ? [{ channel: "whatsapp" as const, recipient: input.guest.phone }] : []),
    ];
    const deliveries = recipients.map(({ channel, recipient }): Omit<DeliveryRecord, "createdAt" | "updatedAt"> => ({
      id: randomUUID(),
      hotelId: hotel.id,
      inquiryId,
      offerVersionId: offerId,
      kind: "offer",
      channel,
      state: "scheduled",
      idempotencyKey: `${offerId}:${channel}`,
      recipient,
      payload: {
        schemaVersion: 1,
        proposalUrlCiphertext: sealPrivateValue(proposalUrl, this.authSecret),
      },
      attemptCount: 0,
      nextAttemptAt: now,
      providerMessageId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: null,
    }));
    const bundle = await this.repository.createInquiryBundle({
      inquiry: this.persistableInquiry(inquiry),
      offer,
      deliveries,
    });
    return { ...this.intakeResponse(bundle), ...(bundle.replayed ? {} : { proposalUrl }) };
  }

  async getProposal(rawToken: string) {
    const offer = await this.repository.findOfferByTokenHash(hashPublicToken(rawToken));
    if (!offer) throw errors.offerNotFound();
    this.ensurePublicOfferAvailable(offer, new Date());
    return this.publicOffer(offer);
  }

  async createTestProposal(userId: string, sample: TestOfferSample = {}) {
    const facts = await this.repository.dashboardFactsForUser(userId);
    if (!facts) throw errors.hotelNotFound();
    const catalog = await this.repository.listCatalogForHotel(facts.hotel.id);
    const snapshot = this.testOfferSnapshot(facts.hotel, catalog, sample);
    const token = createTestOfferToken({
      publicKey: facts.hotel.publicKey,
      checkIn: snapshot.guestSnapshot.checkIn,
      checkOut: snapshot.guestSnapshot.checkOut,
      adults: snapshot.guestSnapshot.occupancy.adults,
    }, new Date(Date.now() + 48 * 60 * 60_000), this.authSecret);
    return {
      proposalUrl: `${this.publicBaseUrl}/proposal/test/${token}`,
      snapshot: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
    };
  }

  async testProposalPage(rawToken: string) {
    const verified = verifyTestOfferToken(rawToken, this.authSecret, new Date());
    if (!verified) throw errors.offerNotFound();
    const hotel = await this.repository.findPublicHotelByKey(verified.publicKey);
    if (!hotel) throw errors.offerNotFound();
    const catalog = await this.repository.listCatalogForHotel(hotel.id);
    return this.testOfferSnapshot(hotel, catalog, {
      guestName: "Test Guest",
      checkIn: verified.checkIn,
      checkOut: verified.checkOut,
      guestCount: verified.adults,
    });
  }

  async proposalPage(rawToken: string) {
    const offer = await this.repository.findOfferByTokenHash(hashPublicToken(rawToken));
    if (!offer) throw errors.offerNotFound();
    const state = offer.state === "active" && offer.expiresAt <= new Date() ? "expired" : offer.state;
    return { offer: this.publicOffer(offer), state };
  }

  async acceptProposal(rawToken: string, selectedOptionIndex = 0) {
    const hash = hashPublicToken(rawToken);
    const now = new Date();
    const current = await this.repository.findOfferByTokenHash(hash);
    if (!current) throw errors.offerNotFound();
    this.ensurePublicOfferAvailable(current, now, true);
    const options = Array.isArray(current.snapshot.options) ? current.snapshot.options : [];
    if (!Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0 || selectedOptionIndex >= options.length) {
      throw errors.invalidOfferOption();
    }
    const offer = await this.repository.acceptOfferByTokenHash(hash, now, selectedOptionIndex);
    if (!offer) throw errors.offerNotFound();
    this.ensurePublicOfferAvailable(offer, now, true);
    return this.publicOffer(offer);
  }

  async dashboard(userId: string) {
    const facts = await this.repository.dashboardFactsForUser(userId);
    if (!facts) throw errors.hotelNotFound();
    const now = new Date();
    const items = facts.inquiries.map((inquiry) => {
      const offers = facts.offers.filter(({ inquiryId }) => inquiryId === inquiry.id);
      const latest = offers.sort((a, b) => b.version - a.version)[0];
      const deliveries = facts.deliveries
        .filter(
          (delivery) =>
            delivery.inquiryId === inquiry.id &&
            (latest === undefined || delivery.offerVersionId === latest.id),
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      const emailDelivery = deliveries.find(({ channel }) => channel === "email");
      const whatsappDelivery = deliveries.find(({ channel }) => channel === "whatsapp");
      const workflowState = latest?.acceptedAt
          ? "requires_confirmation"
          : inquiry.attentionReason
            ? "needs_attention"
            : latest && (latest.state === "expired" || latest.state === "revoked" || latest.expiresAt <= now)
              ? "needs_attention"
              : latest && deliveries.some(({ state }) => ["provider_accepted", "delivered"].includes(state))
                ? "offer_sent"
                : "new";
      return {
        id: inquiry.id,
        guestName: inquiry.guestName,
        checkIn: inquiry.checkIn,
        checkOut: inquiry.checkOut,
        occupancy: inquiry.occupancy,
        offerSummary: latest ? offerSummary(latest) : null,
        channelStates: {
          email: emailDelivery?.state ?? null,
          whatsapp: whatsappDelivery?.state ?? null,
        },
        channelDetails: {
          email: emailDelivery ? deliverySummary(emailDelivery) : null,
          whatsapp: whatsappDelivery ? deliverySummary(whatsappDelivery) : null,
        },
        workflowState,
        attentionReason: inquiry.attentionReason,
        createdAt: inquiry.createdAt.toISOString(),
      };
    });
    return {
      hotel: { id: facts.hotel.id, name: facts.hotel.name, publicKey: facts.hotel.publicKey },
      counts: {
        total: items.length,
        new: items.filter(({ workflowState }) => workflowState === "new").length,
        offerSent: items.filter(({ workflowState }) => workflowState === "offer_sent").length,
        requiresConfirmation: items.filter(({ workflowState }) => workflowState === "requires_confirmation").length,
        requiresConfirmationTotalCents: items
          .filter(({ workflowState }) => workflowState === "requires_confirmation")
          .reduce((total, item) => total + (item.offerSummary?.totalCents ?? 0), 0),
        needsAttention: items.filter(({ workflowState }) => workflowState === "needs_attention").length,
      },
      inquiries: items,
    };
  }

  private persistableInquiry(inquiry: InquiryRecord) {
    const { currentOfferId: _currentOfferId, createdAt: _createdAt, updatedAt: _updatedAt, ...persistable } = inquiry;
    return persistable;
  }

  private testOfferSnapshot(
    hotel: Awaited<ReturnType<AutomationRepository["findPublicHotelByKey"]>> & {},
    catalog: Awaited<ReturnType<AutomationRepository["listCatalogForHotel"]>>,
    sample: TestOfferSample,
  ) {
    const requested = {
      guestName: sample.guestName ?? "Test Guest",
      checkIn: sample.checkIn ?? "2027-06-10",
      checkOut: sample.checkOut ?? "2027-06-12",
      adults: Math.max(1, Math.min(20, sample.guestCount ?? 2)),
    };
    const requestedDraft = this.buildTestDraft(hotel, catalog, requested);
    if (requestedDraft) return requestedDraft;

    const periods = [...catalog.ratePeriods].sort((left, right) => left.start.localeCompare(right.start));
    for (const period of periods) {
      const room = catalog.rooms.find(({ id }) => id === period.roomId);
      if (!room || room.maxAdults < 1) continue;
      const nights = Math.max(1, period.minNights);
      const checkOut = addDays(period.start, nights);
      if (checkOut > period.endExclusive) continue;
      const draft = this.buildTestDraft(hotel, catalog, {
        guestName: requested.guestName,
        checkIn: period.start,
        checkOut,
        adults: Math.min(room.maxAdults, room.maxGuests, Math.max(1, period.includedAdults)),
      });
      if (draft) return draft;
    }

    return {
      inquiryId: randomUUID(),
      hotelSnapshot: {
        id: hotel.id,
        name: hotel.name,
        description: hotel.description ?? "",
        currency: hotel.currency,
        locale: hotel.locale,
        timezone: hotel.timezone,
        logoUrl: hotel.logoUrl,
        photos: hotel.photoUrls.map((url, sortOrder) => ({ url, alt: hotel.name, sortOrder })),
      },
      guestSnapshot: {
        name: requested.guestName,
        checkIn: requested.checkIn,
        checkOut: requested.checkOut,
        occupancy: { adults: requested.adults, childAges: [] },
      },
      options: [],
    };
  }

  private buildTestDraft(
    hotel: NonNullable<Awaited<ReturnType<AutomationRepository["findPublicHotelByKey"]>>>,
    catalog: Awaited<ReturnType<AutomationRepository["listCatalogForHotel"]>>,
    sample: { guestName: string; checkIn: string; checkOut: string; adults: number },
  ) {
    const now = new Date();
    const inquiry: InquiryRecord = {
      id: randomUUID(), hotelId: hotel.id, idempotencyKey: `test:${randomUUID()}`,
      guestName: sample.guestName, guestEmail: null, guestPhone: null, locale: hotel.locale,
      checkIn: sample.checkIn, checkOut: sample.checkOut,
      occupancy: { adults: sample.adults, childAges: [] }, source: { test: true }, note: "",
      attentionReason: null, currentOfferId: null, closedAt: null, createdAt: now, updatedAt: now,
    };
    const result = buildOfferDraft({
      hotel: toDomainHotel(hotel),
      rooms: catalog.rooms.map(toDomainRoom),
      ratePeriods: catalog.ratePeriods.map(toDomainRatePeriod),
      inquiry: toDomainInquiry(inquiry),
    });
    return result.ok ? result.draft : null;
  }

  private intakeResponse(bundle: InquiryBundle) {
    return {
      inquiryId: bundle.inquiry.id,
      automated: bundle.inquiry.currentOfferId !== null || bundle.offer !== null,
      attentionReason: bundle.inquiry.attentionReason,
      deliveriesScheduled: bundle.deliveries.length,
      replayed: bundle.replayed,
    };
  }

  private ensurePublicOfferAvailable(offer: OfferRecord, now: Date, allowAccepted = false): void {
    if (offer.state === "revoked" || offer.revokedAt) throw errors.offerRevoked();
    if (offer.state === "expired" || offer.expiresAt <= now) throw errors.offerExpired();
    if (!allowAccepted && offer.state === "accepted") return;
  }

  private publicOffer(offer: OfferRecord) {
    return {
      id: offer.id,
      state: offer.state,
      snapshot: offer.snapshot,
      expiresAt: offer.expiresAt.toISOString(),
      acceptedAt: offer.acceptedAt?.toISOString() ?? null,
      selectedOptionIndex: offer.selectedOptionIndex,
    };
  }
}

function deliverySummary(delivery: DeliveryRecord) {
  return {
    state: delivery.state,
    recipient: delivery.recipient,
    lastErrorCode: delivery.lastErrorCode,
    processedAt: delivery.processedAt?.toISOString() ?? null,
  };
}

function offerSummary(offer: OfferRecord): { roomName: string; totalCents: number; currency: string } | null {
  const options = offer.snapshot.options;
  if (!Array.isArray(options)) return null;
  const selectedIndex = offer.selectedOptionIndex ?? 0;
  const selected = options[selectedIndex];
  if (!isRecord(selected)) return null;
  const { roomName, totalCents, currency } = selected;
  if (typeof roomName !== "string" || typeof totalCents !== "number" || typeof currency !== "string") return null;
  return { roomName, totalCents, currency };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
