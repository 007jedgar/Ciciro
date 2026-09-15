import { Redirect, useLocalSearchParams } from "expo-router";

export default function ProjectIndex() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id || Array.isArray(id)) return <Redirect href="/manuscripts" />;
  return <Redirect href={`/project/${id}/chapters`} />;
}
