import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      avatarUrl: string | null;
    } & DefaultSession["user"];
  }
}
