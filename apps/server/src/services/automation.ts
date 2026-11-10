import { createHash, randomUUID } from "node:crypto";
import { OFFER_VALIDITY_MS, mealPlanSchema, type DashboardQuery, type ManualInquiryInput, type MealPlan, type ReservationOffer, type SendReservationOffersInput } from "@hotel/contracts";

import { buildOfferDraft, roomFitsOccupancy } from "@hotel/domain";

import { toDomainHotel, toDomainInquiry, toDomainRatePeriod, toDomainRoom } from "../adapters/domain.js";
import { errors } from "../lib/errors.js";
import { createPublicToken, hashPublicToken, sealPrivateValue } from "../lib/public-token.js";
import { createTestOfferToken, verifyTestOfferToken } from "../lib/test-offer-token.js";
import type {
  AutomationRepository,
  DashboardFacts,
  DeliveryRecord,
  HotelProfile,
  InquiryAttentionReason,
  InquiryBundle,
  InquiryRecord,
  OfferRecord,
} from "../repositories/types.js";
import type { NotificationEvent, NotificationService } from "./notifications.js";

export type PublicInquiryInput = {
  guest: { name: string; email: string | null; phone: string | null; language: string };
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; childAges: number[] };
  mealPlan: MealPlan;
  note: string;
  source: Record<string, unknown>;
};

export type TestOfferSample = {
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  guestCount?: number;
  mealPlan?: MealPlan;
};

