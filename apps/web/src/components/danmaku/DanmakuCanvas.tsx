"use client";

import { useEffect, useRef } from "react";
import type { DanmakuPattern } from "@/shared/danmaku/schema";
import { DanmakuRunner } from "@/shared/danmaku/engine";
import { fallbackDanmakuPattern } from "@/shared/danmaku/presets";
import { drawDanmakuFrame, DEFAULT_DANMAKU_THEME } from "./render";

interface Props {
  readonly pattern: DanmakuPattern | null;
  readonly mode?: "loop" | "once";
  readonly playing?: boolean;
  readonly className?: string;
  readonly onDone?: () => void;
}

const FRAME_MS = 1000 / 60;

/**
 * 纯视觉弹幕画布。
 *
 * 只读取 pattern 并运行本地模拟，不参与战斗判定，也不与服务器同步每颗子弹。
 */
export default function DanmakuCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDoneRef = useRef<Props["onDone"]>(props.onDone);
  onDoneRef.current = props.onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const source = props.pattern ?? fallbackDanmakuPattern("idle");
    const runner = new DanmakuRunner(source, {
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight)
    });
    if (props.pattern === null) runner.stopSpawning();
    if (props.playing === false) runner.stopSpawning();

    let disposed = false;
    let done = false;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;

    const applyViewport = (): void => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      runner.setViewport(width, height);
    };

    applyViewport();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => applyViewport());
    observer?.observe(canvas);
    window.addEventListener("resize", applyViewport);

    const step = (now: number): void => {
      if (disposed) return;
      const dt = Math.min(3, Math.max(0, (now - last) / FRAME_MS));
      last = now;

      if (props.playing !== false) {
        runner.update(dt);
        elapsed += dt;
      }

      if (props.mode === "once" && done === false) {
        if (elapsed > 150) runner.stopSpawning();
        if ((runner.isIdle() && elapsed > 170) || elapsed > 480) {
          done = true;
          onDoneRef.current?.();
          return;
        }
      }

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      drawDanmakuFrame(context, runner, width, height, DEFAULT_DANMAKU_THEME);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", applyViewport);
    };
  }, [props.pattern, props.mode, props.playing]);

  return <canvas ref={canvasRef} className={"block " + (props.className ?? "h-full w-full")} aria-hidden="true" />;
}
