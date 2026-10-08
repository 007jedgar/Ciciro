import { forwardRef } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
import * as haptics from "../lib/haptics";

/**
 * A `Pressable` that gives the light haptic tap on press, for buttons, pills and rows.
 * VoiceOver announces it as a button unless the caller names another role (tab, radio, link).
 */
export const TapPressable = forwardRef<View, PressableProps>(function TapPressable({ onPress, ...rest }, ref) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      {...rest}
      onPress={onPress ? haptics.withTap(onPress) : undefined}
    />
  );
});
