// Minimal MIME-to-extension map. Only covers the types we expect from MMS.
const MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "video/webm": "webm",
};

export function extension(mime: string): string {
  const clean = mime.split(";")[0]!.trim().toLowerCase();
  return MAP[clean] ?? "bin";
}

export function kindFromMime(mime: string): "image" | "video" | null {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return null;
}
