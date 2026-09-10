import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../components/AppHeader";
import { NewFolderForm } from "../components/NewFolderForm";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";

export default function NewFolderScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
        title={t("newFolder.title")}
        onBack={() => (router.canGoBack() ? router.back() : router.navigate("/manuscripts"))}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}>
        <NewFolderForm onCreated={(folder) => router.replace(`/folder/${folder.id}`)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
