import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-only-insecure-secret";

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/**
 * 一次性 Socket 票据。
 *
 * 为什么不直接在握手时解 NextAuth 的 cookie：那是 JWE 加密串，
 * 解密逻辑属于 NextAuth 内部实现，版本升级就会断。
 * 改由 HTTP 路由（那里 auth() 天然可用）签发一张 60 秒有效的 HMAC 票据，
 * Socket 侧只做 HMAC 校验 —— 两端都在我们控制之下。
 */
export function issueTicket(userId: string, ttlMs = 60_000): string {
  const expires = Date.now() + ttlMs;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyTicket(ticket: unknown): string | null {
  if (typeof ticket !== "string") return null;

  const parts = ticket.split(".");
  if (parts.length !== 3) return null;

  const userId = parts[0] as string;
  const expiresRaw = parts[1] as string;
  const signature = parts[2] as string;

  const expected = sign(`${userId}.${expiresRaw}`);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length) return null;
  if (timingSafeEqual(provided, computed) === false) return null;

  const expires = Number(expiresRaw);
  if (Number.isFinite(expires) === false) return null;
  if (expires < Date.now()) return null;

  return userId;
}
