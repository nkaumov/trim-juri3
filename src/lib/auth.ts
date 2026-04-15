import crypto from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { ensureDb } from "@/lib/db";

const SESSION_COOKIE = "jurist3_session";
const INTEGRATION_SESSION_PREFIX = "int:";
const INTEGRATION_SESSION_PREFIX_V1 = "intv1.";
const INTEGRATION_SESSION_PREFIX_V2 = "intv2.";
const EXTERNAL_PRODUCT_INTROSPECT_PATH = "/api/v1/external/product-keys/introspect";
const COOKIE_SEPARATOR = "|";

function getPlatformApiBaseUrl(): string {
  return (
    process.env.JURI3_PLATFORM_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8000"
  );
}

function isIntegrationVerifyBypassed(): boolean {
  return process.env.JURI3_INTEGRATION_SKIP_PLATFORM_VERIFY === "true";
}

function decodeOrigin(encoded: string): string {
  let value = encoded;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value;
}

function getIntegrationSessionSecret(): string {
  return (
    process.env.JURI3_INTEGRATION_SESSION_SECRET ||
    process.env.DOCUMENTS_SIGNING_KEY ||
    "change-me-integration-session-secret"
  );
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signIntegrationPayload(payloadB64: string): string {
  const secret = getIntegrationSessionSecret();
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

type IntegrationSessionPayload = {
  user_id: string;
  email: string;
  origin: string;
  iat: number;
  exp: number;
};

export function createIntegrationSessionCookieValue(
  userId: string,
  email: string,
  origin: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: IntegrationSessionPayload = {
    user_id: userId,
    email,
    origin,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = signIntegrationPayload(payloadB64);
  return `${INTEGRATION_SESSION_PREFIX_V2}${payloadB64}.${signature}`;
}

function parseIntegrationSessionV2(
  sessionId: string,
): { userId: string; email: string; origin: string } | null {
  if (!sessionId.startsWith(INTEGRATION_SESSION_PREFIX_V2)) return null;
  const raw = sessionId.slice(INTEGRATION_SESSION_PREFIX_V2.length);
  const [payloadB64, signature] = raw.split(".", 2);
  if (!payloadB64 || !signature) return null;

  const expected = signIntegrationPayload(payloadB64);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

  let payload: IntegrationSessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64)) as IntegrationSessionPayload;
  } catch {
    return null;
  }

  if (!payload?.user_id || !payload?.email || !payload?.origin) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;

  return { userId: payload.user_id, email: payload.email, origin: payload.origin };
}

function parseIntegrationCookie(sessionId: string): { token: string; origin: string } | null {
  const decodedSession = decodeOrigin(sessionId);

  if (decodedSession.startsWith(INTEGRATION_SESSION_PREFIX_V1)) {
    const raw = decodedSession.slice(INTEGRATION_SESSION_PREFIX_V1.length);
    const [tokenEncoded, originEncoded] = raw.split(".", 2);
    if (!tokenEncoded || !originEncoded) return null;
    const token = decodeOrigin(tokenEncoded);
    const origin = decodeOrigin(originEncoded);
    if (!token || !origin) return null;
    return { token, origin };
  }

  if (!decodedSession.startsWith(INTEGRATION_SESSION_PREFIX)) return null;
  const raw = decodedSession.slice(INTEGRATION_SESSION_PREFIX.length);
  const [token, encodedOrigin] = raw.split(COOKIE_SEPARATOR, 2);
  if (!token) return null;
  if (!encodedOrigin) {
    const fallbackOrigin = process.env.JURI3_INTEGRATION_DEFAULT_ORIGIN || "";
    return fallbackOrigin ? { token, origin: fallbackOrigin } : null;
  }
  const origin = decodeOrigin(encodedOrigin);
  if (!origin) return null;
  return { token, origin };
}

export async function verifyPlatformProductKey(apiKey: string, origin: string): Promise<boolean> {
  if (!apiKey.startsWith("pk_")) return false;

  const baseUrl = getPlatformApiBaseUrl().replace(/\/$/, "");
  const target = `${baseUrl}${EXTERNAL_PRODUCT_INTROSPECT_PATH}`;
  const body = JSON.stringify({
    product_code: "juri3",
    origin,
  });

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    if (response.ok) return true;
  } catch {
    // fall through to low-level request fallback
  }

  const url = new URL(target);
  const useHttps = url.protocol === "https:";
  const requestImpl = useHttps ? httpsRequest : httpRequest;

  try {
    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = requestImpl(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
    return statusCode >= 200 && statusCode < 300;
  } catch {
    return false;
  }
}

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

  const integrationV2 = parseIntegrationSessionV2(sessionId);
  if (integrationV2) {
    return {
      id: integrationV2.userId,
      email: integrationV2.email,
    };
  }

  const parsedIntegration = parseIntegrationCookie(sessionId);
  if (parsedIntegration) {
    const parsed = parsedIntegration;
    const integrationToken = parsed.token;
    const integrationOrigin = parsed.origin;
    const expectedToken = process.env.JURI3_INTEGRATION_API_TOKEN || "";
    const staticTokenValid = !!expectedToken && integrationToken === expectedToken;
    const bypassValid = isIntegrationVerifyBypassed() && integrationToken.startsWith("pk_");
    const platformKeyValid =
      staticTokenValid || bypassValid
        ? true
        : await verifyPlatformProductKey(integrationToken, integrationOrigin);
    if (!platformKeyValid) {
      return null;
    }
    const hash = crypto.createHash("sha256").update(integrationToken).digest("hex").slice(0, 16);
    return {
      id: `integration-${hash}`,
      email: process.env.JURI3_INTEGRATION_USER_EMAIL || "integration@jurist3.local",
    };
  }

  const db = await ensureDb();
  const result = await db.query(
    `SELECT users.id, users.email
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1 AND sessions.expires_at > now()`,
    [sessionId],
  );
  if ((result.rowCount ?? 0) === 0) {
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
  if ((result.rowCount ?? 0) === 0) {
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
  if ((result.rowCount ?? 0) > 0) {
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
