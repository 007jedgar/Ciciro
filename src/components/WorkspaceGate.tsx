"use client";

import { useState } from "react";
import Workspace from "@/components/Workspace";
import { usePhoneWidth } from "@/lib/phone-width";
import type { Project } from "@/lib/types";

// Phones get .open-in-app instead, so the workspace never mounts there and its
// fetches, polling and key listeners never start. Once mounted it stays mounted,
// so narrowing a desktop window only hides it (see globals.css) and never
// throws away unsaved editor state.
export default function WorkspaceGate({ initialProject }: { initialProject: Project }) {
  const phone = usePhoneWidth();
  const [mounted, setMounted] = useState(false);
  if (phone === false && !mounted) setMounted(true);
  if (!mounted && phone !== false) return null;
  return <Workspace initialProject={initialProject} />;
}
