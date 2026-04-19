import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { desc, eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { flyer, flyerMedia } from "../db/schema.js";
import { mintLoginLinkByEmail, consumeLoginToken, getModeratorById } from "../admin/auth.js";
import { sendMagicLink } from "../mail/mailer.js";
import { decide } from "../moderation/decide.js";
import { render } from "../views/render.js";
import { config } from "../config.js";

declare module "@fastify/secure-session" {
  interface SessionData {
    moderatorId: string;
  }
}

async function requireModerator(req: FastifyRequest, reply: FastifyReply): Promise<{ id: string; isSuperAdmin: boolean; name: string } | null> {
  const id = req.session.get("moderatorId");
  if (!id) {
    reply.redirect("/admin/login");
    return null;
  }
  const m = getModeratorById(id);
  if (!m) {
    req.session.delete();
    reply.redirect("/admin/login");
    return null;
  }
  return m;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/login", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send(await render("admin/login.eta", { sent: false }));
  });

  app.post<{ Body: { email?: string } }>("/admin/login", async (req, reply) => {
    const email = (req.body?.email ?? "").trim().toLowerCase();
    if (email) {
      const link = mintLoginLinkByEmail(email);
      if (link) {
        const mailRes = await sendMagicLink({ to: email, url: link.url });
        if (mailRes.skipped && config.NODE_ENV !== "production") {
          req.log.info({ url: link.url, email }, "admin magic link (mail disabled)");
        }
      }
    }
    reply.type("text/html; charset=utf-8").send(await render("admin/login.eta", { sent: true }));
  });

  app.get<{ Params: { token: string } }>("/admin/login/:token", async (req, reply) => {
    const res = consumeLoginToken(req.params.token);
    if (!res) return reply.code(400).type("text/html").send(await render("admin/login.eta", { sent: false, error: "Link invalid or expired." }));
    req.session.set("moderatorId", res.moderatorId);
    reply.redirect("/admin");
  });

  app.post("/admin/logout", async (req, reply) => {
    req.session.delete();
    reply.redirect("/admin/login");
  });

  app.get("/admin", async (req, reply) => {
    const me = await requireModerator(req, reply);
    if (!me) return;
    const db = openDb();
    const pending = db.select().from(flyer).where(eq(flyer.status, "pending")).orderBy(desc(flyer.createdAt)).limit(50).all();
    const pendingWithMedia = pending.map((f) => ({
      ...f,
      primary: db.select().from(flyerMedia).where(eq(flyerMedia.flyerId, f.id)).get() ?? null,
    }));
    reply.type("text/html; charset=utf-8").send(await render("admin/index.eta", { me, pending: pendingWithMedia }));
  });

  app.post<{ Body: { shortId?: string; decision?: string } }>("/admin/decide", async (req, reply) => {
    const me = await requireModerator(req, reply);
    if (!me) return;
    const shortId = (req.body?.shortId ?? "").toUpperCase();
    const d = req.body?.decision === "approve" ? "approved" : req.body?.decision === "reject" ? "rejected" : null;
    if (!shortId || !d) return reply.redirect("/admin");
    await decide({ shortId, moderatorId: me.id, decision: d });
    reply.redirect("/admin");
  });
}
