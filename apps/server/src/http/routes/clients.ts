import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clientListQuerySchema } from "@hotel/contracts";
import { AppError } from "../../lib/errors.js";
import type { ClientRepository } from "../../repositories/clients.js";
import { clientIdentity, ensureClientIdentity } from "../../services/client-identity.js";
import type { AuthService } from "../../services/auth.js";
import { requireAuthentication } from "../authenticate.js";

const inputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().max(320).nullable().default(null),
  phone: z.string().trim().min(5).max(50).nullable().default(null),
  locale: z.string().trim().min(2).max(16).default("en"),
  notes: z.string().trim().max(2000).default(""),
});
const pageSchema = z.object({ cursor: z.uuid().optional() });

export async function registerClientRoutes(app: FastifyInstance, auth: AuthService, clients: ClientRepository) {
  const preHandler = requireAuthentication(auth);
  // Contacts cannot build an unbounded queue on their small, separate pool.
  let active = 0;
  const limited = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= 2) throw new AppError(503, "CLIENTS_BUSY", "Contacts are busy. Please try again shortly.");
    active++;
    try { return await operation(); } finally { active--; }
  };
  app.get("/v1/clients", { preHandler }, async (request) => {
    const { search, cursor, ...filters } = clientListQuerySchema.parse(request.query);
    return { data: await limited(() => clients.list(request.currentUser!.id, search, cursor, filters)) };
  });
  app.get("/v1/clients/filter-options", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { data: await limited(() => clients.filterOptions(request.currentUser!.id)) };
  });
  app.get("/v1/clients/:clientId", { preHandler }, async (request, reply) => {
    const { clientId } = z.object({ clientId: z.uuid() }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    return { data: { client: await limited(() => clients.find(request.currentUser!.id, clientId)) } };
  });
  app.post("/v1/clients", { preHandler }, async (request, reply) => {
    const input = inputSchema.parse(request.body);
    ensureClientIdentity(input);
    if (input.phone && !clientIdentity(input).normalizedPhone) {
      throw new AppError(422, "CLIENT_PHONE_INVALID", "Include the phone country code, for example +39 333 1234567.");
    }
    const result = await limited(() => clients.create(request.currentUser!.id, input));
    return reply.code(result.created ? 201 : 200).send({ data: result });
  });
  app.post("/v1/clients/request-statuses", { preHandler }, async (request, reply) => {
    const { inquiryIds } = z.object({ inquiryIds: z.array(z.uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]) }).parse(request.body);
    reply.header("Cache-Control", "no-store");
    return { data: { statuses: await limited(() => clients.statuses(request.currentUser!.id, inquiryIds)) } };
  });
  app.post("/v1/inquiries/:inquiryId/client", { preHandler }, async (request, reply) => {
    const { inquiryId } = z.object({ inquiryId: z.uuid() }).parse(request.params);
    const result = await limited(() => clients.addFromInquiry(request.currentUser!.id, inquiryId));
    return reply.code(result.created ? 201 : 200).send({ data: result });
  });
  app.get("/v1/clients/:clientId/requests", { preHandler }, async (request) => {
    const { clientId } = z.object({ clientId: z.uuid() }).parse(request.params);
    const { cursor } = pageSchema.parse(request.query);
    return { data: await limited(() => clients.history(request.currentUser!.id, clientId, cursor)) };
  });
}
