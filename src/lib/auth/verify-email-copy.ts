export type VerifyOutcome = "verified" | "already_verified" | "expired" | "invalid";

export const VERIFY_COPY: Record<VerifyOutcome, { title: string; body: string }> = {
  verified: {
    title: "Your email is confirmed",
    body: "Thanks. We'll use this address for anything about your account, like resetting your password.",
  },
  already_verified: {
    title: "Already confirmed",
    body: "This address was confirmed earlier, so there's nothing more to do.",
  },
  expired: {
    title: "This link has expired",
    body: "Confirmation links work for 48 hours. Send yourself a new one and use that instead.",
  },
  invalid: {
    title: "This link won't work",
    body: "It may have been copied incompletely. Send yourself a new one.",
  },
};
