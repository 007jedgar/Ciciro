import { useEffect, useRef } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { closeOpenDrafts, parseChatSegments } from "../lib/chat-segments";
import { insertionKey } from "../lib/chat-insert";
import type { ChatMessage, EditorRunStatus } from "../lib/api/types";
import type { ChatStreamState } from "../lib/ciciro-stream";
import { useAppTheme } from "../lib/settings";

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
  const { layout, colors } = useAppTheme();
  const listRef = useRef<FlatList<ChatMessage>>(null);

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
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: bottomInset,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("ciciroTab.clear")}
          onPress={() =>
            Alert.alert(t("ciciroTab.clear"), t("ciciroTab.clearConfirm"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("ciciroTab.clear"), style: "destructive", onPress: () => void onClear() },
            ])
          }
          style={{ alignSelf: "flex-start", marginBottom: 8 }}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{t("ciciroTab.clear")}</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <TextInput
            style={[layout.input, { flex: 1, marginBottom: 0, maxHeight: 120 }]}
            accessibilityLabel={t("ciciroTab.composer")}
            placeholder={t("ciciroTab.composer")}
            placeholderTextColor={colors.inkSoft}
            value={composer}
            onChangeText={onComposerChange}
            multiline
            editable={!streaming}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ciciroTab.send")}
            disabled={streaming || !composer.trim()}
            onPress={onSend}
            style={[
              layout.primaryBtn,
              { marginTop: 0, paddingHorizontal: 16, opacity: streaming || !composer.trim() ? 0.45 : 1 },
            ]}
          >
            <Text style={layout.primaryBtnText}>{t("ciciroTab.send")}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
