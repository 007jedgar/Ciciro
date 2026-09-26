import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GLASS_SHEET_BODY_PAD_BOTTOM,
  GLASS_SHEET_BODY_PAD_TOP,
  GLASS_SHEET_RADIUS,
  pickSnapOffset,
  resolveGlassSnapHeights,
  restOffset,
  sheetHeightForContent,
  type GlassSnapPoint,
} from "../lib/glass-sheet";
import { useOptionalAppTheme } from "../lib/settings";
import { GlassSheetBorder } from "./GlassSheetBorder";
import { CloseIcon } from "./icons";
import { alpha } from "./Glass";

export {
  GLASS_SHEET_RADIUS,
  glassSheetFillColors,
  glassSheetRimColors,
  pickSnapOffset,
  resolveGlassSnapHeights,
  type GlassSnapPoint,
} from "../lib/glass-sheet";

const SPRING = { damping: 28, stiffness: 320, mass: 0.86 } as const;
/**
 * The exit is timed, not sprung. A spring is only "finished" once it settles
 * inside Reanimated's rest thresholds, and this one is underdamped: it clears
 * the screen in a quarter of a second but takes the better part of another
 * second to formally land. The sheet unmounts on that callback, so all of that
 * time was spent with an invisible modal over the app eating taps.
 */
const EXIT_MS = 220;
/** Reduced motion replaces every sheet movement with this short fade of travel. */
const REDUCED_MS = 140;

/**
 * Frosted bottom sheet — full-bleed glass pane, hairline rim.
 * Built with Reanimated + Skia. Not a wrapper around Gorhom.
 */
