import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { AppHeader } from "../components/AppHeader";
import { EDITOR_FONT_SIZES } from "../lib/app-settings";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { THEME_META, THEME_PALETTES } from "../lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const { user, ready, logout } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const sizeIndex = EDITOR_FONT_SIZES.indexOf(settings.editorFontSize);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={layout.screen}>
      <AppHeader
        title="Settings"
        onBack={() => (router.canGoBack() ? router.back() : router.navigate("/manuscripts"))}
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <Text style={[layout.body, { marginBottom: 16 }]}>
          These follow you between the phone and the web app.
        </Text>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>THEME</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {THEME_META.map((t) => {
          const swatch = THEME_PALETTES[t.id];
          const active = settings.theme === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => patch({ theme: t.id })}
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
              <Text style={layout.cardTitle}>{t.label}</Text>
              <Text style={layout.cardMeta}>{t.mode}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>MANUSCRIPT</Text>
      <View style={layout.card}>
        <Text style={layout.cardTitle}>Type</Text>
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
                {font === "serif" ? "Serif" : "Sans"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[layout.cardTitle, { marginTop: 16 }]}>Size</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
          <Pressable
            accessibilityLabel="Smaller type"
            disabled={sizeIndex <= 0}
            onPress={() =>
              patch({ editorFontSize: EDITOR_FONT_SIZES[Math.max(0, sizeIndex - 1)] })
            }
            style={[layout.primaryBtn, { flex: 1, marginTop: 0, backgroundColor: colors.panel2 }]}
          >
            <Text style={[layout.primaryBtnText, { color: colors.ink }]}>A-</Text>
          </Pressable>
          <Text style={layout.body}>{settings.editorFontSize} px</Text>
          <Pressable
            accessibilityLabel="Larger type"
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
        <Text style={layout.cardTitle}>Autocorrect</Text>
        <Text style={layout.cardMeta}>Spelling suggestions while you type.</Text>
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
            {settings.autoCorrect ? "On" : "Off"}
          </Text>
        </Pressable>
      </View>

      <View style={layout.card}>
        <Text style={layout.cardTitle}>Reduce motion</Text>
        <Text style={layout.cardMeta}>Turn off animations across the app.</Text>
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
            {settings.reduceMotion ? "On" : "Off"}
          </Text>
        </Pressable>
      </View>

      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>ACCOUNT</Text>
      <View style={layout.card}>
        <Text style={layout.cardTitle}>{user.email}</Text>
        <Text style={layout.cardMeta}>Signed in to Ciciro</Text>
        <Pressable
          onPress={() => void logout().then(() => router.replace("/"))}
          accessibilityRole="button"
          style={({ pressed }) => [layout.ghostBtn, { marginTop: 8, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[layout.ghostBtnText, { color: colors.danger }]}>Sign out</Text>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}
