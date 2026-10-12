import { sharePreviewParts } from "@/lib/share-preview";
import { sharePreviewInfo } from "@/lib/shares";
import GenericOgImage, { size, contentType } from "@/lib/og/generic-image";
import { renderShareOgImage } from "@/lib/og/share-image";

export const runtime = "nodejs";
export { size, contentType };
export const alt = "A manuscript shared on Ciciro.";

// A revoked, expired or unknown token gets the same generic brand image
// every other public page uses - never a hint that a link ever existed.
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await sharePreviewInfo(token);
  if (!info) return GenericOgImage();
  return renderShareOgImage(sharePreviewParts(info));
}