export class AutomationService {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly authSecret: string,
    private readonly publicBaseUrl: string,
    private readonly notifications?: NotificationService,
  ) {}

  async intake(publicKey: string, origin: string | undefined, idempotencyKey: string, input: PublicInquiryInput) {
    const hotel = await this.repository.findPublicHotelByKey(publicKey);
    if (!hotel) throw errors.publicHotelNotFound();
    if (!origin || !hotel.allowedOrigins.includes(origin)) throw errors.originNotAllowed();
    if (idempotencyKey.length < 1 || idempotencyKey.length > 160) throw errors.idempotencyKeyRequired();

    return this.createInquiry(hotel, idempotencyKey, { ...input, source: { ...input.source, origin } });
  }

  async createManualInquiry(userId: string, idempotencyKey: string, input: ManualInquiryInput) {
    const facts = await this.repository.dashboardFactsForUser(userId, []);
    if (!facts) throw errors.hotelNotFound();
    return this.createInquiry(facts.hotel, `manual:${idempotencyKey}`, {
      ...input,
      source: { type: "manual", receivedVia: input.receivedVia, createdByUserId: userId },
    }, input.sendOffer, input.offers);
  }

  private async createInquiry(hotel: HotelProfile, idempotencyKey: string, input: PublicInquiryInput, sendOffer = true, choices?: ManualInquiryInput["offers"]) {
    const now = new Date();
    const inquiryId = randomUUID();
    const inquiry: Omit<InquiryRecord, "reservationNumber"> = {
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
      mealPlan: input.mealPlan,
      source: input.source,
      note: input.note,
      attentionReason: sendOffer ? null : "manual_review",
      currentOfferId: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = choices?.length
      ? { ok: true as const, draft: await this.buildStaffInquiryOffer(hotel, inquiry, choices) }
      : sendOffer
        ? await this.buildInquiryOffer(hotel, inquiry)
        : { ok: false as const, attentionReason: "manual_review" as const, issues: [] };

    if (!result.ok) {
      const bundle = await this.repository.createInquiryBundle({
        inquiry: {
          ...this.persistableInquiry(inquiry),
          attentionReason: result.attentionReason,
          source: { ...inquiry.source, automationIssues: result.issues },
        },
      });
      if (!bundle.replayed) {
        await this.safeNotify({
          type: "inquiry",
          hotelId: hotel.id,
          inquiryId: bundle.inquiry.id,
          guestName: bundle.inquiry.guestName,
          checkIn: bundle.inquiry.checkIn,
          checkOut: bundle.inquiry.checkOut,
          mealPlan: input.mealPlan,
          attentionReason: bundle.inquiry.attentionReason,
        });
      }
      return this.intakeResponse(bundle);
    }

    const rawToken = createPublicToken();
    const tokenHash = hashPublicToken(rawToken);
    const offerId = randomUUID();
    const proposalUrl = `${this.publicBaseUrl}/proposal/${rawToken}`;
    const expiresAt = new Date(now.getTime() + OFFER_VALIDITY_MS);
    const offer = {
      id: offerId,
      hotelId: hotel.id,
      inquiryId,
      version: 1,
      state: "active" as const,
      publicTokenHash: tokenHash,
      snapshot: JSON.parse(JSON.stringify({ schemaVersion: 2, ...result.draft })) as Record<string, unknown>,
      expiresAt,
      acceptedAt: null,
      selectedOptionIndex: null,
      revokedAt: null,
    };
    const recipients = sendOffer ? [
      ...(input.guest.email ? [{ channel: "email" as const, recipient: input.guest.email }] : []),
      ...(input.guest.phone ? [{ channel: "whatsapp" as const, recipient: input.guest.phone }] : []),
    ] : [];
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
    if (!bundle.replayed) {
      await this.safeNotify({
        type: "inquiry",
        hotelId: hotel.id,
        inquiryId: bundle.inquiry.id,
        guestName: bundle.inquiry.guestName,
        checkIn: bundle.inquiry.checkIn,
        checkOut: bundle.inquiry.checkOut,
        mealPlan: input.mealPlan,
        attentionReason: bundle.inquiry.attentionReason,
      });
    }
    return { ...this.intakeResponse(bundle), ...(bundle.replayed ? {} : { proposalUrl }) };
  }

  private async buildInquiryOffer(hotel: HotelProfile, inquiry: Omit<InquiryRecord, "reservationNumber">) {
    const catalog = await this.repository.listCatalogForHotel(hotel.id);
    return buildOfferDraft({
      hotel: toDomainHotel(hotel),
      rooms: catalog.rooms.map(toDomainRoom),
      ratePeriods: catalog.ratePeriods.map(toDomainRatePeriod),
      inquiry: toDomainInquiry(inquiry),
    });
  }

  private async buildStaffInquiryOffer(hotel: HotelProfile, inquiry: Omit<InquiryRecord, "reservationNumber">, choices: SendReservationOffersInput["offers"]) {
    const mealPlan = inquiry.mealPlan;
    if (!mealPlan) throw errors.offerBoardRequired();
    const catalog = await this.repository.listCatalogForHotel(hotel.id);
    const options = choices.map((choice) => {
      const room = catalog.rooms.find(({ id }) => id === choice.roomId);
      if (!room) throw errors.roomNotFound();
      const domainRoom = toDomainRoom(room);
      if (!roomFitsOccupancy(domainRoom, inquiry.occupancy)) throw errors.roomCapacityExceeded();
      return {
        roomId: room.id, roomName: room.name,
        roomSnapshot: { description: domainRoom.description, maxAdults: room.maxAdults, maxChildren: room.maxChildren,
          maxGuests: room.maxGuests, beds: room.beds, amenities: room.amenities, photos: domainRoom.photos },
        planCode: "personal", planName: choice.planName, mealPlan,
        currency: hotel.currency, totalCents: choice.totalCents, note: choice.note,
        pricingSource: "staff", nights: [],
      };
    });
    return {
      inquiryId: inquiry.id,
      hotelSnapshot: { id: hotel.id, name: hotel.name, description: hotel.description,
        currency: hotel.currency, locale: hotel.locale, timezone: hotel.timezone,
        logoUrl: hotel.logoUrl, websiteUrl: hotel.website,
        photos: hotel.photoUrls.map((url, sortOrder) => ({ url, alt: hotel.name, sortOrder })) },
      guestSnapshot: { name: inquiry.guestName, checkIn: inquiry.checkIn, checkOut: inquiry.checkOut,
        occupancy: inquiry.occupancy, mealPlan },
      options,
    };
  }

  async sendReservationOffers(userId: string, inquiryId: string, idempotencyKey: string, input: SendReservationOffersInput) {
    const facts = await this.repository.dashboardFactsForUser(userId, [inquiryId]);
    if (!facts) throw errors.hotelNotFound();
    const inquiry = facts.inquiries.find(({ id }) => id === inquiryId);
    if (!inquiry) throw errors.inquiryNotFound();
    // Stable ID makes retries safe without storing or returning the raw token again.
    const digest = createHash("sha256").update(JSON.stringify([facts.hotel.id, inquiryId, idempotencyKey])).digest("hex");
    const offerId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    if (facts.offers.some(({ id }) => id === offerId)) return { inquiry: await this.request(userId, inquiryId), replayed: true };
    if (!inquiry.mealPlan) throw errors.offerBoardRequired();
    if (!inquiry.guestEmail && !inquiry.guestPhone) throw errors.offerContactRequired();
    const draft = await this.buildStaffInquiryOffer(facts.hotel, inquiry, input.offers);
    const now = new Date();
    const rawToken = createPublicToken();
    const offer = {
      id: offerId, hotelId: facts.hotel.id, inquiryId, state: "active" as const,
      publicTokenHash: hashPublicToken(rawToken),
      snapshot: { schemaVersion: 2, ...draft },
      expiresAt: new Date(now.getTime() + OFFER_VALIDITY_MS), acceptedAt: null, selectedOptionIndex: null, revokedAt: null,
    };
    const recipients = [
      ...(inquiry.guestEmail ? [{ channel: "email" as const, recipient: inquiry.guestEmail }] : []),
      ...(inquiry.guestPhone ? [{ channel: "whatsapp" as const, recipient: inquiry.guestPhone }] : []),
    ];
    const result = await this.repository.replaceReservationOffers({
      userId, inquiryId, baseOfferId: input.baseOfferId, offer, now,
      deliveries: recipients.map(({ channel, recipient }) => ({
        id: randomUUID(), hotelId: facts.hotel.id, inquiryId, offerVersionId: offerId, kind: "offer", channel,
        state: "scheduled", idempotencyKey: `${offerId}:${channel}`, recipient,
        payload: { schemaVersion: 1, proposalUrlCiphertext: sealPrivateValue(`${this.publicBaseUrl}/proposal/${rawToken}`, this.authSecret) },
        attemptCount: 0, nextAttemptAt: now, providerMessageId: null, lastErrorCode: null, lastErrorMessage: null, processedAt: null,
      })),
    });
    if (!result) throw errors.inquiryNotFound();
    return { inquiry: await this.request(userId, inquiryId), replayed: result.replayed };
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
      mealPlan: snapshot.guestSnapshot.mealPlan,
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
      mealPlan: verified.mealPlan,
    });
  }

  async proposalPage(rawToken: string) {
    const offer = await this.repository.findOfferByTokenHash(hashPublicToken(rawToken));
    if (!offer) throw errors.offerNotFound();
    const state = offer.acceptedAt ? "accepted" : offer.state === "active" && offer.expiresAt <= new Date() ? "expired" : offer.state;
    const websiteUrl = await this.repository.findPublicHotelWebsite(offer.hotelId);
    return { offer: this.publicOffer(offer), state, websiteUrl };
  }

  async acceptProposal(rawToken: string, selectedOptionIndex = 0) {
    const hash = hashPublicToken(rawToken);
    const now = new Date();
    const current = await this.repository.findOfferByTokenHash(hash);
    if (!current) throw errors.offerNotFound();
    this.ensurePublicOfferAvailable(current, now);
    if (current.state === "accepted" && current.selectedOptionIndex !== selectedOptionIndex) throw errors.offerExpired();
    const options = Array.isArray(current.snapshot.options) ? current.snapshot.options : [];
    if (!Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0 || selectedOptionIndex >= options.length) {
      throw errors.invalidOfferOption();
    }
    const guest = current.snapshot.guestSnapshot;
    const selected = options[selectedOptionIndex];
    const requestedPlan = isRecord(guest) ? snapshotMealPlan(guest.mealPlan) : null;
    const selectedPlan = isRecord(selected) ? snapshotMealPlan(selected.mealPlan) : null;
    if (!selectedPlan || (requestedPlan && selectedPlan !== requestedPlan)) throw errors.invalidOfferOption();
    const offer = await this.repository.acceptOfferByTokenHash(hash, now, selectedOptionIndex);
    if (!offer) throw errors.offerNotFound();
    this.ensurePublicOfferAvailable(offer, now);
    if (offer.selectedOptionIndex !== selectedOptionIndex) throw errors.offerExpired();
    if (current.state !== "accepted" && offer.state === "accepted") {
      const guestSnapshot = offer.snapshot.guestSnapshot;
      const guestName = typeof guestSnapshot === "object" && guestSnapshot && "name" in guestSnapshot
        ? String(guestSnapshot.name)
        : "Guest";
      await this.safeNotify({ type: "payment", hotelId: offer.hotelId, inquiryId: offer.inquiryId, guestName, mealPlan: selectedPlan });
    }
    return this.publicOffer(offer);
  }

  private async safeNotify(event: NotificationEvent): Promise<void> {
    try {
      await this.notifications?.notify(event);
    } catch {
      // Notifications must never prevent a guest request or acceptance from completing.
    }
  }

  async markPaymentLinkSent(userId: string, inquiryId: string) {
    const inquiry = await this.repository.markPaymentLinkSentForUser(userId, inquiryId, new Date());
    if (!inquiry) throw errors.inquiryNotFound();
    return { inquiryId: inquiry.id, reservationNumber: inquiry.reservationNumber, paymentLinkSentAt: inquiry.closedAt?.toISOString() ?? null };
  }

  async dashboard(userId: string, query: DashboardQuery) {
    const facts = await this.repository.dashboardPageForUser(userId, query);
    if (!facts) throw errors.hotelNotFound();
    const items = this.requestSummaries(facts);
    return {
      hotel: { id: facts.hotel.id, name: facts.hotel.name, publicKey: facts.hotel.publicKey },
      counts: facts.counts,
      pagination: facts.pagination,
      inquiries: items,
    };
  }

  async requests(userId: string, inquiryIds: string[]) {
    const facts = await this.repository.dashboardFactsForUser(userId, inquiryIds);
    if (!facts) throw errors.hotelNotFound();
    return this.requestSummaries(facts);
  }

  async request(userId: string, inquiryId: string) {
    const [inquiry] = await this.requests(userId, [inquiryId]);
    if (!inquiry) throw errors.inquiryNotFound();
    return inquiry;
  }

  private requestSummaries(facts: DashboardFacts) {
    const now = new Date();
    return facts.inquiries.map((inquiry) => {
      const offers = facts.offers.filter(({ inquiryId }) => inquiryId === inquiry.id);
      const latest = offers.sort((a, b) => b.version - a.version)[0];
      const deliveries = facts.deliveries
        .filter(
          (delivery) =>
            delivery.inquiryId === inquiry.id &&
            (latest === undefined || delivery.offerVersionId === latest.id),
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
      const emailDelivery = deliveries.find(({ channel }) => channel === "email");
      const whatsappDelivery = deliveries.find(({ channel }) => channel === "whatsapp");
      const sentAt = deliveries
        .filter(({ state }) => state === "provider_accepted" || state === "delivered")
        .map((delivery) => delivery.processedAt ?? delivery.createdAt)
        .sort((left, right) => left.getTime() - right.getTime())[0];
      const workflowState = inquiry.closedAt
        ? "payment_link_sent"
        : latest?.acceptedAt
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
        reservationNumber: inquiry.reservationNumber,
        guestName: inquiry.guestName,
        guestEmail: inquiry.guestEmail,
        guestPhone: inquiry.guestPhone,
        locale: inquiry.locale,
        note: inquiry.note,
        receivedVia: inquiry.source.type === "manual" ? inquiry.source.receivedVia : null,
        checkIn: inquiry.checkIn,
        checkOut: inquiry.checkOut,
        occupancy: inquiry.occupancy,
        mealPlan: inquiry.mealPlan,
        offerSummary: latest ? offerSummary(latest) : null,
        currentOfferId: latest?.id ?? null,
        offers: latest ? reservationOffers(latest, now) : [],
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
        offerExpiresAt: latest?.expiresAt.toISOString() ?? null,
        offerSentAt: sentAt?.toISOString() ?? null,
        acceptedAt: latest?.acceptedAt?.toISOString() ?? null,
        paymentLinkSentAt: inquiry.closedAt?.toISOString() ?? null,
        createdAt: inquiry.createdAt.toISOString(),
      };
    });
  }

  private persistableInquiry(inquiry: Omit<InquiryRecord, "reservationNumber">) {
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
      mealPlan: sample.mealPlan ?? "BB",
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
        mealPlan: sample.mealPlan ?? period.mealPlan,
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
        mealPlan: requested.mealPlan,
      },
      options: [],
    };
  }

  private buildTestDraft(
    hotel: NonNullable<Awaited<ReturnType<AutomationRepository["findPublicHotelByKey"]>>>,
    catalog: Awaited<ReturnType<AutomationRepository["listCatalogForHotel"]>>,
    sample: { guestName: string; checkIn: string; checkOut: string; adults: number; mealPlan: MealPlan },
  ) {
    const now = new Date();
    const inquiry: Omit<InquiryRecord, "reservationNumber"> = {
      id: randomUUID(), hotelId: hotel.id, idempotencyKey: `test:${randomUUID()}`,
      guestName: sample.guestName, guestEmail: null, guestPhone: null, locale: hotel.locale,
      checkIn: sample.checkIn, checkOut: sample.checkOut,
      occupancy: { adults: sample.adults, childAges: [] }, source: { test: true }, note: "",
      mealPlan: sample.mealPlan,
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
      reservationNumber: bundle.inquiry.reservationNumber,
      mealPlan: bundle.inquiry.mealPlan,
      automated: bundle.inquiry.currentOfferId !== null || bundle.offer !== null,
      attentionReason: bundle.inquiry.attentionReason,
      deliveriesScheduled: bundle.deliveries.length,
      replayed: bundle.replayed,
    };
  }

  private ensurePublicOfferAvailable(offer: OfferRecord, now: Date): void {
    if (offer.state === "accepted" && offer.acceptedAt) return;
    if (offer.state === "revoked" || offer.revokedAt) throw errors.offerRevoked();
    if (offer.state === "expired" || offer.expiresAt <= now) throw errors.offerExpired();
  }

  private publicOffer(offer: OfferRecord) {
    return {
      id: offer.id,
      state: offer.state,
      snapshot: offer.snapshot,
      expiresAt: offer.expiresAt.toISOString(),
      acceptedAt: offer.acceptedAt?.toISOString() ?? null,
      selectedOptionIndex: offer.selectedOptionIndex,
      offers: reservationOffers(offer, new Date()),
    };
  }
}

