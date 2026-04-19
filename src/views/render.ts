import { Eta } from "eta";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export const eta = new Eta({
  views: resolve(HERE),
  cache: process.env.NODE_ENV === "production",
  autoTrim: false,
});

export async function render(name: string, data: Record<string, unknown>): Promise<string> {
  const out = await eta.renderAsync(name, { fmt, ...data });
  return out ?? "";
}

/** Format helpers exposed to templates via `data.fmt`. */
export const fmt = {
  dateTime(ms: number | null | undefined): string {
    if (!ms) return "";
    const d = new Date(ms);
    return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  },
  date(ms: number | null | undefined): string {
    if (!ms) return "";
    const d = new Date(ms);
    return d.toLocaleDateString("en-US", { dateStyle: "medium" });
  },
  location(r: { venue?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
    const parts = [r.venue, [r.city, r.state].filter(Boolean).join(", "), r.zip].filter(Boolean);
    return parts.join(" · ");
  },
};
