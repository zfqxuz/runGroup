import type { Metadata } from "next";
import SiteHeader from "@/components/layout/SiteHeader";
import { auth } from "@/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "东方 TRPG 平台",
  description: "COC7 兼容的东方 Project 线上跑团平台"
};

export default async function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const user =
    session === null
      ? null
      : {
          username: session.user.username,
          displayName: session.user.name ?? session.user.username,
          avatarUrl: session.user.avatarUrl,
          isAdmin: session.user.role === "ADMIN"
        };

  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        {user === null ? null : <SiteHeader user={user} />}
        {children}
      </body>
    </html>
  );
}
