import type { ReactNode } from "react";
import { Linking, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { AlertText } from "../AlertText";
import { alpha } from "../Glass";
import { AlertIcon, CameraIcon, CloseIcon, PhotoIcon } from "../icons";
import { Kicker } from "../Kicker";
import { PressableCard } from "../PressableCard";
import { TapPressable } from "../TapPressable";
import { getAnalytics } from "../../lib/analytics-client";
import { failureMessageKey } from "../../lib/chat-errors";
import { SCAN_PAGES_MAX, type ScanFailure, type ScanPageDraft } from "../../lib/notes-scan";
import { storePurchasesAvailable } from "../../lib/purchases";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";

/** Something the camera or the library did that the writer should hear about. */
export type CaptureNotice =
  | { kind: "denied"; canAskAgain: boolean }
  | { kind: "unavailable" }
  | { kind: "tooMany" };

const GAP = 10;
const SIDE = 20;

function SourceTile({
  icon,
  label,
  onPress,
  testID,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
  disabled: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <PressableCard
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.tile, { backgroundColor: colors.panel, borderColor: colors.line, opacity: disabled ? 0.5 : 1 }]}
    >
      {icon}
      <Text style={[styles.tileLabel, { color: colors.ink }]}>{label}</Text>
    </PressableCard>
  );
}

