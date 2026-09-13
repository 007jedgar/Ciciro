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
  GLASS_SHEET_INSET,
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
const HIDDEN = 640;

/**
 * Frosted card sheet — floating inset, gradient wash, hue-shifting glow.
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
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const maxHeight = windowHeight - insets.top - 24;
  const sheetWidth = Math.max(0, windowWidth - GLASS_SHEET_INSET * 2);

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

  const translateY = useSharedValue(HIDDEN);
  const dragStart = useSharedValue(HIDDEN);
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

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = sheetHeight + 80;
      openToRest();
      return;
    }
    if (mounted) animateTo(sheetHeight + 80, true);
    // Presentation is driven by `visible` only; sheet height is measured after open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
    const height = sheetH.value || HIDDEN;
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
                  width: sheetWidth,
                  borderRadius: GLASS_SHEET_RADIUS,
                  bottom: Math.max(insets.bottom, 8),
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
              <View style={[styles.clip, { borderRadius: GLASS_SHEET_RADIUS }]}>
                <BlurView
                  tint={dark ? "dark" : "light"}
                  intensity={dark ? 38 : 52}
                  experimentalBlurMethod="dimezisBlurView"
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <GlassSheetBorder
                width={borderSize.width}
                height={borderSize.height}
                accent={accentColor}
                dark={dark}
                reduceMotion={reduceMotion}
              />
              <View
                style={[styles.body, { paddingBottom: 14 }]}
                onLayout={(event) => {
                  const next = event.nativeEvent.layout.height + 8;
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
                      { backgroundColor: alpha(ink, dark ? 0.14 : 0.08), opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <CloseIcon color={ink} size={14} />
                  </Pressable>
                </View>
                <View style={styles.children}>{children}</View>
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
    backgroundColor: "rgba(12, 14, 18, 0.38)",
  },
  card: {
    position: "absolute",
    left: GLASS_SHEET_INSET,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  clip: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
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
