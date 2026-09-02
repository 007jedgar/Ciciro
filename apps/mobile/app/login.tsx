import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { colors, layout } from "../lib/theme";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/manuscripts");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={layout.padded}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={layout.title}>Sign in to Ciciro</Text>
      <TextInput
        style={layout.input}
        aria-label="Email"
        placeholder="Email"
        placeholderTextColor={colors.inkSoft}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={layout.input}
        aria-label="Password"
        placeholder="Password"
        placeholderTextColor={colors.inkSoft}
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      {error ? (
        <Text style={layout.error} role="alert">
          {error}
        </Text>
      ) : null}
      <Pressable style={layout.primaryBtn} onPress={submit} disabled={busy}>
        <Text style={layout.primaryBtnText}>{busy ? "Working..." : "Sign in"}</Text>
      </Pressable>
      <View style={{ marginTop: 16 }}>
        <Text style={layout.body}>
          New here?{" "}
          <Link href="/signup" style={{ color: colors.accent }}>
            Create an account
          </Link>
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
