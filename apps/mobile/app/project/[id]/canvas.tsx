import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../../../components/AppHeader";
import { alpha } from "../../../components/Glass";
import { GlassSheet } from "../../../components/GlassSheet";
import { FitScreenIcon } from "../../../components/icons";
import { ScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { ScreenErrorState } from "../../../components/ScreenErrorState";
import { SkeletonList } from "../../../components/Skeleton";
import { TapPressable } from "../../../components/TapPressable";
import { ApiError, useCanvasBoardQuery } from "../../../lib/api";
import {
  CANVAS_CARD_WIDTH,
  canvasBounds,
  canvasLabelFixedHex,
  cardHeight,
  cardPort,
  clampCanvasScale,
  curveBetween,
  fitCanvasView,
  type CanvasBounds,
  type CanvasCard,
  type CanvasLabel,
  type CanvasLabelColor,
} from "../../../lib/canvas";
import { scanNotesHref } from "../../../lib/notes-scan";
import { useReduceMotion } from "../../../lib/use-reduce-motion";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { fonts, type ColorTokens } from "../../../lib/theme";
import { useStackBack } from "../../../lib/use-stack-back";

type AppColors = ColorTokens;

const SETTLE_MS = 220;

/**
 * A card's background: the fixed swatches match the web's .canvas-chip[data-color]
 * rules; "ink" and "accent" use the current theme instead of a hardcoded hex.
 */
function canvasLabelBackground(color: CanvasLabelColor, colors: AppColors): string {
  const fixed = canvasLabelFixedHex(color);
  if (fixed) return alpha(fixed, 0.32);
  if (color === "ink") return alpha(colors.ink, 0.14);
  return colors.accentSoft;
}

function CanvasChip({ label, colors }: { label: CanvasLabel; colors: AppColors }) {
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: canvasLabelBackground(label.color, colors), borderColor: colors.line },
      ]}
    >
      <Text style={[styles.chipText, { color: colors.ink }]} numberOfLines={1}>
        {label.name}
      </Text>
    </View>
  );
}

