import { describe, expect, it } from "vitest";
import { quickActionsFor as serverActionsFor } from "@/lib/prompts";
import { quickActionsFor as phoneActionsFor } from "../apps/mobile/lib/quick-actions";
import { MANUSCRIPT_KINDS } from "@/lib/manuscript-kind";

/**
 * The chat's quick-action chips on the phone send the same briefs as the web's
 * (src/lib/prompts.ts). The Expo app cannot import from the Next app, so
 * apps/mobile/lib/quick-actions.ts holds a copy of the chat chips (the web's
 * panel chips, like the continuity check, are left out until the phone has the
 * panel) and nothing but this test keeps the briefs the same.
 *
 * If this fails, copy the changed brief into apps/mobile/lib/quick-actions.ts
 * (and add a `quickActions.<id>` label to all four locales for a new chip).
 */
describe("quick actions parity between the server and the phone", () => {
  for (const kind of MANUSCRIPT_KINDS) {
    it(`sends the same briefs for a ${kind}`, () => {
      const server = serverActionsFor(kind)
        .filter((action) => action.kind !== "panel")
        .map((action) => ({
          id: action.id,
          scope: action.scope,
          writes: action.writes ?? false,
          prompt: action.prompt,
        }));
      const phone = phoneActionsFor(kind).map((action) => ({
        id: action.id,
        scope: action.scope,
        writes: action.writes ?? false,
        prompt: action.prompt,
      }));
      expect(phone).toEqual(server);
    });
  }
});
