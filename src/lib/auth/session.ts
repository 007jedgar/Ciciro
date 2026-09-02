import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
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
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
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

/** Resolve the current user from the session cookie, or null. Sweeps expiry. */
export async function getSessionUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return toPublicUser(session.user);
}

/** Like getSessionUser but throws a 401 AuthError when unauthenticated. */
export async function requireSessionUser(): Promise<PublicUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Authentication required.", 401);
  return user;
}

/**
 * Authorize access to a project. When auth is not enforced and there is no
 * session, access is allowed (local-first). When a user is signed in, they may
 * only touch their own projects (or legacy projects with no owner). Returns the
 * project's owner id (or null) so callers can branch; throws AuthError (403/404)
 * on denial.
 */
export async function authorizeProject(projectId: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return; // local-first / middleware handles hosted anonymous access
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!project) throw new AuthError("Not found.", 404);
  if (project.userId && project.userId !== user.id) {
    throw new AuthError("You do not have access to this manuscript.", 403);
  }
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