function CanvasCardTile({
  card,
  labels,
  colors,
  onMeasured,
  onOpen,
}: {
  card: CanvasCard;
  labels: CanvasLabel[];
  colors: AppColors;
  onMeasured: (height: number) => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const own = useMemo(() => labels.filter((label) => card.labelIds.includes(label.id)), [labels, card.labelIds]);

  return (
    <View
      style={[styles.card, { left: card.x, top: card.y, backgroundColor: colors.panel, borderColor: colors.line }]}
      onLayout={(event: LayoutChangeEvent) => onMeasured(event.nativeEvent.layout.height)}
    >
      <TapPressable
        feedback="dim"
        accessibilityRole="button"
        accessibilityLabel={t("canvas.openCardA11y", { title: card.title || t("canvas.untitled") })}
        onPress={onOpen}
      >
        <Text style={[styles.cardTitle, { color: colors.ink, fontFamily: fonts.uiMedium }]} numberOfLines={2}>
          {card.title || t("canvas.untitled")}
        </Text>
        {own.length ? (
          <View style={styles.chipRow}>
            {own.map((label) => (
              <CanvasChip key={label.id} label={label} colors={colors} />
            ))}
          </View>
        ) : null}
        {card.body ? (
          <Text style={[styles.cardBody, { color: colors.inkSoft, fontFamily: fonts.ui }]} numberOfLines={5}>
            {card.body}
          </Text>
        ) : null}
      </TapPressable>
    </View>
  );
}

function CanvasBoardView({
  cards,
  labels,
  edges,
  colors,
  onOpenCard,
}: {
  cards: CanvasCard[];
  labels: CanvasLabel[];
  edges: { id: string; fromId: string; toId: string }[];
  colors: AppColors;
  onOpenCard: (card: CanvasCard) => void;
}) {
  const reduceMotion = useReduceMotion();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const fitted = useRef(false);

  const translateX = useSharedValue(48);
  const translateY = useSharedValue(48);
  const scale = useSharedValue(1);
  const panStart = useSharedValue({ x: 0, y: 0 });
  const pinchStart = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });

  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  const applyFit = useCallback(
    (bounds: CanvasBounds, animate: boolean) => {
      if (viewport.width <= 0 || viewport.height <= 0) return;
      const next = fitCanvasView(bounds, viewport.width, viewport.height);
      const duration = reduceMotion ? 0 : SETTLE_MS;
      if (animate) {
        translateX.value = withTiming(next.x, { duration });
        translateY.value = withTiming(next.y, { duration });
        scale.value = withTiming(next.scale, { duration });
      } else {
        translateX.value = next.x;
        translateY.value = next.y;
        scale.value = next.scale;
      }
    },
    [viewport, reduceMotion, translateX, translateY, scale]
  );

  const setCardHeight = useCallback((id: string, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  const measuredCount = Object.keys(heights).length;
  // Fit once, the first time every card has reported its height and the stage has a size.
  useEffect(() => {
    if (fitted.current || cards.length === 0 || viewport.width <= 0 || measuredCount < cards.length) return;
    fitted.current = true;
    applyFit(canvasBounds(cards, heights), false);
  }, [cards, heights, viewport, measuredCount, applyFit]);

  const pan = Gesture.Pan()
    .minDistance(10)
    .onStart(() => {
      panStart.value = { x: translateX.value, y: translateY.value };
    })
    .onUpdate((event) => {
      translateX.value = panStart.value.x + event.translationX;
      translateY.value = panStart.value.y + event.translationY;
    });

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      pinchStart.value = {
        scale: scale.value,
        x: translateX.value,
        y: translateY.value,
        focalX: event.focalX,
        focalY: event.focalY,
      };
    })
    .onUpdate((event) => {
      const start = pinchStart.value;
      const next = clampCanvasScale(start.scale * event.scale);
      const ratio = next / start.scale;
      scale.value = next;
      translateX.value = start.focalX - (start.focalX - start.x) * ratio;
      translateY.value = start.focalY - (start.focalY - start.y) * ratio;
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  const bounds = canvasBounds(cards, heights);
  const svgWidth = Math.max(CANVAS_CARD_WIDTH, bounds.maxX) + 200;
  const svgHeight = Math.max(1, bounds.maxY) + 200;

  return (
    <View
      style={styles.stage}
      onLayout={(event: LayoutChangeEvent) =>
        setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
    >
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {/* The world is as big as its content and scales from its top-left corner, which is what
              `fitCanvasView` assumes. A zero-size world with a "left top" origin string was
              drawn well away from where the fit put it. */}
          <Animated.View
            style={[styles.world, worldStyle, { width: svgWidth, height: svgHeight, transformOrigin: [0, 0, 0] }]}
          >
            <Svg width={svgWidth} height={svgHeight} style={styles.edges} pointerEvents="none">
              {edges.map((edge) => {
                const from = byId.get(edge.fromId);
                const to = byId.get(edge.toId);
                if (!from || !to) return null;
                const fromPort = cardPort(from, cardHeight(heights, from.id), "right");
                const toPort = cardPort(to, cardHeight(heights, to.id), "left");
                return (
                  <Path key={edge.id} d={curveBetween(fromPort, toPort)} stroke={colors.line} strokeWidth={1.5} fill="none" />
                );
              })}
            </Svg>
            {cards.map((card) => (
              <CanvasCardTile
                key={card.id}
                card={card}
                labels={labels}
                colors={colors}
                onMeasured={(height) => setCardHeight(card.id, height)}
                onOpen={() => onOpenCard(card)}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <FitButton colors={colors} onPress={() => applyFit(canvasBounds(cards, heights), true)} />
    </View>
  );
}

function FitButton({ colors, onPress }: { colors: AppColors; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <TapPressable
      feedback="dim"
      accessibilityRole="button"
      accessibilityLabel={t("canvas.fit")}
      onPress={onPress}
      style={[styles.fitBtn, { backgroundColor: colors.panel, borderColor: colors.line }]}
    >
      <FitScreenIcon color={colors.accent} size={20} />
    </TapPressable>
  );
}

function CanvasCardSheet({
  card,
  labels,
  colors,
  onClose,
}: {
  card: CanvasCard | null;
  labels: CanvasLabel[];
  colors: AppColors;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const own = useMemo(
    () => (card ? labels.filter((label) => card.labelIds.includes(label.id)) : []),
    [labels, card]
  );
  return (
    <GlassSheet
      visible={Boolean(card)}
      onClose={onClose}
      title={card?.title || t("canvas.untitled")}
      snapPoints={["auto", 0.85]}
      testID="canvas-card-sheet"
    >
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
        {own.length ? (
          <View style={styles.chipRow}>
            {own.map((label) => (
              <CanvasChip key={label.id} label={label} colors={colors} />
            ))}
          </View>
        ) : null}
        <Text selectable style={[styles.sheetBody, { color: colors.ink }]}>
          {card?.body || t("canvas.noNotes")}
        </Text>
      </ScrollView>
    </GlassSheet>
  );
}

function CanvasScreenBody({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { backOr } = useStackBack();
  const { colors, layout } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const query = useCanvasBoardQuery(projectId, { enabled: Boolean(projectId) });
  const [selected, setSelected] = useState<CanvasCard | null>(null);

  const board = query.data;
  const cards = board?.cards ?? [];
  const labels = board?.labels ?? [];
  const edges = board?.edges ?? [];

  let body: ReactNode;
  if (query.isPending && !board) {
    body = (
      <View style={[layout.padded, { paddingTop: headerHeight + 8 }]}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  } else if (query.isError && !board) {
    body = (
      <View style={[layout.padded, { paddingTop: headerHeight + 16, flex: 1 }]}>
        <ScreenErrorState
          variant="full"
          message={t("canvas.loadError")}
          detail={query.error instanceof ApiError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </View>
    );
  } else if (cards.length === 0) {
    body = (
      <View style={[layout.padded, { paddingTop: headerHeight + 16 }]}>
        <Text style={layout.body}>{t("canvas.empty")}</Text>
        <TapPressable
          testID="canvas-scan-notes"
          style={[layout.primaryBtn, { marginTop: 20 }]}
          accessibilityRole="button"
          onPress={() => router.push(scanNotesHref(projectId, "canvas") as never)}
        >
          <Text style={layout.primaryBtnText}>{t("scanNotes.title")}</Text>
        </TapPressable>
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1, paddingTop: headerHeight }}>
        <CanvasBoardView cards={cards} labels={labels} edges={edges} colors={colors} onOpenCard={setSelected} />
      </View>
    );
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("canvas.title")}
        floating
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        onHeightChange={onHeaderHeight}
      />
      {body}
      <CanvasCardSheet card={selected} labels={labels} colors={colors} onClose={() => setSelected(null)} />
    </View>
  );
}

export default function CanvasScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    <ScreenErrorBoundary>
      <CanvasScreenBody projectId={projectId} />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: "hidden" },
  world: { position: "absolute", top: 0, left: 0 },
  edges: { position: "absolute", top: 0, left: 0 },
  card: {
    position: "absolute",
    width: CANVAS_CARD_WIDTH,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  cardTitle: { fontSize: 15, marginBottom: 6 },
  cardBody: { fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  chipText: { fontSize: 11 },
  fitBtn: {
    position: "absolute",
    right: 16,
    bottom: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetContent: { paddingBottom: 24 },
  sheetBody: { fontSize: 15, lineHeight: 22, marginTop: 4 },
});
