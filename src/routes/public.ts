import type { FastifyInstance } from "fastify";
import { listApproved, getFlyerByPublicId, type FeedFilters } from "../public/query.js";
import { render } from "../views/render.js";
import { config } from "../config.js";

function parseFilters(q: Record<string, string | undefined>): FeedFilters {
  return {
    q: q.q || undefined,
    city: q.city || undefined,
    state: q.state || undefined,
    zip: q.zip || undefined,
    includeExpired: q.includeExpired === "1" || q.includeExpired === "on",
    cursor: q.cursor ? Number(q.cursor) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  };
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string | undefined> }>("/", async (req, reply) => {
    const filters = parseFilters(req.query);
    const page = listApproved(filters, config.PUBLIC_BASE_URL);
    const html = await render("index.eta", { filters, page });
    reply.type("text/html; charset=utf-8").send(html);
  });

  // Partial used by htmx to append additional cards on "Load more".
  app.get<{ Querystring: Record<string, string | undefined> }>("/feed", async (req, reply) => {
    const filters = parseFilters(req.query);
    const page = listApproved(filters, config.PUBLIC_BASE_URL);
    const html = await render("_cards.eta", { filters, page });
    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get<{ Params: { publicId: string } }>("/flyer/:publicId", async (req, reply) => {
    const flyer = getFlyerByPublicId(req.params.publicId, config.PUBLIC_BASE_URL);
    if (!flyer) return reply.code(404).type("text/html").send(await render("404.eta", {}));
    const html = await render("flyer.eta", { flyer });
    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/healthz", async (_req, reply) => reply.type("text/plain").send("ok"));
}
