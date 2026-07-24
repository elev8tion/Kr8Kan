import { generateOpenApiDocument } from "trpc-to-openapi";

import { appRouter } from "./root";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3310";

export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: "Kr8Kan API",
  description:
    "Self-hosted kanban REST API. Authenticate with an API key (Authorization: Bearer <key> or x-api-key header) created in Settings → API.",
  version: "0.1.0",
  baseUrl: `${baseUrl}/api/v1`,
  securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer" },
    apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
  },
});