function reservationOffers(offer: OfferRecord, now: Date): ReservationOffer[] {
  if (!Array.isArray(offer.snapshot.options)) return [];
  return offer.snapshot.options.flatMap((option, index) => {
    if (!isRecord(option) || typeof option.roomId !== "string" || typeof option.roomName !== "string" ||
      typeof option.totalCents !== "number" || typeof option.currency !== "string") return [];
    const status = offer.state === "accepted" && offer.selectedOptionIndex === index ? "accepted" as const
      : offer.state === "active" && !offer.revokedAt && offer.expiresAt > now ? "available" as const : "expired" as const;
    return [{ id: `${offer.id}:${index}`, roomId: option.roomId, roomName: option.roomName,
      planName: typeof option.planName === "string" ? option.planName : "Personal offer",
      mealPlan: snapshotMealPlan(option.mealPlan), totalCents: option.totalCents, currency: option.currency,
      note: typeof option.note === "string" ? option.note : "", status, expiresAt: offer.expiresAt.toISOString() }];
  });
}

function deliverySummary(delivery: DeliveryRecord) {
  return {
    state: delivery.state,
    recipient: delivery.recipient,
    lastErrorCode: delivery.lastErrorCode,
    processedAt: delivery.processedAt?.toISOString() ?? null,
  };
}

function offerSummary(offer: OfferRecord): { roomName: string; mealPlan: MealPlan | null; totalCents: number; currency: string } | null {
  const options = offer.snapshot.options;
  if (!Array.isArray(options)) return null;
  const selectedIndex = offer.selectedOptionIndex ?? 0;
  const selected = options[selectedIndex];
  if (!isRecord(selected)) return null;
  const { roomName, totalCents, currency } = selected;
  if (typeof roomName !== "string" || typeof totalCents !== "number" || typeof currency !== "string") return null;
  return { roomName, mealPlan: snapshotMealPlan(selected.mealPlan), totalCents, currency };
}

function snapshotMealPlan(value: unknown): MealPlan | null {
  // Existing immutable breakfast offers retain their original snapshots.
  if (value === "breakfast") return "BB";
  const parsed = mealPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
