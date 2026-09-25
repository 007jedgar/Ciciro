export const SPRINT_DURATIONS_MIN = [15, 25] as const;
export type SprintDurationMin = (typeof SPRINT_DURATIONS_MIN)[number];

export const SPRINT_END_NOTIFICATION_ID = "ciciro.sprint.end";

export type ActiveSprint = {
  projectId: string;
  durationMin: SprintDurationMin;
  startedAt: number;
  endsAt: number;
  startWords: number;
};

let activeSprint: ActiveSprint | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getActiveSprint(): ActiveSprint | null {
  return activeSprint;
}

export function setActiveSprint(sprint: ActiveSprint | null): void {
  activeSprint = sprint;
  emit();
}

export function subscribeActiveSprint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sprintHref(projectId: string): string {
  return `/project/${projectId}/sprint`;
}

export function sprintWordsWritten(startWords: number, endWords: number): number {
  if (!Number.isFinite(startWords) || !Number.isFinite(endWords)) return 0;
  const delta = Math.floor(endWords) - Math.floor(startWords);
  return delta > 0 ? delta : 0;
}

export function sprintEndsAt(startedAt: number, durationMin: SprintDurationMin): number {
  return startedAt + durationMin * 60_000;
}

export function sprintRemainingMs(endsAt: number, now = Date.now()): number {
  return Math.max(0, endsAt - now);
}

export function formatSprintClock(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
