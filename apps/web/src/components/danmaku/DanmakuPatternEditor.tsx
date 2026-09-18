"use client";

import { useEffect, useMemo, useState } from "react";
import DanmakuCanvas from "./DanmakuCanvas";
import {
  DANMAKU_LAYER_DESCRIPTIONS,
  DANMAKU_LAYER_LABELS,
  DANMAKU_PRESET_TYPES,
  createDanmakuLayer,
  patternLayerSummary,
  reseedDanmakuPattern
} from "@/shared/danmaku/presets";
import {
  DANMAKU_BULLET_SHAPES,
  DANMAKU_COLORS,
  DANMAKU_LAYER_TYPES,
  type DanmakuLayer,
  type DanmakuLayerType,
  type DanmakuPattern
} from "@/shared/danmaku/schema";
import { DANMAKU_SHAPE_LABELS } from "@/shared/danmaku/presets";

interface Props {
  readonly value: DanmakuPattern;
  readonly onChange: (value: DanmakuPattern) => void;
}

const fieldClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-2.5 py-1.5 text-xs text-white/80 outline-none focus:border-sakura-500";
const labelClass = "flex flex-col gap-1 text-[11px] text-white/45";

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isFinite(value) === false) return min;
  return Math.max(min, Math.min(max, value));
}

