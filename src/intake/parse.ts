export interface ParsedBody {
  title?: string;
  venue?: string;
  city?: string;
  state?: string;
  zip?: string;
  eventStart?: number | null;
  eventEnd?: number | null;
  description?: string;
  parseErrors: string[];
}

const LABEL_RE = /^\s*(title|when|start|end|where|venue|city|state|zip|description|desc)\s*[:\-]\s*(.+)$/i;
const CITY_ST_ZIP_RE = /^\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*$/;
const CITY_ST_RE = /^\s*(.+?),\s*([A-Za-z]{2})\s*$/;
const BARE_ZIP_RE = /^\s*(\d{5})(?:-\d{4})?\s*$/;

function toEpochMs(s: string): number | null {
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse an MMS body into flyer fields. Lenient: missing fields produce
 * `parseErrors` but never throw. Unlabeled lines accumulate into description.
 */
export function parseBody(body: string): ParsedBody {
  const out: ParsedBody = { parseErrors: [] };
  const extraDesc: string[] = [];

  const lines = (body ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const m = LABEL_RE.exec(line);
    if (m) {
      const key = m[1]!.toLowerCase();
      const val = m[2]!.trim();
      applyLabel(out, key, val);
      continue;
    }
    const cityStZip = CITY_ST_ZIP_RE.exec(line);
    if (cityStZip) {
      out.city ??= cityStZip[1]!.trim();
      out.state ??= cityStZip[2]!.toUpperCase();
      out.zip ??= cityStZip[3]!;
      continue;
    }
    const cityOnly = CITY_ST_RE.exec(line);
    if (cityOnly && !out.city && !out.state) {
      out.city = cityOnly[1]!.trim();
      out.state = cityOnly[2]!.toUpperCase();
      continue;
    }
    const zipOnly = BARE_ZIP_RE.exec(line);
    if (zipOnly && !out.zip) {
      out.zip = zipOnly[1]!;
      continue;
    }
    extraDesc.push(line);
  }

  if (extraDesc.length) {
    out.description = [out.description, extraDesc.join(" ")].filter(Boolean).join("\n\n");
  }

  if (!out.title) out.parseErrors.push("missing Title");
  if (!out.eventStart) out.parseErrors.push("missing or unparseable When/Start");
  if (!out.city && !out.zip) out.parseErrors.push("missing location (need City, ST or ZIP)");

  return out;
}

function applyLabel(out: ParsedBody, key: string, val: string): void {
  switch (key) {
    case "title":
      out.title = val;
      return;
    case "when":
    case "start": {
      const ms = toEpochMs(val);
      if (ms == null) out.parseErrors.push(`could not parse When: "${val}"`);
      out.eventStart = ms;
      return;
    }
    case "end": {
      const ms = toEpochMs(val);
      if (ms == null) out.parseErrors.push(`could not parse End: "${val}"`);
      out.eventEnd = ms;
      return;
    }
    case "where":
    case "venue":
      out.venue = val;
      return;
    case "city": {
      // Accept "City, ST" or "City, ST 12345" on this line too.
      const m = CITY_ST_ZIP_RE.exec(val) ?? CITY_ST_RE.exec(val);
      if (m) {
        out.city = m[1]!.trim();
        out.state = m[2]!.toUpperCase();
        if (m[3]) out.zip = m[3];
      } else {
        out.city = val;
      }
      return;
    }
    case "state":
      out.state = val.slice(0, 2).toUpperCase();
      return;
    case "zip": {
      const m = BARE_ZIP_RE.exec(val);
      if (m) out.zip = m[1]!;
      else out.parseErrors.push(`invalid ZIP: "${val}"`);
      return;
    }
    case "description":
    case "desc":
      out.description = [out.description, val].filter(Boolean).join("\n\n");
      return;
  }
}
