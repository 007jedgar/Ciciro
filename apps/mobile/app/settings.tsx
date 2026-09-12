import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../components/AppHeader";
import { LanguagePicker } from "../components/LanguagePicker";
import { EDITOR_FONT_SIZES } from "../lib/app-settings";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { THEME_META, THEME_PALETTES } from "../lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, ready, logout } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const sizeIndex = EDITOR_FONT_SIZES.indexOf(settings.editorFontSize);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("settings.title")}
        onBack={() => (router.canGoBack() ? router.back() : router.navigate("/manuscripts"))}
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <Text style={[layout.body, { marginBottom: 16 }]}>{t("settings.intro")}</Text>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("settings.language")}</Text>
      <View style={{ marginBottom: 20 }}>
        <LanguagePicker />
      </View>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("settings.theme")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {THEME_META.map((theme) => {
          const swatch = THEME_PALETTES[theme.id];
          const active = settings.theme === theme.id;
          return (
            <Pressable
              key={theme.id}
              onPress={() => patch({ theme: theme.id })}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                layout.card,
                {
                  width: "47%",
                  marginBottom: 0,
                  borderColor: active ? colors.accent : colors.line,
                  backgroundColor: active ? colors.accentSoft : colors.panel,
                },
              ]}
            >
              <View
                style={{
                  height: 18,
                  borderRadius: 4,
                  marginBottom: 8,
                  backgroundColor: swatch.bg,
                  borderWidth: 1,
                  borderColor: swatch.line,
                }}
              />
              <Text style={layout.cardTitle}>{t(`themes.${theme.id}`)}</Text>
              <Text style={layout.cardMeta}>{t(`themes.${theme.mode}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("settings.manuscript")}</Text>
      <View style={layout.card}>
        <Text style={layout.cardTitle}>{t("settings.type")}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {(["serif", "sans"] as const).map((font) => (
            <Pressable
              key={font}
              onPress={() => patch({ editorFont: font })}
              style={[
                layout.primaryBtn,
                {
                  flex: 1,
                  marginTop: 0,
                  backgroundColor:
                    settings.editorFont === font ? colors.accent : colors.panel2,
                },
              ]}
            >
              <Text
                style={[
                  layout.primaryBtnText,
                  { color: settings.editorFont === font ? colors.panel : colors.ink },
                ]}
              >
                {font === "serif" ? t("settings.serif") : t("settings.sans")}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[layout.cardTitle, { marginTop: 16 }]}>{t("settings.size")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
          <Pressable
            accessibilityLabel={t("settings.smallerType")}
            disabled={sizeIndex <= 0}
            onPress={() =>
              patch({ editorFontSize: EDITOR_FONT_SIZES[Math.max(0, sizeIndex - 1)] })
            }
            style={[layout.primaryBtn, { flex: 1, marginTop: 0, backgroundColor: colors.panel2 }]}
          >
            <Text style={[layout.primaryBtnText, { color: colors.ink }]}>A-</Text>
          </Pressable>
          <Text style={layout.body}>{t("settings.sizeValue", { size: settings.editorFontSize })}</Text>
          <Pressable
            accessibilityLabel={t("settings.largerType")}
            disabled={sizeIndex >= EDITOR_FONT_SIZES.length - 1}
            onPress={() =>
              patch({
                editorFontSize:
                  EDITOR_FONT_SIZES[Math.min(EDITOR_FONT_SIZES.length - 1, sizeIndex + 1)],
              })
            }
            style={[layout.primaryBtn, { flex: 1, marginTop: 0, backgroundColor: colors.panel2 }]}
          >
            <Text style={[layout.primaryBtnText, { color: colors.ink }]}>A+</Text>
          </Pressable>
        </View>
      </View>

      <View style={layout.card}>
        <Text style={layout.cardTitle}>{t("settings.autocorrect")}</Text>
        <Text style={layout.cardMeta}>{t("settings.autocorrectHint")}</Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.autoCorrect }}
          onPress={() => patch({ autoCorrect: !settings.autoCorrect })}
          style={[
            layout.primaryBtn,
            {
              marginTop: 12,
              backgroundColor: settings.autoCorrect ? colors.accent : colors.panel2,
            },
          ]}
        >
          <Text
            style={[
              layout.primaryBtnText,
              { color: settings.autoCorrect ? colors.panel : colors.ink },
            ]}
          >
            {settings.autoCorrect ? t("common.on") : t("common.off")}
          </Text>
        </Pressable>
      </View>

      <View style={layout.card}>
        <Text style={layout.cardTitle}>{t("settings.reduceMotion")}</Text>
        <Text style={layout.cardMeta}>{t("settings.reduceMotionHint")}</Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.reduceMotion }}
          onPress={() => patch({ reduceMotion: !settings.reduceMotion })}
          style={[
            layout.primaryBtn,
            {
              marginTop: 12,
              backgroundColor: settings.reduceMotion ? colors.accent : colors.panel2,
            },
          ]}
        >
          <Text
            style={[
              layout.primaryBtnText,
              { color: settings.reduceMotion ? colors.panel : colors.ink },
            ]}
          >
            {settings.reduceMotion ? t("common.on") : t("common.off")}
          </Text>
        </Pressable>
      </View>

      <View style={layout.card}>
        <Text style={layout.cardTitle}>{t("settings.dailyGoal")}</Text>
        <Text style={layout.cardMeta}>{t("settings.dailyGoalHint")}</Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.showDailyGoal }}
          onPress={() => patch({ showDailyGoal: !settings.showDailyGoal })}
          style={[
            layout.primaryBtn,
            {
              marginTop: 12,
              backgroundColor: settings.showDailyGoal ? colors.accent : colors.panel2,
            },
          ]}
        >
          <Text
            style={[
              layout.primaryBtnText,
              { color: settings.showDailyGoal ? colors.panel : colors.ink },
            ]}
          >
            {settings.showDailyGoal ? t("common.on") : t("common.off")}
          </Text>
        </Pressable>
        {settings.showDailyGoal ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {([100, 250, 500] as const).map((goal) => (
              <Pressable
                key={goal}
                onPress={() => patch({ dailyWordGoal: goal })}
                accessibilityState={{ selected: settings.dailyWordGoal === goal }}
                style={[
                  layout.primaryBtn,
                  {
                    flex: 1,
                    marginTop: 0,
                    backgroundColor:
                      settings.dailyWordGoal === goal ? colors.accent : colors.panel2,
                  },
                ]}
              >
                <Text
                  style={[
                    layout.primaryBtnText,
                    { color: settings.dailyWordGoal === goal ? colors.panel : colors.ink },
                  ]}
                >
                  {goal}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("settings.account")}</Text>
      <View style={layout.card}>
        <Text style={layout.cardTitle}>{user.email}</Text>
        <Text style={layout.cardMeta}>{t("settings.signedIn")}</Text>
        <Pressable
          onPress={() => void logout().then(() => router.replace("/"))}
          accessibilityRole="button"
          style={({ pressed }) => [layout.ghostBtn, { marginTop: 8, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[layout.ghostBtnText, { color: colors.danger }]}>{t("settings.signOut")}</Text>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}
