export const STACK_POP_MS = 320;
export const STACK_POP_FADE_MS = 140;

export function stackPopTransform(progress: number): {
  opacity: number;
  scale: number;
  translateX: number;
  translateY: number;
} {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  return {
    opacity: 1 - p,
    scale: 1 - p * 0.12,
    translateX: p * 40,
    translateY: p * 72,
  };
}

export function shouldInterceptStackRemove(actionType: string): boolean {
  return (
    actionType === "GO_BACK" ||
    actionType === "POP" ||
    actionType === "POP_TO" ||
    actionType === "POP_TO_TOP"
  );
}
