// The marketing-email topics, as plain data with no server-only imports, so a
// client component (the public preferences page, Settings) can import it
// directly. src/lib/email/preferences.ts re-exports these for server code.

export const EMAIL_TOPICS = ["productUpdates", "weeklyEmail", "offers"] as const;
export type EmailTopic = (typeof EMAIL_TOPICS)[number];

export const TOPIC_LABELS: Record<EmailTopic, { title: string; description: string }> = {
  productUpdates: {
    title: "Product updates",
    description: "New features and changes, roughly when there's something worth telling you.",
  },
  weeklyEmail: {
    title: "Weekly email",
    description: "What's new in Ciciro that week, skipped when there's nothing to say.",
  },
  offers: {
    title: "Offers",
    description: "Upgrade nudges and pricing offers, like early access while it's open.",
  },
};
