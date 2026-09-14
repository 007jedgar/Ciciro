export function skeletonShineX(progress: number, width: number): number {
  "worklet";
  return -width + progress * width * 2;
}
