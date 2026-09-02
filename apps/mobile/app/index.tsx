import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_URL, api } from "../lib/api";
import { useSession } from "../lib/session";
import { colors, layout } from "../lib/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { user, ready } = useSession();
  const [health, setHealth] = useState<string | null>(null);

  useEffect(() => {
    api<{ status?: string; authRequired?: boolean }>("/api/health")
      .then((data) => {
        const auth = data.authRequired ? "auth on" : "auth off";
        setHealth(`API ${data.status ?? "ok"} (${auth})`);
      })
      .catch(() => setHealth("API unreachable - check EXPO_PUBLIC_API_URL"));
  }, []);

  if (!ready) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (user) return <Redirect href="/manuscripts" />;

  return (
    <SafeAreaView style={layout.padded}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={layout.title}>Ciciro</Text>
        <Text style={layout.body}>
          One editor. Sign in to the hosted app, then open a manuscript. The phone talks to
          your Ciciro origin - it never holds the Anthropic key.
        </Text>
        <Text style={[layout.cardMeta, { marginTop: 16 }]}>API: {API_URL}</Text>
        {health ? <Text style={layout.cardMeta}>{health}</Text> : null}

        <Pressable style={[layout.primaryBtn, { marginTop: 28 }]} onPress={() => router.push("/login")}>
          <Text style={layout.primaryBtnText}>Sign in</Text>
        </Pressable>
        <Pressable style={layout.ghostBtn} onPress={() => router.push("/signup")}>
          <Text style={layout.ghostBtnText}>Create an account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
