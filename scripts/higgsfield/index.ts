/**
 * Generates one Seedance 2.5 text-to-video clip through the Higgsfield SDK and
 * prints its URL. Server-side only: credentials come from HF_CREDENTIALS
 * (key-id:key-secret), loaded from .env.local by `npm run higgsfield:example`.
 *
 * This makes a billable generation request.
 */
import { config, higgsfield, HiggsfieldError, TimeoutError } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

if (!process.env.HF_CREDENTIALS) {
  console.error("HF_CREDENTIALS is not set. Add it to .env.local as key-id:key-secret.");
  process.exit(1);
}

config({
  credentials: process.env.HF_CREDENTIALS,
  // Video takes longer than the SDK's 5-minute default.
  maxPollTime: 15 * 60 * 1000,
});

async function main(): Promise<number> {
  console.log(`Submitting ${MODEL}…`);
  let result;
  try {
    result = await higgsfield.subscribe(MODEL, {
      input: {
        prompt: "A cinematic scene at sunset",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
      withPolling: true,
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      // The SDK only stops polling on completed, failed or nsfw, so a request
      // canceled on Higgsfield's side surfaces here as a timeout.
      console.error("Generation did not finish in time (it may have been canceled).");
    } else if (error instanceof HiggsfieldError) {
      console.error(`Generation request failed: ${error.name}: ${error.message}`);
    } else {
      console.error("Generation request failed:", error instanceof Error ? error.message : error);
    }
    return 1;
  }

  const status: string = result.status;
  if (status === "completed" && result.video?.url) {
    console.log(`Completed (request ${result.request_id}).`);
    console.log(`Video URL: ${result.video.url}`);
    return 0;
  }

  const reason =
    status === "nsfw"
      ? "was blocked by content moderation"
      : status === "failed"
        ? "failed"
        : status === "canceled" || status === "cancelled"
          ? "was canceled"
          : status === "completed"
            ? "completed without a video URL"
            : `ended with unexpected status "${status}"`;
  console.error(`Generation ${reason} (request ${result.request_id}).`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("Unexpected error:", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
