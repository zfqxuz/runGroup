"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

export interface KpDrawerSectionProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly badge?: ReactNode;
  /** 首次出现 / 徽标变化时自动滑出该抽屉。 */
  readonly autoOpen?: boolean;
  readonly children: ReactNode;
}

/**
 * 只是抽屉内容的容器；实际渲染由 KpDrawer 控制。
 * 保留成组件是为了让服务端页面用 JSX 嵌套写法组织各个操作区。
 */
export function KpDrawerSection({ children }: KpDrawerSectionProps): ReactNode {
  return <>{children}</>;
}

interface KpDrawerProps {
  readonly title?: string;
  readonly children: ReactNode;
}

export default function KpDrawer({ title = "KP 准备区", children }: KpDrawerProps) {
  const sections = useMemo(
    () =>
      Children.toArray(children).filter(
        (child): child is ReactElement<KpDrawerSectionProps> =>
          isValidElement(child) &&
          typeof (child.props as { readonly id?: unknown }).id === "string"
      ),
    [children]
  );
  const autoSection = sections.find((section) => section.props.autoOpen === true) ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = sections.find((section) => section.props.id === activeId) ?? null;

  // 关闭动画期间保留最后一份内容，避免抽屉滑出时变空白。
  const lastActiveRef = useRef<ReactElement<KpDrawerSectionProps> | null>(null);
  if (active !== null) lastActiveRef.current = active;

  // 抽屉必须挂在 document.body 上：侧栏是 sticky 定位会形成 stacking context，
  // 留在里面会被右侧地图 / 日志压住。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (autoSection !== null) setActiveId(autoSection.props.id);
  }, [autoSection?.props.id, autoSection?.props.badge]);

  const shown = active ?? lastActiveRef.current;

  const overlay = (
    <div
      data-kp-drawer-overlay
      aria-hidden={active === null}
      className={"fixed inset-0 z-[100] " + (active === null ? "pointer-events-none" : "pointer-events-auto")}
    >
      <button
        type="button"
        aria-label="关闭抽屉"
        onClick={() => setActiveId(null)}
        className={
          "absolute inset-0 bg-black/50 transition-opacity duration-300 " +
          (active === null ? "opacity-0" : "opacity-100")
        }
      />
      <aside
        className={
          "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-white/10 bg-ink-900 shadow-2xl transition-transform duration-300 " +
          (active === null ? "translate-x-full" : "translate-x-0")
        }
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-white/85">{shown?.props.label ?? title}</h2>
            {shown?.props.description === undefined ? null : (
              <p className="mt-0.5 text-[11px] text-white/40">{shown.props.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/35 hover:text-white"
          >
            关闭
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {shown?.props.children ?? null}
        </div>
      </aside>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-white/10 bg-ink-800/40 p-2 lg:sticky lg:top-20 lg:z-[60]">
        <p className="px-2 py-1 text-[11px] font-medium text-sakura-200">{title}</p>
        <nav className="flex flex-col gap-1">
          {sections.map((section) => {
            const selected = section.props.id === activeId;
            return (
              <button
                key={section.props.id}
                type="button"
                onClick={() => setActiveId((current) => (current === section.props.id ? null : section.props.id))}
                className={
                  "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition " +
                  (selected
                    ? "bg-sakura-500/15 text-sakura-100"
                    : "text-white/70 hover:bg-white/5 hover:text-white")
                }
              >
                <span className="min-w-0 truncate font-medium">{section.props.label}</span>
                {section.props.badge === undefined || section.props.badge === null ? null : (
                  <span className="shrink-0 rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-200">
                    {section.props.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {active === null ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-ink-800/30 px-4 py-6 text-center text-xs text-white/35">
          选择一个操作区，右侧滑出对应表单。
        </p>
      ) : null}

      {mounted ? createPortal(overlay, document.body) : null}
    </div>
  );
}
