// One of five identical files (/, /features, /changelog, /privacy, /terms)
// that all re-export the same brand image - see src/lib/og/generic-image.tsx.
// Each page gets its own file rather than relying on Next's metadata
// inheritance, so giving one page its own image later is a one-line change,
// not an override to find.
export { alt, size, contentType, default } from "@/lib/og/generic-image";

export const runtime = "nodejs";
