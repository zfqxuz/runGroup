import { Suspense } from "react";
import type { Metadata } from "next";
import ScrollRestoration from "@/components/layout/ScrollRestoration";
import SiteHeader from "@/components/layout/SiteHeader";
import { auth } from "@/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "东方 TRPG 平台",
  description: "东方 Project 线上跑团平台"
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
    <html lang="zh-CN" data-theme="night" suppressHydrationWarning>
      <head>
        {/* 在首屏绘制前应用已保存的主题，避免闪烁。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('ui-theme');if(t==='day'||t==='night'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();"
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <Suspense fallback={null}>
          <ScrollRestoration />
        </Suspense>
        {user === null ? null : <SiteHeader user={user} />}
        {children}
      </body>
    </html>
  );
}
