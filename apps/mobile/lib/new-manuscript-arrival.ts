/**
 * Which manuscript the user has just created and been taken to, so its chapters
 * screen can slide its content down the first time it is shown and not on every
 * visit after. Held in memory rather than in a route param: a param would
 * outlive the screen (deep links, restoring the last place) and replay the
 * animation on a manuscript that is not new.
 */
let arrivingProjectId: string | null = null;
let arrivingIsFirst = false;

/**
 * Call as the new manuscript's route is opened. `first` is the server's
 * `isFirstProject`: the account's very first manuscript gets a one-time
 * flourish on arrival, and that flag is the server's, so it never replays.
 */
export function markNewManuscriptArrival(projectId: string, first = false): void {
  arrivingProjectId = projectId;
  arrivingIsFirst = first;
}

/** Whether `projectId` is the just-created manuscript and the first one the account ever made. */
export function isFirstManuscriptArrival(projectId: string): boolean {
  return arrivingIsFirst && isNewManuscriptArrival(projectId);
}

/** Whether `projectId` is the manuscript just created and not yet arrived at. Reading does not clear it. */
export function isNewManuscriptArrival(projectId: string): boolean {
  return arrivingProjectId !== null && arrivingProjectId === projectId;
}

/** Call once the arrival has played, so later visits do not replay it. */
export function consumeNewManuscriptArrival(projectId: string): void {
  if (arrivingProjectId === projectId) {
    arrivingProjectId = null;
    arrivingIsFirst = false;
  }
}
