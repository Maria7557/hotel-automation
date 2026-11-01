import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AuthService } from "../../services/auth.js";
import { requireAuthentication } from "../authenticate.js";

const MAX_IMAGE_BYTES = 5 * 1_024 * 1_024;
const uploadSchema = z.object({
  base64: z.string().min(1).max(Math.ceil(MAX_IMAGE_BYTES * 1.4)),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

const formats = {
  "image/jpeg": { extension: "jpg", signature: (value: Buffer) => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff },
  "image/png": { extension: "png", signature: (value: Buffer) => value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", signature: (value: Buffer) => value.subarray(0, 4).toString("ascii") === "RIFF" && value.subarray(8, 12).toString("ascii") === "WEBP" },
} as const;

export async function registerMediaRoutes(
  app: FastifyInstance,
  authService: AuthService,
  publicBaseUrl?: string,
): Promise<void> {
  const authenticate = requireAuthentication(authService);
  const directory = process.env.UPLOADS_DIRECTORY || join(process.cwd(), "data", "uploads");

  app.post("/v1/media/images", { preHandler: authenticate, bodyLimit: 8 * 1_024 * 1_024 }, async (request, reply) => {
    const input = uploadSchema.parse(request.body);
    const image = Buffer.from(input.base64, "base64");
    const format = formats[input.mimeType];
    if (image.length === 0 || image.length > MAX_IMAGE_BYTES || !format.signature(image)) {
      return reply.code(400).send({
        error: { code: "INVALID_IMAGE", message: "Upload a valid JPEG, PNG or WebP image up to 5 MB." },
      });
    }

    await mkdir(directory, { recursive: true });
    const fileName = `${randomUUID()}.${format.extension}`;
    await writeFile(join(directory, fileName), image, { flag: "wx" });
    const requestBaseUrl = `${request.protocol}://${request.headers.host ?? "localhost:4000"}`;
    const baseUrl = (publicBaseUrl || requestBaseUrl).replace(/\/$/, "");
    return reply.code(201).send({ data: { url: `${baseUrl}/media/${fileName}` } });
  });

  app.get("/media/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().regex(/^[0-9a-f-]+\.(?:jpg|png|webp)$/) }).parse(request.params);
    try {
      const image = await readFile(join(directory, fileName));
      const contentType = fileName.endsWith(".png") ? "image/png" : fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return reply.type(contentType).header("Cache-Control", "public, max-age=31536000, immutable").send(image);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Image was not found." } });
      }
      throw error;
    }
  });
}
