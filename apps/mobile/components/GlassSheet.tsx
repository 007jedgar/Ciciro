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
  GLASS_SHEET_RADIUS,
  pickSnapOffset,
  resolveGlassSnapHeights,
  restOffset,
  type GlassSnapPoint,
} from "../lib/glass-sheet";
import { useOptionalAppTheme } from "../lib/settings";
import { GlassSheetBorder } from "./GlassSheetBorder";
import { CloseIcon } from "./icons";
import { alpha } from "./Glass";

export {
  GLASS_SHEET_RADIUS,
  glassSheetFillColors,
  glassSheetGlowColors,
  pickSnapOffset,
  resolveGlassSnapHeights,
  type GlassSnapPoint,
} from "../lib/glass-sheet";

const SPRING = { damping: 28, stiffness: 320, mass: 0.86 } as const;
const BODY_PAD_TOP = 10;
const BODY_PAD_BOTTOM = 14;

/**
 * Frosted bottom sheet — full-bleed, sandblasted wash, hue-shifting top edge.
 * Built with Reanimated + Skia. Not a wrapper around Gorhom.
 */
export function GlassSheet({
  visible,
  onClose,
  children,
  accent,
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
  const accentColor = accent ?? colors?.accent ?? "#b4552d";
  const ink = colors?.ink ?? "#2a2218";
  const inkSoft = colors?.inkSoft ?? "#6e6354";
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = windowHeight - insets.top - 24;
  const bodyPadBottom = BODY_PAD_BOTTOM + insets.bottom;

  const [mounted, setMounted] = useState(visible);
  const [contentHeight, setContentHeight] = useState(0);
  const [borderSize, setBorderSize] = useState({ width: 0, height: 0 });

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

  const unmount = useCallback(() => {
    setMounted(false);
  }, []);

  const animateTo = useCallback(
    (to: number, hide: boolean) => {
      if (reduceMotion) {
        translateY.value = withTiming(to, { duration: 140 }, (finished) => {
          if (finished && hide) runOnJS(unmount)();
        });
        return;
      }
      translateY.value = withSpring(to, SPRING, (finished) => {
        if (finished && hide) runOnJS(unmount)();
      });
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
      // Each open measures its own children, so drop the previous sheet's height.
      setContentHeight(0);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (openedRef.current) {
      openedRef.current = false;
      animateTo(sheetHeight + 80, true);
    } else {
      setMounted(false);
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
        <View style={styles.flex} testID={testID}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
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
                  intensity={dark ? 44 : 60}
                  experimentalBlurMethod="dimezisBlurView"
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <GlassSheetBorder
                width={borderSize.width}
                height={borderSize.height}
                accent={accentColor}
                dark={dark}
                base={colors?.panel}
                reduceMotion={reduceMotion}
              />
              <View style={[styles.body, { paddingBottom: bodyPadBottom }]}>
                <View
                  style={styles.measure}
                  onLayout={(event) => {
                    const next =
                      Math.round(event.nativeEvent.layout.height) + BODY_PAD_TOP + bodyPadBottom;
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 8, 12, 0.62)",
  },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  clip: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: BODY_PAD_TOP,
  },
  measure: { flexShrink: 1 },
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
