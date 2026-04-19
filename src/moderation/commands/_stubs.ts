/**
 * Placeholder handlers for the expanded SMS command surface described in the
 * spec. None of these are registered in the v1 router; they exist so the shape
 * is obvious when a later sprint wires them up.
 *
 * Expected verbs (super-admin only unless noted):
 *   !ADD MOD <+E164> <ZIP> <Name...>
 *   !REMOVE MOD <+E164>
 *   !PROMOTE <+E164>
 *   !DEMOTE <+E164>
 *   !LIST MODS
 *   !REMOVE FLYER <shortId|publicId>
 *   !ADD FEED <slug> <scope> [value]
 *   !REMOVE FEED <slug>
 *   !STATUS <shortId>                (any moderator)
 */

import type { CommandHandler } from "./index.js";

export const addMod: CommandHandler = () => "not implemented";
export const removeMod: CommandHandler = () => "not implemented";
export const promote: CommandHandler = () => "not implemented";
export const demote: CommandHandler = () => "not implemented";
export const listMods: CommandHandler = () => "not implemented";
export const removeFlyer: CommandHandler = () => "not implemented";
export const addFeed: CommandHandler = () => "not implemented";
export const removeFeed: CommandHandler = () => "not implemented";
export const status: CommandHandler = () => "not implemented";
