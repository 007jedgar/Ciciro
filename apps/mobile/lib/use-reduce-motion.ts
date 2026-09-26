import { useReducedMotion } from "react-native-reanimated";
import { useOptionalAppTheme } from "./settings";

/** True if the user's synced "Reduce motion" setting is on, or the OS accessibility setting is. */
export function useReduceMotion(): boolean {
  const reduceMotion = useOptionalAppTheme()?.settings.reduceMotion ?? false;
  const osReduceMotion = useReducedMotion();
  return reduceMotion || osReduceMotion;
}
