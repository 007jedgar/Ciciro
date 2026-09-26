"use client";

import Workspace from "@/components/Workspace";
import { usePhoneWidth } from "@/lib/phone-width";
import type { Project } from "@/lib/types";

// Phones get .open-in-app instead, so the workspace never mounts there and its
// fetches, polling and key listeners never start.
export default function WorkspaceGate({ initialProject }: { initialProject: Project }) {
  const phone = usePhoneWidth();
  if (phone !== false) return null;
  return <Workspace initialProject={initialProject} />;
}