export function GlassSheet({
  visible,
  onClose,
  children,
  title,
  snapPoints = ["auto"],
  testID = "glass-sheet",
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  accent?: string;
  title?: string;
  snapPoints?: GlassSnapPoint[];
  testID?: string;
}) {
  const theme = useOptionalAppTheme();
  const osReduce = useReducedMotion();
  const reduceMotion = Boolean(theme?.settings.reduceMotion || osReduce);
  const dark = theme?.dark ?? false;
  const colors = theme?.colors;
  const ink = colors?.ink ?? "#2a2218";
  const inkSoft = colors?.inkSoft ?? "#6e6354";
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = windowHeight - insets.top - 24;
  const bodyPadBottom = GLASS_SHEET_BODY_PAD_BOTTOM + insets.bottom;

  const [mounted, setMounted] = useState(visible);
  const [contentHeight, setContentHeight] = useState(0);
  const [borderSize, setBorderSize] = useState({ width: 0, height: 0 });
  /**
   * One number per open. It keys the measuring subtree, so a reopen always gets
   * a fresh layout pass even when the new sheet happens to be the same size as
   * the one before it, and it stamps the exit animation, so a close that gets
   * interrupted cannot unmount the sheet that replaced it. Either failure left
   * a transparent modal sitting over the screen eating taps.
   */
  const [openSeq, setOpenSeq] = useState(0);
  const seqRef = useRef(0);
  /**
   * True from the moment a close starts until the sheet is gone. The modal
   * stops taking touches immediately, so even a late unmount cannot swallow a
   * tap meant for the screen underneath.
   */
  const [closing, setClosing] = useState(false);

  const snapHeights = useMemo(
    () =>
      resolveGlassSnapHeights({
        snapPoints,
        windowHeight,
        contentHeight,
        maxHeight,
      }),
    [contentHeight, maxHeight, snapPoints, windowHeight]
  );
  const sheetHeight = snapHeights[snapHeights.length - 1] ?? Math.round(windowHeight * 0.42);

  const translateY = useSharedValue(windowHeight);
  const dragStart = useSharedValue(windowHeight);
  const sheetH = useSharedValue(sheetHeight);
  const snap0 = useSharedValue(sheetHeight);
  const snap1 = useSharedValue(sheetHeight);
  const snap2 = useSharedValue(sheetHeight);
  const snapCount = useSharedValue(1);
  const reduceSV = useSharedValue(reduceMotion ? 1 : 0);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const notifyClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    sheetH.value = sheetHeight;
    snapCount.value = snapHeights.length;
    snap0.value = snapHeights[0] ?? sheetHeight;
    snap1.value = snapHeights[1] ?? snapHeights[0] ?? sheetHeight;
    snap2.value = snapHeights[2] ?? snapHeights[snapHeights.length - 1] ?? sheetHeight;
  }, [sheetH, sheetHeight, snap0, snap1, snap2, snapCount, snapHeights]);

  useEffect(() => {
    reduceSV.value = reduceMotion ? 1 : 0;
  }, [reduceMotion, reduceSV]);

  const unmount = useCallback((seq: number) => {
    // A reopen has already claimed a newer sequence; this close is stale.
    if (seq !== seqRef.current) return;
    setMounted(false);
    setClosing(false);
  }, []);

  const animateTo = useCallback(
    (to: number, hide: boolean) => {
      const seq = seqRef.current;
      if (hide) {
        translateY.value = withTiming(
          to,
          { duration: reduceMotion ? REDUCED_MS : EXIT_MS },
          (finished) => {
            if (finished) runOnJS(unmount)(seq);
          }
        );
        return;
      }
      if (reduceMotion) {
        translateY.value = withTiming(to, { duration: REDUCED_MS });
        return;
      }
      translateY.value = withSpring(to, SPRING);
    },
    [reduceMotion, translateY, unmount]
  );

  const openToRest = useCallback(() => {
    const rest = restOffset(sheetHeight, snapHeights[0] ?? sheetHeight);
    animateTo(rest, false);
  }, [animateTo, sheetHeight, snapHeights]);

  const dismiss = useCallback(() => {
    notifyClose();
  }, [notifyClose]);

  const autoSized = snapPoints.length === 0 || snapPoints.some((point) => point === "auto");
  const measured = !autoSized || contentHeight > 0;
  const openedRef = useRef(false);

  useEffect(() => {
    if (visible) {
      // Each open measures its own children, so drop the previous sheet's height
      // and hand the measuring subtree a new key to guarantee it reports one.
      seqRef.current += 1;
      setOpenSeq(seqRef.current);
      openedRef.current = false;
      setClosing(false);
      cancelAnimation(translateY);
      setContentHeight(0);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (openedRef.current) {
      openedRef.current = false;
      setClosing(true);
      animateTo(sheetHeight + 80, true);
    } else {
      setMounted(false);
      setClosing(false);
    }
    // Presentation is driven by `visible` only; sheet height is measured after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // An auto sheet waits for its measurement before it slides, so it arrives at
  // full height instead of growing a frame at a time after it lands.
  useEffect(() => {
    if (!mounted || !visible || openedRef.current || !measured) return;
    openedRef.current = true;
    translateY.value = sheetHeight + 80;
    openToRest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, mounted, visible]);

  useEffect(() => {
    if (!mounted) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss, mounted]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-16, 16])
        .failOffsetX([-28, 28])
        .onStart(() => {
          dragStart.value = translateY.value;
        })
        .onUpdate((event) => {
          const next = dragStart.value + event.translationY;
          const max = sheetH.value + 120;
          translateY.value = Math.min(max, Math.max(0, next));
        })
        .onEnd((event) => {
          const snaps: number[] = [];
          if (snapCount.value >= 1) snaps.push(snap0.value);
          if (snapCount.value >= 2) snaps.push(snap1.value);
          if (snapCount.value >= 3) snaps.push(snap2.value);
          const target = pickSnapOffset(translateY.value, snaps, sheetH.value, event.velocityY);
          if (target === "dismiss") {
            runOnJS(notifyClose)();
            return;
          }
          if (reduceSV.value) {
            translateY.value = withTiming(target, { duration: 140 });
          } else {
            translateY.value = withSpring(target, SPRING);
          }
        }),
    [dragStart, notifyClose, reduceSV, sheetH, snap0, snap1, snap2, snapCount, translateY]
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    const height = sheetH.value || windowHeight;
    const progress = interpolate(translateY.value, [0, height + 40], [1, 0], "clamp");
    return { opacity: progress };
  });

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={dismiss}
    >
      <GestureHandlerRootView style={styles.flex}>
        <View
          style={styles.flex}
          testID={testID}
          pointerEvents={closing ? "none" : "auto"}
        >
          <Animated.View testID={`${testID}-scrim`} style={[styles.backdrop, backdropStyle]}>
            <Pressable
              testID={`${testID}-backdrop`}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              onPress={dismiss}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <GestureDetector gesture={pan}>
            <Animated.View
              testID={`${testID}-card`}
              style={[
                styles.card,
                {
                  height: sheetHeight,
                  borderTopLeftRadius: GLASS_SHEET_RADIUS,
                  borderTopRightRadius: GLASS_SHEET_RADIUS,
                  // Hidden for the measuring frame, before the open animation is aimed.
                  opacity: measured ? 1 : 0,
                },
                sheetStyle,
              ]}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setBorderSize((current) =>
                  current.width === width && current.height === height ? current : { width, height }
                );
              }}
            >
              <View
                style={[
                  styles.clip,
                  {
                    borderTopLeftRadius: GLASS_SHEET_RADIUS,
                    borderTopRightRadius: GLASS_SHEET_RADIUS,
                  },
                ]}
              >
                <BlurView
                  tint={dark ? "dark" : "light"}
                  intensity={dark ? 56 : 72}
                  blurMethod="dimezisBlurView"
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <GlassSheetBorder
                width={borderSize.width}
                height={borderSize.height}
                dark={dark}
                base={colors?.panel}
              />
              <View style={[styles.body, { paddingBottom: bodyPadBottom }]}>
                <View
                  key={openSeq}
                  testID={`${testID}-measure`}
                  // An auto sheet sizes itself to this box, so it must hug its
                  // content. A sheet with fixed snap heights is the reverse: its
                  // body fills the card, or a scrolling list inside collapses to
                  // nothing and the sheet opens blank.
                  style={autoSized ? styles.measure : styles.fill}
                  onLayout={(event) => {
                    const next = sheetHeightForContent(
                      event.nativeEvent.layout.height,
                      insets.bottom,
                      maxHeight
                    );
                    setContentHeight((current) => (current === next ? current : next));
                  }}
                >
                  <View style={[styles.handle, { backgroundColor: alpha(inkSoft, 0.45) }]} />
                  <View style={styles.header}>
                    <Text
                      numberOfLines={1}
                      style={[styles.title, { color: inkSoft, opacity: title ? 1 : 0 }]}
                    >
                      {title ?? " "}
                    </Text>
                    <Pressable
                      testID={`${testID}-close`}
                      onPress={dismiss}
                      accessibilityRole="button"
                      accessibilityLabel="Close"
                      hitSlop={10}
                      style={({ pressed }) => [
                        styles.closeBtn,
                        {
                          backgroundColor: alpha(ink, dark ? 0.14 : 0.08),
                          opacity: pressed ? 0.65 : 1,
                        },
                      ]}
                    >
                      <CloseIcon color={ink} size={14} />
                    </Pressable>
                  </View>
                  <View style={styles.children}>{children}</View>
                </View>
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(6, 8, 12, 0.62)",
  },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  clip: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: GLASS_SHEET_BODY_PAD_TOP,
  },
  measure: { flexGrow: 0, flexShrink: 0 },
  fill: { flex: 1 },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    marginBottom: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  children: { flexGrow: 1 },
});
