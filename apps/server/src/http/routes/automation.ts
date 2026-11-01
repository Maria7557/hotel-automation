import type { FastifyInstance } from "fastify";
import { renderPublicOfferPage, type OfferSnapshot } from "@hotel/templates";
import { z } from "zod";

import { errors } from "../../lib/errors.js";
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

  app.get("/proposal/test/:token", async (request, reply) => {
    const { token } = publicOfferParamsSchema.parse(request.params);
    const snapshot = await automationService.testProposalPage(token);
    const accepted = (request.query as { accepted?: unknown }).accepted === "1";
    const html = renderPublicOfferPage(snapshot as unknown as OfferSnapshot, {
      state: accepted ? "accepted" : "active",
      acceptActionPath: `/proposal/test/${token}/accept`,
      locale: snapshot.hotelSnapshot.locale,
      testMode: true,
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
    return reply.redirect(`/proposal/test/${token}?accepted=1`, 303);
  });

  app.get("/proposal/:token", async (request, reply) => {
    const { token } = publicOfferParamsSchema.parse(request.params);
    const { offer, state } = await automationService.proposalPage(token);
    const hotelSnapshot = offer.snapshot.hotelSnapshot;
    const html = renderPublicOfferPage(offer.snapshot as unknown as OfferSnapshot, {
      state,
      acceptActionPath: `/proposal/${token}/accept`,
      locale: typeof hotelSnapshot === "object" && hotelSnapshot && "locale" in hotelSnapshot
        ? String(hotelSnapshot.locale)
        : "it",
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
    await automationService.acceptProposal(token, option);
    return reply.redirect(`/proposal/${token}`, 303);
  });

  const authenticate = requireAuthentication(authService);
  app.post("/v1/inquiries/:inquiryId/payment-link-sent", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    return { data: await automationService.markPaymentLinkSent(request.currentUser.id, inquiryId) };
  });

  app.get("/v1/dashboard", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    return { data: await automationService.dashboard(request.currentUser.id) };
  });
}
