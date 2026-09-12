"use client";

import Link from "next/link";
import { useState } from "react";
import type { RoomMemberView, TradeOfferSummary } from "@/shared/socket";
import { setStatsPublicAction } from "@/server/actions/room";
import { shareClueWithMemberAction } from "@/server/actions/room-info";
import { createTradeOfferAction, respondTradeOfferAction } from "@/server/actions/trade";

export interface RosterCardOption {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface RosterClueOption {
  readonly id: string;
  readonly title: string;
  readonly isPublic: boolean;
}

interface Props {
  readonly roomId: string;
  readonly currentUserId: string;
  readonly isKP: boolean;
  readonly roomStatus: string;
  readonly characterVisibility: string;
  readonly allowPlayerCombatRequest: boolean;
  readonly activeCombatId: string | null;
  readonly members: readonly RoomMemberView[];
  readonly tradeCards: readonly RosterCardOption[];
  readonly shareableClues: readonly RosterClueOption[];
  readonly trades: readonly TradeOfferSummary[];
  readonly onWhisper: (userId: string) => void;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量",
  con: "体质",
  siz: "体型",
  dex: "敏捷",
  app: "外貌",
  int: "智力",
  pow: "意志",
  edu: "教育",
  luck: "幸运"
};

const SKILL_LABELS: Record<string, string> = {
  dodge: "闪避",
  "spot-hidden": "侦查",
  listen: "聆听",
  library: "图书馆",
  psychology: "心理学",
  occult: "神秘学",
  fighting: "格斗",
  shooting: "射击",
  medicine: "医学",
  persuade: "说服",
  "credit-rating": "信用",
  stealth: "潜行"
};

function numberText(value: number | null): string {
  return value === null || value === undefined ? "？？？" : String(value);
}

function resourceText(key: "hp" | "mp" | "san", character: NonNullable<RoomMemberView["character"]>): string {
  const current = character[key];
  const max = key === "hp" ? character.maxHp : key === "mp" ? character.maxMp : character.maxSan;
  return numberText(current) + " / " + numberText(max);
}

function Avatar(props: { readonly url: string | null; readonly name: string; readonly size: "sm" | "lg" }) {
  const sizeClass = props.size === "sm" ? "h-9 w-9 text-xs" : "h-20 w-16 text-2xl";
  if (props.url !== null && props.url.length > 0) {
    return (
      <img
        src={props.url}
        alt=""
        className={sizeClass + " shrink-0 rounded-lg border border-white/15 object-cover"}
      />
    );
  }
  return (
    <span className={sizeClass + " flex shrink-0 items-center justify-center rounded-lg border border-white/15 bg-ink-900 font-medium text-white/45"}>
      {props.name.slice(0, 1)}
    </span>
  );
}

/** 房间成员名册：头像、悬浮信息预览、战斗 / 交易 / 情报快捷入口。 */
export default function RoomMemberRoster(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  const incoming = props.trades.filter((trade) => trade.direction === "INCOMING");
  const outgoing = props.trades.filter((trade) => trade.direction === "OUTGOING");
  const actionsEnabled = props.roomStatus !== "ENDED" && props.roomStatus !== "LOBBY";

  return (
    <aside id="room-members" className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
      <h2 className="text-sm font-medium text-white/80">房间成员（{props.members.length}）</h2>

      <ul className="mt-3 space-y-1.5">
        {props.members.map((member) => {
          const isSelf = member.userId === props.currentUserId;
          const character = member.character;
          const panelOpen = openId === member.userId;
          return (
            <li
              key={member.userId}
              className="group rounded-lg border border-transparent px-1.5 py-1.5 transition hover:border-white/10 hover:bg-ink-900/50"
              onClick={(event) => {
                event.stopPropagation();
                setOpenId(panelOpen ? null : member.userId);
              }}
            >
              <div className="flex items-center gap-2.5">
                <Avatar url={member.avatarUrl} name={member.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/80">
                    {member.displayName}
                    {isSelf ? <span className="ml-1 text-[10px] text-white/35">（我）</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-white/35">
                    {member.role}
                    {character === null ? " · 未提交角色" : " · " + character.name}
                    {character !== null && character.statsHidden ? " · ？？？" : ""}
                  </p>
                </div>
                {member.role === "KP" ? (
                  <span className="shrink-0 rounded-full border border-sakura-500/40 px-1.5 py-0.5 text-[9px] text-sakura-300">
                    KP
                  </span>
                ) : null}
              </div>

              <div
                className={
                  "mt-2 rounded-lg border border-white/10 bg-ink-900/70 p-3 " +
                  (panelOpen ? "block" : "hidden group-hover:block")
                }
                onClick={(event) => event.stopPropagation()}
              >
                {character === null ? (
                  <p className="text-[11px] text-white/40">该成员还没有选择入场角色。</p>
                ) : (
                  <>
                    <div className="flex items-start gap-2.5">
                      <Avatar url={character.portraitUrl ?? member.avatarUrl} name={character.name} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white/85">{character.name}</p>
                        <p className="mt-0.5 truncate text-[10px] text-white/40">
                          {character.occupation ?? "职业未填写"}
                        </p>
                        <div className="mt-2 space-y-1 font-mono text-[11px] text-white/60">
                          <p>HP {resourceText("hp", character)}</p>
                          <p>MP {resourceText("mp", character)}</p>
                          <p>SAN {resourceText("san", character)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      {Object.entries(character.attributes).map(([key, value]) => (
                        <div key={key} className="rounded border border-white/10 bg-ink-800/60 px-1.5 py-1">
                          <p className="text-[9px] text-white/35">{ATTRIBUTE_LABELS[key] ?? key}</p>
                          <p className="font-mono text-[11px] text-white/70">{numberText(value)}</p>
                        </div>
                      ))}
                    </div>

                    {character.skills.length === 0 ? (
                      <p className="mt-2 text-[10px] text-white/30">暂无公开技能数值。</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {character.skills.slice(0, 8).map((skill) => (
                          <span key={skill.id} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                            {SKILL_LABELS[skill.id] ?? skill.id} {numberText(skill.value)}
                          </span>
                        ))}
                      </div>
                    )}

                    {isSelf ? (
                      <form action={setStatsPublicAction} className="mt-3 border-t border-white/10 pt-2">
                        <input type="hidden" name="roomId" value={props.roomId} />
                        <input type="hidden" name="enabled" value={character.statsPublic ? "0" : "1"} />
                        <button
                          type="submit"
                          className={
                            "rounded border px-2 py-1 text-[10px] transition " +
                            (character.statsPublic
                              ? "border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
                              : "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10")
                          }
                        >
                          {character.statsPublic ? "改为仅自己可见" : "公开我的角色信息"}
                        </button>
                        <span className="ml-2 text-[10px] text-white/35">
                          {character.statsPublic ? "其他人可见精确数值" : "其他人看到 ？？？"}
                        </span>
                      </form>
                    ) : null}
                  </>
                )}

                {isSelf || actionsEnabled === false ? null : (
                  <div className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => props.onWhisper(member.userId)}
                        className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/55 transition hover:border-spirit-400/50 hover:text-spirit-300"
                      >
                        私聊
                      </button>
                    </div>
                    <details className="rounded border border-white/10 bg-ink-800/40 px-2 py-1">
                      <summary className="cursor-pointer text-[10px] text-emerald-300">交换物品</summary>
                      {props.tradeCards.length === 0 ? (
                        <p className="mt-1.5 text-[10px] text-amber-200/80">当前角色没有可交易的物品卡。</p>
                      ) : (
                        <form action={createTradeOfferAction} className="mt-1.5 flex flex-col gap-1.5">
                          <input type="hidden" name="roomId" value={props.roomId} />
                          <input type="hidden" name="toUserId" value={member.userId} />
                          <select name="cardId" className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-[11px] text-white/75 outline-none">
                            {props.tradeCards.map((card) => (
                              <option key={card.id} value={card.id}>
                                {card.name}（{card.type}）
                              </option>
                            ))}
                          </select>
                          <input
                            name="note"
                            placeholder="交易留言（可选）"
                            className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-[11px] text-white/75 outline-none"
                          />
                          <button type="submit" className="self-start rounded bg-emerald-400 px-2 py-1 text-[10px] font-medium text-ink-900">
                            发出交易
                          </button>
                        </form>
                      )}
                    </details>
                    <details className="rounded border border-white/10 bg-ink-800/40 px-2 py-1">
                      <summary className="cursor-pointer text-[10px] text-spirit-300">分享情报</summary>
                      {props.shareableClues.length === 0 ? (
                        <p className="mt-1.5 text-[10px] text-white/40">你目前没有可分享的线索。</p>
                      ) : (
                        <form action={shareClueWithMemberAction} className="mt-1.5 flex flex-col gap-1.5">
                          <input type="hidden" name="roomId" value={props.roomId} />
                          <input type="hidden" name="targetUserId" value={member.userId} />
                          <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=shared#room-info"} />
                          <select name="clueId" className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-[11px] text-white/75 outline-none">
                            {props.shareableClues.map((clue) => (
                              <option key={clue.id} value={clue.id}>
                                {clue.title}（{clue.isPublic ? "公开" : "仅我可见"}）
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="self-start rounded bg-sakura-500 px-2 py-1 text-[10px] font-medium text-ink-900">
                            发送情报
                          </button>
                        </form>
                      )}
                    </details>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {incoming.length === 0 && outgoing.length === 0 ? null : (
        <div className="mt-4 border-t border-white/10 pt-3">
          <h3 className="text-xs font-medium text-white/70">物品交易</h3>
          <ul className="mt-2 space-y-2">
            {incoming.map((trade) => (
              <li key={trade.id} className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-2">
                <p className="text-[11px] text-white/70">
                  <span className="text-emerald-300">{trade.counterpartName}</span> 想和你交换「{trade.cardName}」
                </p>
                {trade.note === null ? null : <p className="mt-0.5 text-[10px] text-white/40">留言：{trade.note}</p>}
                <div className="mt-2 flex gap-1.5">
                  <form action={respondTradeOfferAction}>
                    <input type="hidden" name="offerId" value={trade.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <button type="submit" className="rounded bg-emerald-400 px-2 py-1 text-[10px] font-medium text-ink-900">
                      接受
                    </button>
                  </form>
                  <form action={respondTradeOfferAction}>
                    <input type="hidden" name="offerId" value={trade.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <button type="submit" className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/55">
                      拒绝
                    </button>
                  </form>
                </div>
              </li>
            ))}
            {outgoing.map((trade) => (
              <li key={trade.id} className="rounded-lg border border-white/10 bg-ink-900/50 px-2.5 py-2">
                <p className="text-[11px] text-white/55">
                  已向 <span className="text-white/75">{trade.counterpartName}</span> 发出「{trade.cardName}」交易请求
                </p>
                <form action={respondTradeOfferAction} className="mt-2">
                  <input type="hidden" name="offerId" value={trade.id} />
                  <input type="hidden" name="decision" value="cancel" />
                  <button type="submit" className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/45">
                    取消
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

    </aside>
  );
}
