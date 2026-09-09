import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { NewManuscriptForm } from "../components/NewManuscriptForm";
import { useSession } from "../lib/session";
import { layout } from "../lib/theme";

export default function NewManuscriptScreen() {
  const router = useRouter();
  const { user, ready } = useSession();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <KeyboardAvoidingView
      style={layout.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}>
        <NewManuscriptForm
          defaultAuthor={user.name}
          onCreated={(project) => router.replace(`/project/${project.id}/chapters`)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
