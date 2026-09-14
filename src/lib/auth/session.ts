import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  authRequired,
  SESSION_COOKIE,
  SESSION_HEADER,
  tokenFromCookieHeader,
} from "@/lib/auth/constants";
import { peekRequestSession } from "@/lib/auth/session-binding";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
  validatePassword,
} from "@/lib/auth/tokens";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
};

export class AuthError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status = 400, body?: unknown) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.body = body;
  }
}

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
}): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

/** Create a user, hashing the password. Throws AuthError on bad input/dupe. */
export async function registerUser(input: {
  email: unknown;
  password: unknown;
  name?: unknown;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  if (!email) throw new AuthError("Enter a valid email address.");
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AuthError(passwordError);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AuthError("An account with that email already exists.", 409);

  const passwordHash = await hashPassword(input.password as string);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
  });
  return toPublicUser(user);
}

/** Verify credentials. Returns the user or throws AuthError (401 on mismatch). */
export async function authenticate(input: {
  email: unknown;
  password: unknown;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const password = input.password;
  // Uniform failure so we do not reveal whether the email exists.
  const invalid = new AuthError("Incorrect email or password.", 401);
  if (!email || typeof password !== "string") throw invalid;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Spend comparable time so timing does not leak account existence.
    await verifyPassword(password, "scrypt$16384$8$1$00$00");
    throw invalid;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw invalid;
  return toPublicUser(user);
}

/**
 * Issue a session for a user: persist the token hash and set the httpOnly
 * cookie. Returns the raw token (already placed in the cookie jar).
 */
export async function createSession(
  userId: string,
  userAgent = ""
): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      userAgent: userAgent.slice(0, 400),
      expiresAt,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

function pushToken(tokens: string[], value: string | null | undefined): void {
  const token = value?.trim();
  if (token && !tokens.includes(token)) tokens.push(token);
}

export type SessionRequest = {
  headers: Headers;
  cookies?: {
    get(name: string): { value: string } | undefined;
  };
};

function pushTokensFromRequest(tokens: string[], request?: SessionRequest): void {
  if (!request) return;
  pushToken(tokens, request.headers.get(SESSION_HEADER));
  pushToken(tokens, tokenFromCookieHeader(request.headers.get("cookie")));
  try {
    pushToken(tokens, request.cookies?.get(SESSION_COOKIE)?.value);
  } catch {
    // NextRequest.cookies can throw outside a request.
  }
}

async function sessionTokens(request?: SessionRequest): Promise<string[]> {
  const tokens: string[] = [];
  pushToken(tokens, peekRequestSession());
  // Prefer the Route Handler Request: OpenNext often continues outside ALS and
  // leaves next/headers empty on /api/projects/:id and /api/chapters?projectId=.
  pushTokensFromRequest(tokens, request);
  try {
    const jar = await cookies();
    pushToken(tokens, jar.get(SESSION_COOKIE)?.value);
  } catch {
    // No Next.js cookie store (tests / background work).
  }
  try {
    const h = await headers();
    pushToken(tokens, h.get(SESSION_HEADER));
    pushToken(tokens, tokenFromCookieHeader(h.get("cookie")));
  } catch {
    // No request headers.
  }
  return tokens;
}

/** Resolve the current user from the session cookie, or null. Sweeps expiry. */
export async function getSessionUser(request?: SessionRequest): Promise<PublicUser | null> {
  const now = Date.now();
  for (const token of await sessionTokens(request)) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session) continue;
    if (session.expiresAt.getTime() < now) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      continue;
    }
    return toPublicUser(session.user);
  }
  return null;
}

/** Like getSessionUser but throws a 401 AuthError when unauthenticated. */
export async function requireSessionUser(request?: SessionRequest): Promise<PublicUser> {
  const user = await getSessionUser(request);
  if (!user) throw new AuthError("Authentication required.", 401);
  return user;
}

/** Hosted mode must never fall through to "list everyone / no owner". */
export function requireUserIfHosted(user: PublicUser | null): void {
  if (authRequired() && !user) {
    throw new AuthError("Authentication required.", 401);
  }
}

function denyIfNotOwner(
  ownerId: string | null,
  user: PublicUser | null,
  message: string
): void {
  if (!user) {
    if (authRequired()) throw new AuthError("Authentication required.", 401);
    return;
  }
  if (ownerId === user.id) return;
  // Local-first still allows unowned rows. Hosted never shares another author's work.
  if (ownerId || authRequired()) throw new AuthError(message, 403);
}

/**
 * Authorize access to a project for a resolved user. When `user` is null
 * (local-first / no session), access is allowed. Hosted mode requires a
 * session and never treats a missing owner as public.
 * Throws AuthError (401/403/404) on denial.
 */
export async function authorizeProjectId(
  projectId: string,
  user: PublicUser | null
): Promise<void> {
  requireUserIfHosted(user);
  if (!user) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!project) throw new AuthError("Not found.", 404);
  denyIfNotOwner(project.userId, user, "You do not have access to this manuscript.");
}

/**
 * Authorize access to a folder. Same local-first / owner rules as projects.
 */
export async function authorizeFolderId(
  folderId: string,
  user: PublicUser | null
): Promise<void> {
  requireUserIfHosted(user);
  if (!user) return;
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { userId: true },
  });
  if (!folder) throw new AuthError("Not found.", 404);
  denyIfNotOwner(folder.userId, user, "You do not have access to this folder.");
}

/**
 * Authorize access to a project using the current session (cookie, native
 * header, or the Route Handler Request when one is passed).
 */
export async function authorizeProject(
  projectId: string,
  request?: SessionRequest
): Promise<void> {
  await authorizeProjectId(projectId, await getSessionUser(request));
}

/** Destroy the current session (DB row + cookie). Idempotent. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
      .catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}
