import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./db/prisma";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const { handlers, auth, signIn, signOut } = NextAuth({
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
