// Shared by the delete-account dialog (client) and the public /account/delete
// page (server), which cannot read constants out of a "use client" module.

/** What deleting an account takes with it. */
export const DELETED_WITH_ACCOUNT = [
  "Every manuscript, with its chapters, snapshots and edit history",
  "Story bibles, characters, plot points and scratch notes",
  "Chat with the editor, recaps and weekly reviews",
  "Share links, and the comments beta readers left on them",
  "Folders, reading positions, writing stats and settings",
] as const;

/** Typed by an account with no password (Apple / Google) to confirm deletion. */
export const DELETE_CONFIRMATION = "DELETE";

/** GET: the signed-in account's data as one zip (src/app/api/account/export). */
export const EXPORT_URL = "/api/account/export";
