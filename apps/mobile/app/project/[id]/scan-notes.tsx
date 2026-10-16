import { Redirect, useLocalSearchParams } from "expo-router";
import { ScanNotes } from "../../../components/ScanNotes";
import { ScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { useSession } from "../../../lib/session";

export default function ScanNotesScreen() {
  const { id, to } = useLocalSearchParams<{ id: string; to?: string }>();
  const { user, ready } = useSession();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    <ScreenErrorBoundary>
      <ScanNotes projectId={projectId} to={to === "canvas" || to === "bible" ? to : undefined} />
    </ScreenErrorBoundary>
  );
}
