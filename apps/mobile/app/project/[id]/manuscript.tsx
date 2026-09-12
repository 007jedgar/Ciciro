import { useMemo, useRef } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { htmlToPlainText } from "../../../lib/html";
import { htmlToDoc, resumePlainTextIndex } from "../../../lib/manuscript";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";
import { fonts } from "../../../lib/theme";

export default function ManuscriptScreen() {
  const { project, loading, error, selectedChapterId, readingPosition } = useProject();
  const { t } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const clearance = useTabBarClearance();
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];
  const scrollRef = useRef<ScrollView>(null);

  const resume = useMemo(() => {
    if (!chapter || !readingPosition || readingPosition.chapterId !== chapter.id) {
      return null;
    }
    const index = resumePlainTextIndex(
      chapter.content,
      readingPosition.blockId,
      readingPosition.offset
    );
    return {
      blockId: readingPosition.blockId,
      offset: readingPosition.offset,
      index,
    };
  }, [chapter, readingPosition]);

  const blocks = useMemo(() => {
    if (!chapter?.content) return [];
    return htmlToDoc(chapter.content, chapter.revision).doc.blocks;
  }, [chapter]);

  if (loading && !project) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={layout.padded}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }

  if (!chapter) {
    return (
      <View style={layout.padded}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
      </View>
    );
  }

  const body = htmlToPlainText(chapter.content);
  const editorStyle = {
    fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
    fontSize: settings.editorFontSize,
    lineHeight: Math.round(settings.editorFontSize * 1.55),
    color: colors.ink,
  } as const;

  return (
    <ScrollView
      ref={scrollRef}
      style={layout.screen}
      contentContainerStyle={{ padding: 20, paddingBottom: clearance }}
    >
      <Text style={layout.title}>{chapter.title}</Text>
      {resume ? (
        <Text
          testID="reading-caret"
          accessibilityLabel={`${resume.blockId}:${resume.offset}`}
          style={[layout.body, { marginBottom: 12 }]}
        >
          {`${resume.blockId}:${resume.offset}`}
        </Text>
      ) : null}
      {blocks.length > 0 ? (
        blocks.map((block) => (
          <Text
            key={block.id}
            nativeID={block.id}
            testID={resume?.blockId === block.id ? "reading-caret-block" : undefined}
            style={[editorStyle, { marginBottom: 12 }]}
          >
            {block.text || htmlToPlainText(block.html)}
          </Text>
        ))
      ) : body ? (
        <Text style={editorStyle}>{body}</Text>
      ) : (
        <Text style={layout.body}>{t("manuscript.emptyChapter")}</Text>
      )}
    </ScrollView>
  );
}
