/**
 * What the writer can do to the natural voice on the device: download it,
 * pause, cancel, remove it. These live outside any screen so a download keeps
 * going, and its outcome is still recorded, if the writer leaves Listening
 * settings while it runs.
 */
import { canResume, type ModelError } from "./natural-model";
import { getNaturalInstaller } from "./natural-model-store";
import { clearNaturalAudioCache, disposeNaturalEngine, naturalNativeAvailable } from "./natural-engine";
import { getReadAloudPrefs, setReadAloudPrefs } from "./read-aloud";
import { getAnalytics } from "./analytics-client";

/** True when the phone is on mobile data, or on any connection the OS calls metered. */
export async function onMeteredConnection(): Promise<boolean> {
  try {
    const NetInfo = (require("@react-native-community/netinfo") as typeof import("@react-native-community/netinfo")).default;
    const state = await NetInfo.fetch();
    return state.type === "cellular" || (state.details as { isConnectionExpensive?: boolean } | null)?.isConnectionExpensive === true;
  } catch {
    return false;
  }
}

export type DownloadStart = "started" | "needs-confirmation" | "unavailable";

/**
 * Starts (or picks up) the download. On mobile data it asks first: the caller
 * shows the question and calls again with `allowMetered`.
 */
export async function downloadNaturalVoice(options: { allowMetered: boolean }): Promise<DownloadStart> {
  const installer = getNaturalInstaller();
  if (!installer || !naturalNativeAvailable()) return "unavailable";
  const metered = await onMeteredConnection();
  if (metered && !options.allowMetered) return "needs-confirmation";

  const resumed = canResume(installer.current);
  const started = Date.now();
  getAnalytics().track("natural_voice_download_started", { resumed, cellular: metered });
  void installer.start().then(() => {
    const state = installer.current;
    if (state.status === "ready") {
      getAnalytics().track("natural_voice_download_completed", {
        seconds: Math.round((Date.now() - started) / 1000),
        resumed,
      });
    } else if (state.status === "error") {
      getAnalytics().track("natural_voice_download_failed", { reason: state.error.reason });
    }
  });
  return "started";
}

export function pauseNaturalDownload() {
  getNaturalInstaller()?.pause();
}

export async function cancelNaturalDownload() {
  const installer = getNaturalInstaller();
  if (!installer) return;
  await installer.cancel();
  getAnalytics().track("natural_voice_download_canceled", {});
}

/** Removes the model and the audio made with it, and frees the memory it held. */
export async function deleteNaturalVoice() {
  const installer = getNaturalInstaller();
  if (!installer) return;
  await disposeNaturalEngine();
  await installer.delete();
  await clearNaturalAudioCache();
  // A natural choice made earlier goes with the voice: the next download starts from the default again.
  if (getReadAloudPrefs().engine === "natural") setReadAloudPrefs({ engine: null });
  getAnalytics().track("natural_voice_deleted", {});
}

export type { ModelError };
