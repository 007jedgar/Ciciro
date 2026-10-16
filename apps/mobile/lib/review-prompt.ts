import { AppState } from "react-native";
import { getAnalytics } from "./analytics-client";

/** What finished and made this a good moment to ask. */
export type ReviewTrigger = "export" | "exercise";

/** The device has been asked once; the OS rate-limits its own prompt, so we never try again. */
const ASKED_KEY = "review-prompt-asked";

/** How long the success moment (a share sheet closing, a finish screen settling in) gets before the prompt. */
export const REVIEW_SETTLE_MS = 2_000;

let askedInMemory = false;

function readAsked(): boolean {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    return getPrefs().getString(ASKED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeAsked() {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(ASKED_KEY, "true");
  } catch {
    /* web / tests / missing native module */
  }
}

export function hasAskedForReview(): boolean {
  return askedInMemory || readAsked();
}

/**
 * Ask the OS for its native review prompt (SKStoreReviewController on iOS, Play
 * In-App Review on Android), at most once per device across every trigger.
 * Resolves true when it asked. A no-op where the platform has no prompt, and
 * that does not use up the one ask. The ask is recorded before the request is
 * made, so a crash or a second trigger racing it cannot ask twice.
 */
export async function requestReviewOnce(trigger: ReviewTrigger): Promise<boolean> {
  if (hasAskedForReview()) return false;
  try {
    const StoreReview = require("expo-store-review") as typeof import("expo-store-review");
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return false;
    if (hasAskedForReview()) return false;
    askedInMemory = true;
    writeAsked();
    getAnalytics().track("review_prompt_requested", { trigger });
    await StoreReview.requestReview();
    return true;
  } catch {
    // A missing native module or a refused request is not worth surfacing; the ask stays spent.
    return false;
  }
}

/**
 * Ask after the success moment has settled: `delayMs` after now, and only while
 * the app is in the foreground, so it never lands over a share sheet or a save
 * dialog that has the app in the background. Returns a cancel function for a
 * caller that goes away first.
 */
export function scheduleReviewPrompt(trigger: ReviewTrigger, delayMs: number = REVIEW_SETTLE_MS): () => void {
  if (hasAskedForReview()) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let subscription: { remove: () => void } | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    subscription?.remove();
    timer = null;
    subscription = null;
  };
  const fire = () => {
    cleanup();
    void requestReviewOnce(trigger);
  };
  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      if (AppState.currentState === "active") fire();
      else {
        // Still behind a system sheet: wait for the app to come back, then give that moment its own beat.
        subscription = AppState.addEventListener("change", (state) => {
          if (state !== "active") return;
          subscription?.remove();
          subscription = null;
          arm();
        });
      }
    }, delayMs);
  };
  arm();
  return cleanup;
}
