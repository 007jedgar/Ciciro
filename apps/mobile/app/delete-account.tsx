import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import * as haptics from "../lib/haptics";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { ApiError } from "../lib/api";
import { storeLabelKey, useEntitlement } from "../lib/billing";
import { openStoreSubscriptions } from "../lib/purchases";
import { useExportAccountData } from "../lib/use-export-account-data";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { AlertText } from "../components/AlertText";

/** The word an account without a password types to confirm (the server checks it). */
const DELETE_WORD = "DELETE";

const DELETED_ITEMS = [
  "account.deletedManuscripts",
  "account.deletedBible",
  "account.deletedChat",
  "account.deletedSharing",
  "account.deletedStats",
] as const;

/**
 * The destructive confirmation for deleting the account: what goes, that it is
 * permanent, a way to export first, and proof before anything happens: the
 * password, or for an Apple / Google account without one, typing DELETE.
 */
export default function DeleteAccountScreen() {
  const { backOr, resetTo } = useStackBack();
  const { t } = useTranslation();
  const { user, ready, deleteAccount } = useSession();
  const { layout, colors } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const exporter = useExportAccountData();
  const { data: entitlement } = useEntitlement(Boolean(user));
  const [proof, setProof] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once the account is gone `user` clears; the submit handler navigates away.
  if (!ready) return null;
  if (!user && !busy) return <Redirect href="/login" />;

  // An older server omits hasPassword; every account it knows has a password.
  const usesPassword = user?.hasPassword !== false;
  const proofReady = usesPassword
    ? proof.length > 0
    : proof.trim().toUpperCase() === DELETE_WORD;

  async function submit() {
    if (!proofReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(usesPassword ? { password: proof } : { confirmation: proof });
      haptics.success();
      // Same reset resetTo gives sign-out: dismiss every nested ancestor
      // instead of leaving them mounted as modal-presented screens.
      resetTo("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("account.deleteFailed"));
      setBusy(false);
      haptics.error();
    }
  }

  const canDelete = proofReady && !busy;
  const proofLabel = usesPassword
    ? t("account.passwordLabel")
    : t("account.confirmLabel", { word: DELETE_WORD });
  const subscribed = entitlement && entitlement.plan !== "free" ? entitlement : null;
  const storeKey = subscribed ? storeLabelKey(subscribed.source) : null;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("account.deleteAccount")}
        onBack={() => backOr("/settings")}
        floating
      />
      <KeyboardAwareScrollView
        // Room for the Delete button under the field, so it stays tappable over the keyboard.
        bottomOffset={96}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingTop: headerHeight + 8, paddingBottom: 48 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <Text style={[layout.body, { fontSize: 17, color: colors.ink, marginBottom: 12 }]}>
          {t("account.deleteIntro", { email: user?.email ?? "" })}
        </Text>
        <View style={{ marginBottom: 14, gap: 6 }}>
          {DELETED_ITEMS.map((key) => (
            <View key={key} style={{ flexDirection: "row", gap: 10, paddingRight: 8 }}>
              <Text style={[layout.body, { lineHeight: 22 }]}>•</Text>
              <Text style={[layout.body, { flex: 1, fontSize: 15, lineHeight: 22 }]}>{t(key)}</Text>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.danger, marginBottom: 20 }}>
          {t("account.deleteWarning")}
        </Text>

        {subscribed && storeKey ? (
          // A store subscription outlives the account: only Apple or Google can stop it.
          <View
            style={{
              backgroundColor: colors.panel,
              borderColor: colors.danger,
              borderWidth: 1,
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 17, color: colors.ink }}>{t("billing.deleteStoreTitle")}</Text>
            <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
              {t("billing.deleteStoreBody", { store: t(storeKey) })}
            </Text>
            <Pressable
              onPress={() => void openStoreSubscriptions(subscribed.manageUrl)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                marginTop: 12,
                alignSelf: "flex-start",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.line,
                paddingHorizontal: 14,
                paddingVertical: 9,
                backgroundColor: pressed ? colors.panel2 : colors.bg,
              })}
            >
              <Text style={{ fontSize: 15, color: colors.ink }}>{t("billing.manage")}</Text>
            </Pressable>
          </View>
        ) : subscribed ? (
          <Text style={[layout.body, { fontSize: 15, lineHeight: 22, marginBottom: 20 }]}>
            {t("billing.deleteWebBody")}
          </Text>
        ) : null}

        <View
          style={{
            backgroundColor: colors.panel,
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: 16,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <Text style={{ fontSize: 17, color: colors.ink }}>{t("account.exportFirst")}</Text>
          <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
            {t("account.exportFirstHint")}
          </Text>
          <Pressable
            onPress={exporter.run}
            disabled={exporter.busy || busy}
            accessibilityRole="button"
            accessibilityState={{ busy: exporter.busy, disabled: exporter.busy || busy }}
            style={({ pressed }) => ({
              marginTop: 12,
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.line,
              paddingHorizontal: 14,
              paddingVertical: 9,
              backgroundColor: pressed ? colors.panel2 : colors.bg,
            })}
          >
            {exporter.busy ? <ActivityIndicator size="small" color={colors.inkSoft} /> : null}
            <Text style={{ fontSize: 15, color: colors.ink }}>
              {exporter.busy ? t("account.exporting") : t("account.exportData")}
            </Text>
          </Pressable>
        </View>

        <Text style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 8 }}>
          {proofLabel}
        </Text>
        <TextInput
          style={[layout.input, { borderRadius: 12 }]}
          aria-label={proofLabel}
          secureTextEntry={usesPassword}
          autoComplete={usesPassword ? "current-password" : "off"}
          textContentType={usesPassword ? "password" : "none"}
          autoCapitalize={usesPassword ? "none" : "characters"}
          autoCorrect={false}
          spellCheck={false}
          editable={!busy}
          value={proof}
          onChangeText={(next) => {
            setProof(next);
            if (error) setError(null);
          }}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        {error ? (
          <AlertText style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
            {error}
          </AlertText>
        ) : null}

        <Pressable
          onPress={() => void submit()}
          disabled={!canDelete}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDelete, busy }}
          style={({ pressed }) => ({
            marginTop: 4,
            minHeight: 52,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
            backgroundColor: colors.danger,
            opacity: canDelete ? (pressed ? 0.85 : 1) : 0.45,
          })}
        >
          {busy ? <ActivityIndicator size="small" color={colors.panel} /> : null}
          <Text style={{ fontSize: 17, fontWeight: "600", color: colors.panel }}>
            {busy ? t("account.deleting") : t("account.deleteButton")}
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
