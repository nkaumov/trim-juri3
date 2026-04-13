import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { ensureDb } from "@/lib/db";

const SESSION_COOKIE = "jurist3_session";

export type AuthUser = {
  id: string;
  email: string;
};

export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) {
    return null;
  }

  const db = await ensureDb();
  const result = await db.query(
    `SELECT users.id, users.email
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1 AND sessions.expires_at > now()`,
    [sessionId],
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0] as AuthUser;
}

export async function requireSessionUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export async function loginWithPassword(email: string, password: string): Promise<AuthUser | null> {
  const db = await ensureDb();
  const result = await db.query(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email],
  );
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0] as { id: string; email: string; password_hash: string };
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function bootstrapAdmin(email: string, password: string): Promise<AuthUser> {
  const db = await ensureDb();
  const result = await db.query("SELECT id, email FROM users WHERE email = $1", [email]);
  if (result.rowCount > 0) {
    return result.rows[0] as AuthUser;
  }
  const hash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();
  await db.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [
    id,
    email,
    hash,
  ]);
  return { id, email };
}

export async function createSession(userId: string): Promise<string> {
  const db = await ensureDb();
  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await db.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [
    sessionId,
    userId,
    expires,
  ]);
  return sessionId;
}

export async function setSessionCookie(sessionId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
