import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useStackBack } from "../lib/use-stack-back";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { NewFolderForm } from "../components/NewFolderForm";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";

export default function NewFolderScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const headerHeight = useAppHeaderHeight();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <KeyboardAvoidingView
      style={layout.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader
        title={t("newFolder.title")}
        onBack={() => backOr("/manuscripts")}
        floating
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 16, paddingBottom: 16 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <NewFolderForm onCreated={(folder) => router.replace(`/folder/${folder.id}`)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
