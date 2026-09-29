import { permanentRedirect } from "next/navigation";

// The landing page moved to `/`; keep old /launch links and shares working.
export default function LaunchPage() {
  permanentRedirect("/");
}