function Notice({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useAppTheme();
  return (
    <View
      testID={testID}
      style={[styles.notice, { backgroundColor: colors.panel, borderColor: colors.line }]}
      accessibilityRole="alert"
    >
      <View style={{ paddingTop: 2 }}>
        <AlertIcon color={colors.inkSoft} size={17} />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/**
 * Step one: gather the photos. Taking one opens the camera; choosing opens the
 * library, which needs no permission and is also the way in on a device
 * without a camera. The photos wait here (up to the cap), in reading order,
 * until Read.
 */
export function CapturePage({
  pages,
  notice,
  failure,
  online,
  onTake,
  onPick,
  onRemove,
  onRead,
}: {
  pages: readonly ScanPageDraft[];
  notice: CaptureNotice | null;
  failure: ScanFailure | null;
  online: boolean;
  onTake: () => void;
  onPick: () => void;
  onRemove: (id: string) => void;
  onRead: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const { width } = useWindowDimensions();
  const thumb = Math.floor((width - SIDE * 2 - GAP * 2) / 3);
  const full = pages.length >= SCAN_PAGES_MAX;
  const blocked = pages.length === 0 || !online;
  const offerPro = failure?.kind === "limit" && failure.plan !== "pro" && storePurchasesAvailable();

  return (
    <View testID="scan-capture">
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("scanNotes.capture.blurb")}</Text>

      <View style={styles.tiles}>
        <SourceTile
          testID="scan-take-photo"
          icon={<CameraIcon color={colors.accent} />}
          label={t("scanNotes.capture.takePhoto")}
          onPress={onTake}
          disabled={full}
        />
        <SourceTile
          testID="scan-choose-library"
          icon={<PhotoIcon color={colors.accent} />}
          label={t("scanNotes.capture.chooseLibrary")}
          onPress={onPick}
          disabled={full}
        />
      </View>

      {notice?.kind === "denied" ? (
        <Notice testID="scan-camera-denied">
          <Text style={[styles.noticeText, { color: colors.ink }]}>
            {t(notice.canAskAgain ? "scanNotes.capture.cameraDenied" : "scanNotes.capture.cameraOff")}
          </Text>
          {!notice.canAskAgain ? (
            <TapPressable
              feedback="dim"
              accessibilityRole="button"
              accessibilityLabel={t("scanNotes.capture.openSettings")}
              onPress={() => void Linking.openSettings()}
              hitSlop={8}
              style={{ alignSelf: "flex-start", marginTop: 8 }}
            >
              <Text style={[styles.noticeLink, { color: colors.accent }]}>{t("scanNotes.capture.openSettings")}</Text>
            </TapPressable>
          ) : null}
        </Notice>
      ) : null}
      {notice?.kind === "unavailable" ? (
        <Notice testID="scan-no-camera">
          <Text style={[styles.noticeText, { color: colors.ink }]}>{t("scanNotes.capture.noCamera")}</Text>
        </Notice>
      ) : null}
      {notice?.kind === "tooMany" ? (
        <Notice testID="scan-too-many">
          <Text style={[styles.noticeText, { color: colors.ink }]}>
            {t("scanNotes.capture.tooMany", { max: SCAN_PAGES_MAX })}
          </Text>
        </Notice>
      ) : null}

      {pages.length > 0 ? (
        <View style={{ marginTop: 24 }}>
          <Kicker
            label={t("scanNotes.capture.pages")}
            count={t("scanNotes.capture.pageCount", { count: pages.length, max: SCAN_PAGES_MAX })}
          />
          <View style={styles.grid} testID="scan-pages">
            {pages.map((page, index) => (
              <View
                key={page.id}
                style={[styles.thumb, { width: thumb, height: Math.round((thumb * 4) / 3), borderColor: colors.line }]}
                accessible
                accessibilityLabel={t("scanNotes.capture.pageA11y", { number: index + 1 })}
              >
                <Image source={{ uri: page.uri }} contentFit="cover" style={StyleSheet.absoluteFill} />
                <View style={[styles.badge, { backgroundColor: alpha(colors.bg, 0.86) }]}>
                  <Text style={[styles.badgeText, { color: colors.ink }]}>{index + 1}</Text>
                </View>
                <TapPressable
                  testID={`scan-remove-${index + 1}`}
                  accessibilityRole="button"
                  accessibilityLabel={t("scanNotes.capture.removePage", { number: index + 1 })}
                  onPress={() => onRemove(page.id)}
                  hitSlop={8}
                  style={[styles.remove, { backgroundColor: alpha(colors.bg, 0.86) }]}
                >
                  <CloseIcon color={colors.ink} size={12} />
                </TapPressable>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <Text style={[styles.tip, { color: colors.inkSoft }]}>{t("scanNotes.capture.tip")}</Text>
      )}

      {failure ? (
        <Notice testID="scan-failure">
          <AlertText style={[styles.noticeText, { color: colors.ink }]} role="alert">
            {failure.kind === "limit"
              ? t(failureMessageKey({ code: "aiLimit", status: 402, detail: "", retryable: false, plan: failure.plan }))
              : t(`scanNotes.error.${failure.kind}`)}
          </AlertText>
          {offerPro ? (
            <TapPressable
              feedback="dim"
              accessibilityRole="button"
              accessibilityLabel={t("billing.seePro")}
              onPress={() => {
                getAnalytics().track("cta_clicked", { cta: "see_pro", surface: "scan_notes" });
                router.push("/paywall");
              }}
              hitSlop={8}
              style={{ alignSelf: "flex-start", marginTop: 8 }}
            >
              <Text style={[styles.noticeLink, { color: colors.accent }]}>{t("billing.seePro")}</Text>
            </TapPressable>
          ) : null}
        </Notice>
      ) : null}

      {!online && !failure ? (
        <Notice testID="scan-offline">
          <Text style={[styles.noticeText, { color: colors.ink }]}>{t("scanNotes.capture.offline")}</Text>
        </Notice>
      ) : null}

      <TapPressable
        testID="scan-read"
        style={[layout.primaryBtn, { marginTop: 24, opacity: blocked ? 0.5 : 1 }]}
        disabled={blocked}
        onPress={onRead}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
      >
        <Text style={layout.primaryBtnText}>
          {pages.length === 0 ? t("scanNotes.capture.readEmpty") : t("scanNotes.capture.read", { count: pages.length })}
        </Text>
      </TapPressable>

      <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t("scanNotes.capture.privacy")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: GAP },
  tile: {
    flex: 1,
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  tileLabel: { fontFamily: fonts.uiBold, fontSize: 14.5, textAlign: "center" },
  notice: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderRadius: 10,
  },
  noticeText: { fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 21 },
  noticeLink: { fontFamily: fonts.uiMedium, fontSize: 14.5 },
  tip: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, marginTop: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  thumb: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  badge: {
    position: "absolute",
    left: 6,
    bottom: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.monoMedium, fontSize: 11 },
  remove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  privacy: { fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 16 },
});
