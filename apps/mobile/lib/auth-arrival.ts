/**
 * The hand-off from the auth screen to the manuscripts list after a successful
 * sign-in or sign-up. Auth fades its content out to the page colour, the list
 * mounts underneath at that same colour, then fades in while rising, and its
 * rows follow once the page is mostly there - one move instead of a hard cut.
 */

/** Auth fading to the page colour before the list takes over. */
export const AUTH_EXIT_MS = 220;
/** The list fading in and rising. */
export const AUTH_ARRIVE_MS = 460;
/** How far the list rises into place. */
export const AUTH_ARRIVE_RISE = 28;
/** Rows start after the page is mostly in, on top of their own stagger. */
export const AUTH_ROWS_LEAD_MS = 220;

let pending = false;

/** Called by the auth screen right before it hands over to the list. */
export function markAuthArrival(): void {
  pending = true;
}

/** Read once by the list when it mounts: true if this mount follows an auth hand-off. */
export function consumeAuthArrival(): boolean {
  const was = pending;
  pending = false;
  return was;
}
