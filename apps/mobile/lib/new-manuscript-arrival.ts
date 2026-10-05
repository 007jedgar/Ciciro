/**
 * Which manuscript the user has just created and been taken to, so its chapters
 * screen can slide its content down the first time it is shown and not on every
 * visit after. Held in memory rather than in a route param: a param would
 * outlive the screen (deep links, restoring the last place) and replay the
 * animation on a manuscript that is not new.
 */
let arrivingProjectId: string | null = null;

/** Call as the new manuscript's route is opened. */
export function markNewManuscriptArrival(projectId: string): void {
  arrivingProjectId = projectId;
}

/** Whether `projectId` is the manuscript just created and not yet arrived at. Reading does not clear it. */
export function isNewManuscriptArrival(projectId: string): boolean {
  return arrivingProjectId !== null && arrivingProjectId === projectId;
}

/** Call once the arrival has played, so later visits do not replay it. */
export function consumeNewManuscriptArrival(projectId: string): void {
  if (arrivingProjectId === projectId) arrivingProjectId = null;
}
