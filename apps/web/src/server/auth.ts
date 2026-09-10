import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./db/prisma";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const nextAuth = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "账号密码",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" }
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (parsed.success === false) return null;

        const user = await prisma.user.findUnique({
          where: { username: parsed.data.username }
        });
        if (user === null) return null;

        const matched = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (matched === false) return null;

        return {
          id: user.id,
          name: user.displayName ?? user.username,
          email: user.email ?? undefined
        };
      }
    })
  ],
  callbacks: {
    session({ session, token }) {
      if (typeof token.sub === "string") {
        session.user.id = token.sub;
      }
      return session;
    }
  }
});
export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;

export async function auth(): Promise<import("next-auth").Session | null> {
  const session = await nextAuth.auth();
  if (session === null) return null;
  const userId = session.user.id;
  if (typeof userId === "string" && userId.length > 0) {
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (exists === null) return null;
    return session;
  }
  return null;
}