export default function DanmakuPatternEditor(props: Props) {
  const { value, onChange } = props;
  const [selected, setSelected] = useState(0);
  const selectedLayer = value.layers[selected] ?? value.layers[0];
  const previewKey = useMemo(() => JSON.stringify(value), [value]);

  useEffect(() => {
    if (selected >= value.layers.length) setSelected(Math.max(0, value.layers.length - 1));
  }, [selected, value.layers.length]);

  function updateLayer(index: number, patch: Partial<DanmakuLayer>): void {
    onChange({
      ...value,
      layers: value.layers.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, ...patch } : layer
      )
    });
  }

  function addLayer(type: DanmakuLayerType): void {
    if (value.layers.length >= 3) return;
    const layer = createDanmakuLayer(type);
    onChange({ ...value, layers: [...value.layers, layer] });
    setSelected(value.layers.length);
  }

  function removeLayer(index: number): void {
    if (value.layers.length <= 1) return;
    onChange({ ...value, layers: value.layers.filter((_, layerIndex) => layerIndex !== index) });
    setSelected((current) => Math.max(0, Math.min(current, value.layers.length - 2)));
  }

  function changeLayerType(index: number, type: DanmakuLayerType): void {
    const current = value.layers[index];
    if (current === undefined) return;
    updateLayer(index, { ...createDanmakuLayer(type), id: current.id });
  }

  return (
    <section className="rounded-xl border border-sakura-500/25 bg-sakura-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-sakura-300">弹幕演出</h3>
          <p className="mt-0.5 text-[11px] text-white/40">
            仅视觉效果，不影响战斗判定。展开型循环播放至击破，消费型播放一次。
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(reseedDanmakuPattern(value))}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-white/55 transition hover:border-white/35 hover:text-white/80"
        >
          换一组随机种子
        </button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-ink-900">
            <DanmakuCanvas
              key={previewKey}
              pattern={value}
              mode="loop"
              className="block h-52 w-full sm:h-64"
            />
            <span className="pointer-events-none absolute left-2 top-2 rounded border border-white/15 bg-ink-900/70 px-1.5 py-0.5 text-[10px] text-white/45">
              预览
            </span>
          </div>

          <div>
            <p className="text-[11px] text-white/45">添加图层（最多 3 层）</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {DANMAKU_PRESET_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={value.layers.length >= 3}
                  onClick={() => addLayer(type)}
                  title={DANMAKU_LAYER_DESCRIPTIONS[type]}
                  className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-white/65 transition hover:border-sakura-500/50 hover:text-sakura-300 disabled:opacity-35"
                >
                  {DANMAKU_LAYER_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-white/45">当前图层</p>
            {value.layers.map((layer, index) => (
              <div
                key={layer.id}
                className={
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition " +
                  (index === selected
                    ? "border-sakura-500/50 bg-sakura-500/10 text-sakura-200"
                    : "border-white/10 bg-ink-900/50 text-white/60")
                }
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setSelected(index)}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className="truncate">
                    {index + 1}. {DANMAKU_LAYER_LABELS[layer.type]} · {patternLayerSummary(layer)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={value.layers.length <= 1}
                  onClick={() => removeLayer(index)}
                  className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition hover:border-red-400/50 hover:text-red-300 disabled:opacity-30"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-900/60 p-3">
          {selectedLayer === undefined ? null : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-white/70">
                参数 · {DANMAKU_LAYER_LABELS[selectedLayer.type]}
              </p>

              <label className={labelClass}>
                <span>图案类型</span>
                <select
                  value={selectedLayer.type}
                  onChange={(event) => changeLayerType(selected, event.target.value as DanmakuLayerType)}
                  className={fieldClass}
                >
                  {DANMAKU_LAYER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DANMAKU_LAYER_LABELS[type]}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-white/30">{DANMAKU_LAYER_DESCRIPTIONS[selectedLayer.type]}</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className={labelClass}>
                  <span>弹数</span>
                  <input
                    type="number"
                    min={1}
                    max={48}
                    value={selectedLayer.count}
                    onChange={(event) =>
                      updateLayer(selected, { count: clampNumber(Math.round(Number(event.target.value)), 1, 48) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>间隔（帧）</span>
                  <input
                    type="number"
                    min={2}
                    max={180}
                    value={selectedLayer.interval}
                    onChange={(event) =>
                      updateLayer(selected, { interval: clampNumber(Math.round(Number(event.target.value)), 2, 180) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>速度</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0.2}
                    max={14}
                    value={selectedLayer.speed}
                    onChange={(event) =>
                      updateLayer(selected, { speed: clampNumber(Number(event.target.value), 0.2, 14) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>大小</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0.4}
                    max={3}
                    value={selectedLayer.size}
                    onChange={(event) =>
                      updateLayer(selected, { size: clampNumber(Number(event.target.value), 0.4, 3) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>角度（-180~180）</span>
                  <input
                    type="number"
                    min={-180}
                    max={180}
                    value={selectedLayer.angle}
                    onChange={(event) =>
                      updateLayer(selected, { angle: clampNumber(Math.round(Number(event.target.value)), -180, 180) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>张角（0~360）</span>
                  <input
                    type="number"
                    min={0}
                    max={360}
                    value={selectedLayer.spread}
                    onChange={(event) =>
                      updateLayer(selected, { spread: clampNumber(Math.round(Number(event.target.value)), 0, 360) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>旋转（每轮角度）</span>
                  <input
                    type="number"
                    step={0.5}
                    min={-30}
                    max={30}
                    value={selectedLayer.rotation}
                    onChange={(event) =>
                      updateLayer(selected, { rotation: clampNumber(Number(event.target.value), -30, 30) })
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  <span>颜色</span>
                  <select
                    value={selectedLayer.color}
                    onChange={(event) => updateLayer(selected, { color: event.target.value })}
                    className={fieldClass}
                  >
                    {DANMAKU_COLORS.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className={labelClass}>
                <span>弹形</span>
                <select
                  value={selectedLayer.shape}
                  onChange={(event) =>
                    updateLayer(selected, { shape: event.target.value as DanmakuLayer["shape"] })
                  }
                  className={fieldClass}
                >
                  {DANMAKU_BULLET_SHAPES.map((shape) => (
                    <option key={shape} value={shape}>
                      {DANMAKU_SHAPE_LABELS[shape]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-[11px] text-white/55">
                <input
                  type="checkbox"
                  checked={selectedLayer.glow}
                  onChange={(event) => updateLayer(selected, { glow: event.target.checked })}
                  className="h-3.5 w-3.5 accent-sakura-500"
                />
                加色发光（更华丽，弹幕多时可能不流畅）
              </label>

              <details className="rounded-lg border border-white/10 bg-ink-900/40 p-2">
                <summary className="cursor-pointer text-[11px] text-white/45">高级参数</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className={labelClass}>
                    <span>加速度</span>
                    <input
                      type="number"
                      step={0.02}
                      min={-0.4}
                      max={0.4}
                      value={selectedLayer.accel}
                      onChange={(event) =>
                        updateLayer(selected, { accel: clampNumber(Number(event.target.value), -0.4, 0.4) })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className={labelClass}>
                    <span>角速度（弯曲）</span>
                    <input
                      type="number"
                      step={0.1}
                      min={-10}
                      max={10}
                      value={selectedLayer.curve}
                      onChange={(event) =>
                        updateLayer(selected, { curve: clampNumber(Number(event.target.value), -10, 10) })
                      }
                      className={fieldClass}
                    />
                  </label>
                </div>
              </details>

              {selectedLayer.type === "laser" ? (
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-ink-900/40 p-2">
                  <label className={labelClass}>
                    <span>激光宽度</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={selectedLayer.laserWidth ?? 9}
                      onChange={(event) =>
                        updateLayer(selected, { laserWidth: clampNumber(Math.round(Number(event.target.value)), 1, 60) })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className={labelClass}>
                    <span>预警帧</span>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={selectedLayer.laserTelegraph ?? 26}
                      onChange={(event) =>
                        updateLayer(selected, {
                          laserTelegraph: clampNumber(Math.round(Number(event.target.value)), 0, 120)
                        })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className={labelClass}>
                    <span>存在帧</span>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={selectedLayer.laserLife ?? 34}
                      onChange={(event) =>
                        updateLayer(selected, {
                          laserLife: clampNumber(Math.round(Number(event.target.value)), 5, 180)
                        })
                      }
                      className={fieldClass}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
