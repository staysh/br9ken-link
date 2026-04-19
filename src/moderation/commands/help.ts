import type { CommandContext } from "./index.js";

export function helpCommand(_ctx: CommandContext): string {
  return [
    "Commands:",
    "  <ID> YES  — approve flyer",
    "  <ID> NO   — reject flyer",
    "  !HELP     — this message",
  ].join("\n");
}
