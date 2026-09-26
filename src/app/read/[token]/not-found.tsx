import BrandMark from "@/components/BrandMark";

export default function ReaderLinkUnavailable() {
  return (
    <main className="reader-unavailable">
      <BrandMark />
      <h1>This link is not available</h1>
      <p>It may have expired, or the author may have turned it off. Ask them for a new one.</p>
    </main>
  );
}
