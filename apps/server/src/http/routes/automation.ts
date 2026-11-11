import { supportedLanguage } from "@hotel/i18n";
import type { FastifyInstance } from "fastify";
import { DEMO_OFFER_PATH, demoOfferSnapshot, renderDemoOfferPage, renderPublicOfferPage, type OfferSnapshot } from "@hotel/templates";
import { z } from "zod";
import { dashboardQuerySchema, inquiryFormInputSchema, manualInquiryInputSchema, offerSettingsSchema, reservationOfferInputSchema, sendReservationOffersSchema } from "@hotel/contracts";

import { AppError, errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import type { AutomationService } from "../../services/automation.js";
import { requireAuthentication } from "../authenticate.js";
import {
  publicHotelParamsSchema,
  publicInquirySchema,
  publicOfferParamsSchema,
  acceptOfferSchema,
} from "../public-schemas.js";

export async function registerAutomationRoutes(
  app: FastifyInstance,
  authService: AuthService,
  automationService: AutomationService,
): Promise<void> {
  app.post(
    "/v1/public/hotels/:publicKey/inquiries",
    { config: { cors: { origin: true } } },
    async (request, reply) => {
      const { publicKey } = publicHotelParamsSchema.parse(request.params);
      const idempotencyHeader = request.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
      if (!idempotencyKey) throw errors.idempotencyKeyRequired();
      const parsed = publicInquirySchema.parse(request.body);
      if (parsed.website) {
        return reply.code(202).send({
          data: { automated: false, attentionReason: null, deliveriesScheduled: 0, replayed: false },
        });
      }
      const { website: _website, ...inquiry } = parsed;
      const result = await automationService.intake(
        publicKey,
        request.headers.origin,
        idempotencyKey,
        inquiry,
      );
      return reply.code(result.replayed ? 200 : 202).send({ data: result });
    },
  );

  app.get(
    "/v1/public/offers/:token",
    { config: { cors: { origin: true } } },
    async (request) => {
      const { token } = publicOfferParamsSchema.parse(request.params);
      return { data: { offer: await automationService.getProposal(token) } };
    },
  );

  app.post(
    "/v1/public/offers/:token/accept",
    { config: { cors: { origin: true } } },
    async (request) => {
      const { token } = publicOfferParamsSchema.parse(request.params);
      const { option } = acceptOfferSchema.parse(request.body ?? {});
      return { data: { offer: await automationService.acceptProposal(token, option) } };
    },
  );

  app.get(DEMO_OFFER_PATH, async (request, reply) => {
    const query = z.object({ accepted: z.literal("1").optional(), lang: z.enum(["en", "it"]).default("it"), option: z.coerce.number().int().min(0).max(demoOfferSnapshot.options.length - 1).default(0) }).parse(request.query);
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet")
      .type("text/html; charset=utf-8")
      .send(renderDemoOfferPage(query.accepted === "1", query.option, query.lang));
  });

  app.post(`${DEMO_OFFER_PATH}/accept`, async (request, reply) => {
    const { option } = z.object({ option: z.coerce.number().int().min(0).max(demoOfferSnapshot.options.length - 1).default(0) }).parse(request.body ?? {});
    return reply.redirect(`${DEMO_OFFER_PATH}?accepted=1&option=${option}${supportedLanguage((request.body as { lang?: string } | undefined)?.lang) ? `&lang=${supportedLanguage((request.body as { lang?: string }).lang)}` : ""}`, 303);
  });

  app.get("/proposal/test/:token", async (request, reply) => {
    const { token } = publicOfferParamsSchema.parse(request.params);
    const snapshot = await automationService.testProposalPage(token);
    const accepted = (request.query as { accepted?: unknown }).accepted === "1";
    const html = renderPublicOfferPage(snapshot as unknown as OfferSnapshot, {
      state: accepted ? "accepted" : "active",
      acceptActionPath: `/proposal/test/${token}/accept`,
      testMode: true,
      ...(supportedLanguage((request.query as { lang?: string }).lang) ? { locale: supportedLanguage((request.query as { lang?: string }).lang)! } : {}),
    });
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet")
      .type("text/html; charset=utf-8")
      .send(html);
  });

  app.post("/proposal/test/:token/accept", async (request, reply) => {
    const { token } = publicOfferParamsSchema.parse(request.params);
    await automationService.testProposalPage(token);
    return reply.redirect(`/proposal/test/${token}?accepted=1${supportedLanguage((request.body as { lang?: string } | undefined)?.lang) ? `&lang=${supportedLanguage((request.body as { lang?: string }).lang)}` : ""}`, 303);
  });

  app.get("/proposal/:token", async (request, reply) => {
    const { token } = publicOfferParamsSchema.parse(request.params);
    const { offer, state, websiteUrl } = await automationService.proposalPage(token);
    const html = renderPublicOfferPage(offer.snapshot as unknown as OfferSnapshot, {
      state,
      websiteUrl,
      ...(supportedLanguage((request.query as { lang?: string }).lang) ? { locale: supportedLanguage((request.query as { lang?: string }).lang)! } : {}),
      acceptActionPath: `/proposal/${token}/accept`,
      ...(offer.selectedOptionIndex === null ? {} : { selectedOptionIndex: offer.selectedOptionIndex }),
    });
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet")
      .type("text/html; charset=utf-8")
      .send(html);
  });

  app.post("/proposal/:token/accept", async (request, reply) => {
    const { token } = publicOfferParamsSchema.parse(request.params);
    const { option } = acceptOfferSchema.parse(request.body ?? {});
    try {
      await automationService.acceptProposal(token, option);
    } catch (error) {
      // A stale browser form should land on the same expired screen as the email link.
      if (!(error instanceof AppError) || error.statusCode !== 410) throw error;
    }
    return reply.redirect(`/proposal/${token}${supportedLanguage((request.body as { lang?: string } | undefined)?.lang) ? `?lang=${supportedLanguage((request.body as { lang?: string }).lang)}` : ""}`, 303);
  });

  const authenticate = requireAuthentication(authService);
  app.get("/v1/offer-settings", { preHandler: authenticate }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { data: { settings: await automationService.offerSettings(request.currentUser!.id) } };
  });
  app.put("/v1/offer-settings", { preHandler: authenticate }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { data: { settings: await automationService.saveOfferSettings(request.currentUser!.id, offerSettingsSchema.parse(request.body)) } };
  });
  app.get("/v1/inquiries/:inquiryId/offer-editor", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    return { data: await automationService.offerEditor(request.currentUser!.id, inquiryId) };
  });
  app.post("/v1/inquiries/:inquiryId/offers/preview", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    return { data: { offer: await automationService.previewReservationOffer(request.currentUser!.id, inquiryId, reservationOfferInputSchema.parse(request.body)) } };
  });
  app.post("/v1/inquiries/form", { preHandler: authenticate }, async (request, reply) => {
    const key = z.string().trim().min(1).max(155).safeParse(request.headers["idempotency-key"]);
    if (!key.success) throw errors.idempotencyKeyRequired();
    const input = inquiryFormInputSchema.parse(request.body);
    const result = await automationService.createFormInquiry(request.currentUser!.id, key.data, input);
    reply.header("Cache-Control", "private, no-store");
    return reply.code(result.replayed ? 200 : 202).send({ data: result });
  });
  app.post("/v1/inquiries/:inquiryId/offers", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    const key = z.string().trim().min(1).max(153).safeParse(request.headers["idempotency-key"]);
    if (!key.success) throw errors.idempotencyKeyRequired();
    const input = sendReservationOffersSchema.parse(request.body);
    const result = await automationService.sendReservationOffers(request.currentUser!.id, inquiryId, key.data, input);
    reply.header("Cache-Control", "private, no-store");
    return reply.code(result.replayed ? 200 : 201).send({ data: result });
  });
  app.post("/v1/inquiries", { preHandler: authenticate }, async (request, reply) => {
    const key = z.string().trim().min(1).max(153).safeParse(request.headers["idempotency-key"]);
    if (!key.success) throw errors.idempotencyKeyRequired();
    const input = manualInquiryInputSchema.parse(request.body);
    const result = await automationService.createManualInquiry(request.currentUser!.id, key.data, input);
    reply.header("Cache-Control", "private, no-store");
    return reply.code(result.replayed ? 200 : 201).send({ data: result });
  });
  app.get("/v1/inquiries/:inquiryId", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    return { data: { inquiry: await automationService.request(request.currentUser!.id, inquiryId) } };
  });
  app.get("/v1/inquiries/:inquiryId/share-message", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    const { channel, language } = z.object({ channel: z.enum(["email", "whatsapp"]), language: z.enum(["en", "it"]).optional() }).parse(request.query);
    reply.header("Cache-Control", "private, no-store");
    return { data: { message: await automationService.offerShareMessage(request.currentUser!.id, inquiryId, channel, language) } };
  });
  app.post("/v1/inquiries/:inquiryId/manual-sent", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    const key = z.string().trim().min(1).max(153).safeParse(request.headers["idempotency-key"]);
    if (!key.success) throw errors.idempotencyKeyRequired();
    const { channel, language } = z.object({ channel: z.enum(["email", "whatsapp"]), language: z.enum(["en", "it"]) }).parse(request.body);
    reply.header("Cache-Control", "private, no-store");
    return { data: await automationService.markManualOfferSent(request.currentUser!.id, inquiryId, key.data, channel, language) };
  });
  app.post("/v1/inquiries/summaries", { preHandler: authenticate }, async (request, reply) => {
    const { inquiryIds } = z.object({ inquiryIds: z.array(z.uuid()).min(1).max(100) }).parse(request.body);
    reply.header("Cache-Control", "private, no-store");
    return { data: { inquiries: await automationService.requests(request.currentUser!.id, [...new Set(inquiryIds)]) } };
  });
  app.post("/v1/inquiries/:inquiryId/payment-link-sent", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    return { data: await automationService.markPaymentLinkSent(request.currentUser.id, inquiryId) };
  });

  app.get("/v1/dashboard", { preHandler: authenticate }, async (request, reply) => {
    if (!request.currentUser) throw errors.unauthorized();
    const query = dashboardQuerySchema.parse(request.query);
    reply.header("Cache-Control", "private, no-store");
    return { data: await automationService.dashboard(request.currentUser.id, query) };
  });
}
