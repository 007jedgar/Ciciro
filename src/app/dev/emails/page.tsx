import { notFound } from "next/navigation";
import { emailPreviews } from "@/lib/email/templates";
import EmailGallery from "./EmailGallery";
import "./emails.css";

export const metadata = { title: "Email previews - Ciciro" };
export const dynamic = "force-dynamic";

// Every email template with sample data, in light and dark mode and as plain
// text. Local development only (`npm run dev`, then /dev/emails).
export default function EmailPreviewsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const templates = emailPreviews("").map(({ id, title, group, content }) => ({
    id,
    title,
    group,
    subject: content.subject,
    preview: content.preview,
  }));
  return <EmailGallery templates={templates} />;
}
