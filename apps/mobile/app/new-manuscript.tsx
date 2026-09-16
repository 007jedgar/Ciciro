import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useStackBack } from "../lib/use-stack-back";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../components/AppHeader";
import { NewManuscriptForm } from "../components/NewManuscriptForm";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";

export default function NewManuscriptScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId?: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <KeyboardAvoidingView
      style={layout.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader
        title={t("newManuscript.title")}
        onBack={() => backOr("/manuscripts")}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}>
        <NewManuscriptForm
          defaultAuthor={user.name}
          folderId={typeof folderId === "string" ? folderId : undefined}
          onCreated={(project) => router.replace(`/project/${project.id}/chapters`)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
