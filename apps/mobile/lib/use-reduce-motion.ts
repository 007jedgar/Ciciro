import { useReducedMotion } from "react-native-reanimated";
import { useAppTheme } from "./settings";

/** True if the user's synced "Reduce motion" setting is on, or the OS accessibility setting is. */
export function useReduceMotion(): boolean {
  const { settings } = useAppTheme();
  const osReduceMotion = useReducedMotion();
  return settings.reduceMotion || osReduceMotion;
}
