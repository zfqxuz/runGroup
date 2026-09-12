"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const STORAGE_PREFIX = "touhou:scroll:";
const memory = new Map<string, number>();

function readSaved(key: string): number | null {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: number): void {
  const rounded = Math.max(0, Math.round(value));
  memory.set(key, rounded);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, String(rounded));
  } catch {
    // sessionStorage 不可用时只保留内存记录。
  }
}

/**
 * 记住每个路径的窗口滚动位置。
 *
 * 解决的问题：Server Action 里 `redirect()` 会被 App Router 当成一次导航，
 * 默认把页面滚回顶部（例如保存局内状态、切换场景之后）。
 * 这里在导航/刷新后把位置恢复回来，同时不影响首次访问的新页面。
 */
export default function ScrollRestoration(): null {
  const pathname = usePathname();
  const searchKey = useSearchParams().toString();
  const restoreToken = useRef(0);

  // 持续记录当前路径的滚动位置。
  useEffect(() => {
    const key = pathname;
    let frame = 0;
    let lastSaved = -1;
    let lastGestureAt = 0;
    const markScrollGesture = (): void => {
      lastGestureAt = Date.now();
    };

    const persist = (immediate: boolean): void => {
      const value = Math.max(0, Math.round(window.scrollY));
      if (value === lastSaved) return;
      // App Router 在 Server Action redirect 后会程序化滚回顶部；
      // 这不是用户意图，不能用它覆盖掉已经记录的位置。
      // 只有 400ms 内发生过滚轮 / 触摸 / 键盘滚动时，才认为 0 是用户主动滚到顶部。
      if (value === 0 && lastSaved > 0 && Date.now() - lastGestureAt > 400) return;
      if (immediate === false) {
        if (frame !== 0) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          lastSaved = value;
          writeSaved(key, value);
        });
        return;
      }
      lastSaved = value;
      writeSaved(key, value);
    };

    const onScroll = (): void => persist(false);
    const onPageHide = (): void => persist(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    window.addEventListener("wheel", markScrollGesture, { passive: true });
    window.addEventListener("touchstart", markScrollGesture, { passive: true });
    window.addEventListener("keydown", markScrollGesture);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      window.removeEventListener("wheel", markScrollGesture);
      window.removeEventListener("touchstart", markScrollGesture);
      window.removeEventListener("keydown", markScrollGesture);
    };
  }, [pathname]);

  // 挂载 / 同路径查询变化（Server Action redirect）后恢复位置。
  useEffect(() => {
    const saved = readSaved(pathname);
    if (saved === null || saved <= 0) return;

    const token = restoreToken.current + 1;
    restoreToken.current = token;
    let cancelled = false;
    const deadline = Date.now() + 1500;

    const interrupt = (): void => {
      cancelled = true;
    };
    window.addEventListener("wheel", interrupt, { passive: true, once: true });
    window.addEventListener("touchstart", interrupt, { passive: true, once: true });
    window.addEventListener("keydown", interrupt, { once: true });

    const attempt = (): void => {
      if (cancelled || restoreToken.current !== token || Date.now() > deadline) return;
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (maxY <= 0) {
        window.setTimeout(attempt, 60);
        return;
      }
      const target = Math.min(saved, maxY);
      const delta = Math.abs(window.scrollY - target);
      if (delta > 1) window.scrollTo(0, target);
      // 继续观察到 deadline，防止 Next 的 scroll-to-top 在稍后执行把位置顶掉。
      window.setTimeout(attempt, delta > 1 ? 30 : 120);
    };

    // 先同步尝试一次；Next 的 scroll-to-top 更晚执行时，
    // attempt 内部的循环会继续把位置覆盖回来。
    attempt();
    const timer = window.setTimeout(attempt, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("keydown", interrupt);
    };
  }, [pathname, searchKey]);

  return null;
}
