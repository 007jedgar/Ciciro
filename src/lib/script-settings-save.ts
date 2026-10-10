import { serializeScriptSettings, type ScriptSettings } from "@/lib/screenplay";

export const SCRIPT_SETTINGS_SAVE_MS = 700;

export type ScriptSettingsSaver = {
  /** Write `next` back a moment after the last change. */
  schedule(next: ScriptSettings): void;
  /**
   * Send a waiting change now (before an export reads the stored row). Resolves true once the server has it.
   * `keepalive` (the page is going away) sends at once rather than after a save already on its way.
   */
  flush(options?: { keepalive?: boolean }): Promise<boolean>;
};

/**
 * The web's write-back of a script's own settings. A save the server refuses
 * hands back the last stored string so the editor shows what the exports and
 * other devices will read, unless a newer change is already waiting to go.
 */
export function createScriptSettingsSaver({
  projectId,
  stored,
  onFailed,
  delay = SCRIPT_SETTINGS_SAVE_MS,
}: {
  projectId: string;
  /** The settings string the server holds now. */
  stored: string;
  onFailed: (stored: string) => void;
  delay?: number;
}): ScriptSettingsSaver {
  let confirmed = stored;
  let pending: ScriptSettings | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> = Promise.resolve(true);

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function send(next: ScriptSettings, keepalive: boolean): Promise<boolean> {
    let ok = false;
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptSettings: next }),
        keepalive,
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) confirmed = serializeScriptSettings(next);
    else if (!pending) onFailed(confirmed);
    return ok;
  }

  function flush(options: { keepalive?: boolean } = {}): Promise<boolean> {
    clearTimer();
    if (!pending) return inFlight;
    const next = pending;
    pending = null;
    inFlight = options.keepalive ? send(next, true) : inFlight.then(() => send(next, false));
    return inFlight;
  }

  return {
    schedule(next) {
      pending = next;
      clearTimer();
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
  };
}
