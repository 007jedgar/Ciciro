import { useEffect, useRef } from "react";
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { closeOpenDrafts, parseChatSegments } from "../lib/chat-segments";
import { insertionKey } from "../lib/chat-insert";
import type { ChatMessage, EditorRunStatus } from "../lib/api/types";
import type { ChatStreamState } from "../lib/ciciro-stream";
import { useAppTheme } from "../lib/settings";
import { Glass } from "./Glass";
import { ArrowUpIcon } from "./icons";

const SEND_SIZE = 32;

function MessageBody({
  content,
  turnId,
  live,
  inserted,
  onInsert,
  onShare,
}: {
  content: string;
  turnId?: string | null;
  live: boolean;
  inserted: Set<string>;
  onInsert: (text: string, index: number) => void;
  onShare: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const display = !live ? closeOpenDrafts(content) : content;
  return (
    <View>
      {parseChatSegments(display).map((seg, idx) => {
        if (seg.kind === "md") {
          if (!seg.text.trim()) return null;
          return (
            <Text key={idx} style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>
              {seg.text.trim()}
            </Text>
          );
        }
        const draft = seg.text.trim();
        const key = turnId ? insertionKey(turnId, idx) : `live:${idx}`;
        const already = inserted.has(key);
        const writing = seg.open && live;
        return (
          <View
            key={idx}
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.panel2,
            }}
          >
            <Text style={{ color: colors.draft, fontSize: 16, lineHeight: 24 }}>
              {draft || (writing ? "…" : "")}
            </Text>
            {writing ? (
              <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
                {t("ciciroTab.writing")}
              </Text>
            ) : (
              <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={already ? t("ciciroTab.inserted") : t("ciciroTab.insert")}
                  disabled={already || !draft}
                  onPress={() => onInsert(draft, idx)}
                >
                  <Text style={{ color: already ? colors.inkSoft : colors.accent, fontWeight: "600" }}>
                    {already ? t("ciciroTab.inserted") : t("ciciroTab.insert")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("ciciroTab.share")}
                  onPress={() => onShare(draft)}
                >
                  <Text style={{ color: colors.accent }}>{t("ciciroTab.share")}</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function ChatSendButton({
  onPress,
  label,
  accent,
  iconColor,
  reduceMotion,
}: {
  onPress: () => void;
  label: string;
  accent: string;
  iconColor: string;
  reduceMotion: boolean;
}) {
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      appear.setValue(1);
      return;
    }
    appear.setValue(0);
    Animated.spring(appear, {
      toValue: 1,
      damping: 15,
      stiffness: 240,
      mass: 0.6,
      useNativeDriver: false,
    }).start();
  }, [appear, reduceMotion]);

  function send() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  }

  return (
    <Animated.View
      style={{
        width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, SEND_SIZE] }),
        marginLeft: appear.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }),
        opacity: appear,
        transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
        overflow: "hidden",
        justifyContent: "flex-end",
        alignItems: "flex-end",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={send}
        style={({ pressed }) => [styles.send, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}
      >
        <ArrowUpIcon color={iconColor} size={16} />
      </Pressable>
    </Animated.View>
  );
}

export function CiciroChat({
  messages,
  stream,
  streaming,
  error,
  phase,
  composer,
  onComposerChange,
  onSend,
  onClear,
  onInsertDraft,
  insertedKeys,
  bottomInset,
}: {
  messages: ChatMessage[];
  stream: ChatStreamState;
  streaming: boolean;
  error: string | null;
  phase: EditorRunStatus | null;
  composer: string;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  onInsertDraft: (text: string, turnId: string | null, index: number) => void;
  insertedKeys: Set<string>;
  bottomInset: number;
}) {
  const { t } = useTranslation();
  const { layout, colors, dark, settings } = useAppTheme();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const canSend = Boolean(composer.trim()) && !streaming;

  useEffect(() => {
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [messages.length, stream.text]);

  return (
    <KeyboardAvoidingView
      style={layout.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
        ListEmptyComponent={
          streaming ? null : (
            <Text style={[layout.body, { marginTop: 8 }]}>{t("ciciroTab.empty")}</Text>
          )
        }
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              backgroundColor: item.role === "user" ? colors.accentSoft : colors.panel,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            {item.role === "user" ? (
              <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{item.content}</Text>
            ) : (
              <MessageBody
                content={item.content}
                turnId={item.turnId}
                live={false}
                inserted={insertedKeys}
                onInsert={(text, index) => onInsertDraft(text, item.turnId ?? null, index)}
                onShare={(text) => void Share.share({ message: text })}
              />
            )}
          </View>
        )}
        ListFooterComponent={
          streaming ? (
            <View
              style={{
                alignSelf: "flex-start",
                maxWidth: "92%",
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                backgroundColor: colors.panel,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              {phase ? (
                <Text style={{ color: colors.inkSoft, fontSize: 12, marginBottom: 6 }}>
                  {t(`ciciroTab.phase.${phase}`)}
                </Text>
              ) : null}
              {stream.tools.length > 0 ? (
                <Text style={{ color: colors.inkSoft, fontSize: 12, marginBottom: 8 }}>
                  {t("ciciroTab.tools", { name: stream.tools[stream.tools.length - 1] })}
                </Text>
              ) : null}
              <MessageBody
                content={stream.text || t("ciciroTab.sending")}
                turnId={stream.turnId}
                live
                inserted={insertedKeys}
                onInsert={(text, index) => onInsertDraft(text, stream.turnId, index)}
                onShare={(text) => void Share.share({ message: text })}
              />
            </View>
          ) : null
        }
      />
      {error ? (
        <Text style={[layout.error, { marginHorizontal: 20 }]} role="alert">
          {error}
        </Text>
      ) : null}
      <View style={[styles.dock, { paddingBottom: bottomInset, backgroundColor: colors.bg }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("ciciroTab.clear")}
          onPress={() =>
            Alert.alert(t("ciciroTab.clear"), t("ciciroTab.clearConfirm"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("ciciroTab.clear"), style: "destructive", onPress: () => void onClear() },
            ])
          }
          style={styles.clear}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{t("ciciroTab.clear")}</Text>
        </Pressable>
        <Glass dark={dark} colors={colors} radius={24} style={styles.bubble}>
          <View style={styles.composer}>
            <TextInput
              style={[styles.field, { color: colors.ink }]}
              accessibilityLabel={t("ciciroTab.composer")}
              placeholder={t("ciciroTab.composer")}
              placeholderTextColor={colors.inkSoft}
              value={composer}
              onChangeText={onComposerChange}
              multiline
              editable={!streaming}
            />
            {canSend ? (
              <ChatSendButton
                onPress={onSend}
                label={t("ciciroTab.send")}
                accent={colors.accent}
                iconColor={colors.panel}
                reduceMotion={settings.reduceMotion}
              />
            ) : null}
          </View>
        </Glass>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  clear: {
    alignSelf: "flex-start",
    marginBottom: 8,
    marginLeft: 4,
  },
  bubble: {
    minHeight: 52,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  field: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: Platform.OS === "ios" ? 8 : 6,
    paddingBottom: Platform.OS === "ios" ? 8 : 6,
    margin: 0,
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
