import Features from "@/components/features/Features";
import { FEATURES_METADATA } from "@/components/features/copy";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/structured-data";

export const metadata = FEATURES_METADATA;

export default function FeaturesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "Features", path: "/features" },
            ])
          ),
        }}
      />
      <Features />
    </>
  );
}
