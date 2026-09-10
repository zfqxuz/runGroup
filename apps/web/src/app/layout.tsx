import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "东方 TRPG 平台",
  description: "COC7 兼容的东方 Project 线上跑团平台"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
