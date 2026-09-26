import Link from "next/link";
import BrandMark from "@/components/BrandMark";

// The writing workspace is a desktop layout. Below 700px wide (see
// .open-in-app in globals.css) it is hidden and this screen sends the writer to
// the native app instead.
export default function OpenInApp({ title }: { title: string }) {
  return (
    <main className="open-in-app" aria-labelledby="open-in-app-title">
      <BrandMark />
      <h1 id="open-in-app-title">Open {title} in the app</h1>
      <p>
        The writing workspace needs a wider screen. Ciciro for iPhone has the editor, your
        chapters and Ciciro, made for the small screen.
      </p>
      <a className="btn primary" href="ciciro://">
        Open in the app
      </a>
      <Link href="/" className="btn ghost">
        Back to manuscripts
      </Link>
    </main>
  );
}
