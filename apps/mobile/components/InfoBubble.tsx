import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { Glass } from "./Glass";
import { InfoIcon } from "./icons";

const PANEL_MAX = 264;
const EDGE = 16;

/**
 * A tiny info glyph that opens a frosted pop-up — the same glass language as
 * the header "new" menu — so new chrome can explain itself in place.
 */
export function InfoBubble({
  title,
  body,
  hint,
  children,
  accessibilityLabel,
  testID = "info-bubble",
}: {
  title?: string;
  body?: string;
  hint?: string;
  children?: ReactNode;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? parchmentColors;
  const dark = theme?.dark ?? false;
  const reduceMotion = Boolean(theme?.settings.reduceMotion);
  const { width: windowWidth } = useWindowDimensions();
  const buttonRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) {
      appear.setValue(0);
      return;
    }
    if (reduceMotion) {
      appear.setValue(1);
      return;
    }
    Animated.spring(appear, {
      toValue: 1,
      damping: 15,
      stiffness: 190,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [appear, open, reduceMotion]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  function openPopup() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
    setOpen(true);
  }

  function closePopup() {
    setOpen(false);
  }

  const right =
    anchor.width > 0 ? Math.max(EDGE, windowWidth - (anchor.x + anchor.width)) : EDGE;
  const top = anchor.height > 0 ? anchor.y + anchor.height + 8 : 120;

  return (
    <>
      <Pressable
        ref={buttonRef}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={openPopup}
        style={({ pressed }) => [styles.hit, { opacity: pressed ? 0.5 : 1 }]}
      >
        <InfoIcon color={colors.inkSoft} size={14} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={closePopup}
      >
        <View style={styles.layer} testID={`${testID}-popup`} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={closePopup}
            style={[StyleSheet.absoluteFill, styles.scrim]}
          />
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.panelWrap,
              {
                top,
                right,
                opacity: appear,
                transform: [
                  {
                    scale: appear.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Glass dark={dark} colors={colors} radius={22} style={styles.panel}>
              {title ? (
                <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
              ) : null}
              {body ? (
                <Text style={[styles.body, { color: colors.ink }]}>{body}</Text>
              ) : null}
              {hint ? (
                <Text style={[styles.hint, { color: colors.inkSoft }]}>{hint}</Text>
              ) : null}
              {children}
            </Glass>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  layer: { flex: 1 },
  scrim: { backgroundColor: "rgba(0,0,0,0.4)" },
  panelWrap: { position: "absolute", maxWidth: PANEL_MAX },
  panel: { paddingHorizontal: 16, paddingVertical: 14, minWidth: 200, gap: 8 },
  title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, fontWeight: "500", lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18 },
});
