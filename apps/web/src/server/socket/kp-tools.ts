import type { Server as SocketServer, Socket } from "socket.io";
import { cryptoRng, parseDice, rollDice, rollDie, rollPercentile } from "@touhou/formula";
import {
  makeCondition,
  parseConditions,
  removeConditionById,
  resolveCheck,
  resolveFirstAid,
  resolveMedicine,
  resolveNaturalHealing,
  resolveWeeklyMajorWoundRecovery,
  tickConditions,
  type CheckResult,
  type GameCondition,
  type MedicalOutcome
} from "@touhou/rules";
import type { CombatParticipantState } from "@touhou/combat";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";
import { buildEffectiveSkills } from "@/server/character/skills";
import { loadCombatRuntime, type CombatRuntime } from "@/server/combat/runtime";
import { saveCombatState } from "@/server/combat/setup";
import { broadcastCombat } from "./combat";
import type { DiceRollView, DiceVisibility } from "@/shared/socket";
import { sanitizeSpecialtyCandidates } from "@/shared/specialty";

interface SocketAuth {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
}

type KpUnitRef = { readonly kind: "CHARACTER" | "NPC"; readonly id: string };

export interface KpToolsDeps {
  readonly loadMembership: (
    roomId: string,
    userId: string
  ) => Promise<{ role: string; room: { status: string } } | null>;
  readonly parseKpUnitRef: (value: unknown) => KpUnitRef | null;
  readonly postDice: (input: {
    roomId: string;
    userId: string;
    visibility: DiceVisibility;
    text: string;
    view: DiceRollView;
    results?: Record<string, unknown>;
  }) => Promise<void>;
}

const CORE_CONDITIONS = new Set([
  "MAJOR_WOUND",
  "PRONE",
  "UNCONSCIOUS",
  "DYING",
  "DEAD",
  "INSANITY"
]);

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(number) === false) return undefined;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function unitVisibility(value: unknown): DiceVisibility {
  return value === "DARK" || value === "SECRET" ? value : "PUBLIC";
}

function conditionVisibility(value: unknown): "PUBLIC" | "PARTY" | "KP" {
  return value === "PARTY" || value === "KP" ? value : "PUBLIC";
}

const MEDICAL_LABELS: Record<string, string> = {
  FIRST_AID: "急救",
  MEDICINE: "医学",
  WEEKLY_RECOVERY: "重伤每周恢复",
  NATURAL_HEALING: "自然恢复"
};

const CHECK_LABELS: Record<string, string> = {
  CRITICAL: "大成功",
  EXTREME: "极难成功",
  HARD: "困难成功",
  REGULAR: "常规成功",
  FAIL: "失败",
  FUMBLE: "大失败"
};

function checkLabel(result: CheckResult): string {
  return CHECK_LABELS[result] ?? result;
}

async function loadRoomPack(roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { system: true, rulePackVersionId: true, ruleOverride: true }
  });
  if (room === null) return null;
  return loadEffectivePack({
    id: roomId,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
}

/** 把医疗结果写回局内状态：HP、核心状态与战斗席位。 */
async function persistMedicalOutcome(input: {
  io: SocketServer;
  roomId: string;
  characterId: string;
  gameCharacterId: string;
  hpBefore: number;
  outcome: MedicalOutcome;
  conditions: readonly GameCondition[];
  /** 战斗席位同步时使用；角色不在战斗中会被忽略。 */
  combatUpdate?: (participant: CombatParticipantState) => void;
}): Promise<GameCondition[]> {
  let nextConditions = [...input.conditions];
  const drop = (types: readonly string[]): void => {
    nextConditions = nextConditions.filter((condition) => types.includes(condition.type) === false);
  };
  if (input.outcome.clearsUnconscious) {
    drop(["UNCONSCIOUS"]);
  }
  if (input.outcome.hpAfter > 0) {
    drop(["DYING", "UNCONSCIOUS"]);
  }
  if (input.outcome.clearsMajorWound) {
    drop(["MAJOR_WOUND", "PRONE"]);
  }

  const status = input.outcome.hpAfter > 0 ? "ALIVE" : "ALIVE";
  await prisma.$transaction([
    prisma.gameCharacter.update({
      where: { id: input.gameCharacterId },
      data: { currentHp: input.outcome.hpAfter, conditions: nextConditions as never, status }
    }),
    prisma.character.update({
      where: { id: input.characterId },
      data: { hp: input.outcome.hpAfter }
    })
  ]);

  await forEachCombatParticipant(input.io, input.roomId, { kind: "CHARACTER", id: input.characterId }, (participant) => {
    participant.hp = input.outcome.hpAfter;
    participant.vars.hp = input.outcome.hpAfter;
    if (input.outcome.clearsMajorWound) participant.majorWound = false;
    if (input.outcome.hpAfter > 0) {
      participant.dying = false;
      participant.unconscious = false;
      participant.defeated = false;
    }
    participant.conditions = nextConditions;
    input.combatUpdate?.(participant);
  });
  return nextConditions;
}

/** 房间内任意一场进行中的战斗里，按单位引用找到席位并执行修改。 */
async function forEachCombatParticipant(
  io: SocketServer,
  roomId: string,
  unit: KpUnitRef,
  update: (participant: CombatParticipantState) => void
): Promise<boolean> {
  const combats = await prisma.combat.findMany({
    where: { roomId, endedAt: null },
    orderBy: { startedAt: "asc" },
    select: { id: true }
  });
  let changed = false;
  for (const combat of combats) {
    const runtime = await loadCombatRuntime(combat.id);
    if (runtime === null) continue;
    const participant =
      unit.kind === "CHARACTER"
        ? runtime.state.participants.find((item) => item.characterId === unit.id)
        : runtime.state.participants.find((item) => item.id === unit.id);
    if (participant === undefined) continue;
    update(participant);
    await saveCombatState(combat.id, runtime.state);
    await broadcastCombat(io, runtime);
    changed = true;
  }
  return changed;
}

/** 只读查找房间内进行中战斗的席位（用于环境伤害等优先取运行时数值）。 */
async function findCombatParticipant(
  roomId: string,
  unit: KpUnitRef
): Promise<{ readonly runtime: CombatRuntime; readonly participant: CombatParticipantState } | null> {
  const combats = await prisma.combat.findMany({
    where: { roomId, endedAt: null },
    orderBy: { startedAt: "asc" },
    select: { id: true }
  });
  for (const combat of combats) {
    const runtime = await loadCombatRuntime(combat.id);
    if (runtime === null) continue;
    const participant =
      unit.kind === "CHARACTER"
        ? runtime.state.participants.find((item) => item.characterId === unit.id)
        : runtime.state.participants.find((item) => item.id === unit.id);
    if (participant !== undefined) return { runtime, participant };
  }
  return null;
}

/** 环境伤害 / 持续伤害的即时结算：直接套用 COC7 重伤、昏迷、濒死、死亡判定。 */
function applyBodyDamage(input: {
  readonly hp: number;
  readonly maxHp: number;
  readonly con: number;
  readonly conditions: readonly GameCondition[];
  readonly damage: number;
  readonly rng: typeof cryptoRng;
}): {
  readonly hp: number;
  readonly conditions: GameCondition[];
  readonly dead: boolean;
  readonly majorWound: boolean;
  readonly dying: boolean;
  readonly unconscious: boolean;
  readonly conRoll: number | null;
  readonly conSuccess: boolean | null;
} {
  const maxHp = Math.max(1, Math.floor(input.maxHp));
  const before = Math.max(0, Math.floor(input.hp));
  const damage = Math.max(0, Math.floor(input.damage));
  let hp = Math.max(0, before - damage);
  let conditions = [...input.conditions];
  const has = (type: string): boolean => conditions.some((condition) => condition.type === type);
  const drop = (types: readonly string[]): void => {
    conditions = conditions.filter((condition) => types.includes(condition.type) === false);
  };
  const add = (type: string, note?: string): void => {
    if (has(type)) return;
    conditions.push(
      makeCondition({ type, unit: "NARRATIVE", remaining: 0, visibility: "PUBLIC", note })
    );
  };

  let majorWound = has("MAJOR_WOUND");
  let dying = has("DYING");
  let unconscious = has("UNCONSCIOUS");
  let dead = has("DEAD");
  let conRoll: number | null = null;
  let conSuccess: boolean | null = null;

  if (damage >= maxHp) {
    hp = 0;
    dead = true;
    majorWound = true;
    dying = false;
    unconscious = true;
    drop(["DYING", "DEAD"]);
    add("MAJOR_WOUND", "单次伤害达到最大生命值");
    add("PRONE");
    add("UNCONSCIOUS");
    add("DEAD", "单次伤害达到最大生命值");
  } else {
    if (has("DEAD")) {
      // 已死亡的角色不再被普通环境伤害“复活”。
      return { hp: 0, conditions, dead: true, majorWound: true, dying: false, unconscious: true, conRoll, conSuccess };
    }
    if (damage >= Math.ceil(maxHp / 2) && damage > 0) {
      majorWound = true;
      add("MAJOR_WOUND", "单次伤害达到重伤阈值");
      add("PRONE");
      conRoll = rollDie(input.rng, 100);
      conSuccess = conRoll <= Math.max(0, Math.floor(input.con));
      if (conSuccess === false) {
        unconscious = true;
        add("UNCONSCIOUS", "重伤后 CON 检定失败");
      }
    }
    if (hp <= 0) {
      hp = 0;
      unconscious = true;
      add("PRONE");
      add("UNCONSCIOUS", "HP 归零");
      if (majorWound) {
        dying = true;
        add("DYING", "重伤且 HP 归零");
      } else {
        dying = false;
        drop(["DYING"]);
      }
    } else {
      dying = false;
      drop(["DYING"]);
      if (unconscious && damage > 0) {
        // 只有本回合由伤害造成的昏迷才会因 HP 回正而解除。
        unconscious = false;
        drop(["UNCONSCIOUS"]);
      }
    }
  }

  return { hp, conditions, dead, majorWound, dying, unconscious, conRoll, conSuccess };
}

function syncCombatFlags(
  participant: CombatParticipantState,
  flags: {
    readonly hp: number;
    readonly conditions: readonly GameCondition[];
    readonly dead: boolean;
    readonly majorWound: boolean;
    readonly dying: boolean;
    readonly unconscious: boolean;
  }
): void {
  participant.hp = flags.hp;
  participant.vars.hp = flags.hp;
  participant.conditions = [...flags.conditions];
  participant.majorWound = flags.majorWound;
  participant.dead = flags.dead;
  if (flags.dead) {
    participant.dying = false;
    participant.unconscious = true;
    participant.prone = true;
    participant.defeated = true;
    participant.isReady = false;
    return;
  }
  participant.dying = flags.dying;
  participant.unconscious = flags.unconscious || flags.hp <= 0;
  participant.defeated = flags.unconscious || flags.hp <= 0;
  if (flags.hp > 0) {
    participant.dying = false;
    participant.unconscious = false;
    participant.defeated = false;
  } else {
    participant.prone = true;
    participant.isReady = false;
  }
}

function appendDotCondition(
  conditions: readonly GameCondition[],
  expression: string,
  damageType: string,
  rounds: number
): GameCondition[] {
  if (rounds <= 0) return [...conditions];
  return [
    ...conditions.filter((condition) => condition.type !== "DOT"),
    makeCondition({
      type: "DOT",
      unit: "ROUND",
      remaining: rounds,
      visibility: "PUBLIC",
      data: { expression, damageType }
    })
  ];
}

export function registerKpTools(
  io: SocketServer,
  socket: Socket,
  me: SocketAuth,
  deps: KpToolsDeps
): void {
  socket.on("room:medical", async (payload: unknown, ack: (result: { ok: boolean; error?: string; note?: string }) => void) => {
    try {
      const input = payload as {
        roomId?: unknown;
        characterId?: unknown;
        action?: unknown;
        hoursSinceInjury?: unknown;
        days?: unknown;
        visibility?: unknown;
      };
      if (
        typeof input?.roomId !== "string" ||
        typeof input.characterId !== "string" ||
        typeof input.action !== "string"
      ) {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const action = input.action;
      if (["FIRST_AID", "MEDICINE", "WEEKLY_RECOVERY", "NATURAL_HEALING"].includes(action) === false) {
        ack({ ok: false, error: "不支持的医疗动作" });
        return;
      }
      const roomId = input.roomId;
      const characterId = input.characterId;
      const membership = await deps.loadMembership(roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }
      if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
        ack({ ok: false, error: "当前房间状态不能进行医疗动作" });
        return;
      }
      const activeGame = await prisma.game.findFirst({
        where: { roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      if (activeGame === null) {
        ack({ ok: false, error: "当前没有进行中的局" });
        return;
      }
      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (character === null) {
        ack({ ok: false, error: "角色不存在" });
        return;
      }
      if (character.userId !== me.userId && membership.role !== "KP") {
        ack({ ok: false, error: "只能为自己的角色进行医疗，或由 KP 操作" });
        return;
      }
      const gameCharacter = await prisma.gameCharacter.findUnique({
        where: { gameId_characterId: { gameId: activeGame.id, characterId } }
      });
      if (gameCharacter === null) {
        ack({ ok: false, error: "该角色不在当前局中" });
        return;
      }
      const pack = await loadRoomPack(roomId);
      if (pack === null) {
        ack({ ok: false, error: "规则包读取失败" });
        return;
      }
      const conditions = parseConditions(gameCharacter.conditions);
      const majorWound = conditions.some((condition) => condition.type === "MAJOR_WOUND");
      const dying = conditions.some((condition) => condition.type === "DYING");
      const hours = finiteNumber(input.hoursSinceInjury, 0, 100000) ?? 0;
      const days = finiteNumber(input.days, 1, 3650) ?? 1;
      const skills = buildEffectiveSkills(pack.compiled, character);

      let outcome: MedicalOutcome;
      let rollLine = "";
      if (action === "NATURAL_HEALING") {
        outcome = resolveNaturalHealing({
          hp: gameCharacter.currentHp,
          maxHp: character.maxHp,
          majorWound,
          days
        });
        rollLine = "经过 " + days + " 天";
      } else {
        const target =
          action === "FIRST_AID"
            ? skills.FIRST_AID ?? 30
            : action === "MEDICINE"
              ? skills.MEDICINE ?? 1
              : character.con;
        const skillLabel =
          action === "FIRST_AID" ? "急救" : action === "MEDICINE" ? "医学" : "CON 重伤恢复";
        const percentile = rollPercentile(cryptoRng, 0, 0);
        const check = resolveCheck(pack.compiled, percentile.roll, target);
        rollLine = "1d100 = " + percentile.roll + " / " + skillLabel + " 目标 " + target + " → " + checkLabel(check.result);
        if (action === "FIRST_AID") {
          outcome = resolveFirstAid({
            hp: gameCharacter.currentHp,
            maxHp: character.maxHp,
            hoursSinceInjury: hours,
            result: check.result
          });
        } else if (action === "MEDICINE") {
          outcome = resolveMedicine({
            hp: gameCharacter.currentHp,
            maxHp: character.maxHp,
            hoursSinceInjury: hours,
            result: check.result,
            dying,
            stabilizedDying: conditions.some((condition) => condition.type === "STABILIZED"),
            rng: cryptoRng
          });
        } else {
          outcome = resolveWeeklyMajorWoundRecovery({
            hp: gameCharacter.currentHp,
            maxHp: character.maxHp,
            majorWound,
            result: check.result,
            rng: cryptoRng
          });
        }
      }

      if (outcome.allowed === false) {
        ack({ ok: false, error: outcome.error ?? "医疗动作无法进行" });
        return;
      }

      const nextConditions = await persistMedicalOutcome({
        io,
        roomId,
        characterId,
        gameCharacterId: gameCharacter.id,
        hpBefore: gameCharacter.currentHp,
        outcome,
        conditions
      });
      const text =
        "【" +
        (MEDICAL_LABELS[action] ?? action) +
        "】" +
        character.name +
        " " +
        rollLine +
        "；" +
        outcome.note +
        "（HP " +
        outcome.hpBefore +
        "→" +
        outcome.hpAfter +
        "）";
      await deps.postDice({
        roomId,
        userId: me.userId,
        visibility: unitVisibility(input.visibility),
        text,
        view: {
          expression: "1d100",
          total: outcome.hpBefore,
          terms: ["HP " + outcome.hpBefore + " → " + outcome.hpAfter, "剩余状态 " + nextConditions.length],
          min: 1,
          max: 100
        },
        results: { kind: "MEDICAL", action, hpBefore: outcome.hpBefore, hpAfter: outcome.hpAfter }
      });
      io.to("room:" + roomId).emit("room:refresh", { roomId, reason: "medical" });
      ack({ ok: true, note: outcome.note });
    } catch (error) {
      console.error("room:medical failed", error);
      ack({ ok: false, error: "医疗动作失败，请重试" });
    }
  });

  socket.on("room:luck-check", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string }) => void) => {
    try {
      const input = payload as {
        roomId?: unknown;
        unitRef?: unknown;
        spendLuck?: unknown;
        reason?: unknown;
        visibility?: unknown;
      };
      if (typeof input?.roomId !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const roomId = input.roomId;
      const unit = deps.parseKpUnitRef(input.unitRef);
      if (unit === null || unit.kind !== "CHARACTER") {
        ack({ ok: false, error: "请选择玩家角色进行幸运检定" });
        return;
      }
      const characterId = unit.id;
      const membership = await deps.loadMembership(roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }
      if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
        ack({ ok: false, error: "当前房间状态不能进行幸运检定" });
        return;
      }
      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (character === null) {
        ack({ ok: false, error: "角色不存在" });
        return;
      }
      if (character.userId !== me.userId && membership.role !== "KP") {
        ack({ ok: false, error: "只能为自己的角色进行幸运检定，或由 KP 操作" });
        return;
      }
      const luck = Math.max(0, character.luck);
      const requestedSpend = finiteNumber(input.spendLuck, 0, luck) ?? 0;
      const percentile = rollPercentile(cryptoRng, 0, 0);
      const roll = percentile.roll;
      const effective = Math.max(1, roll - requestedSpend);
      const success = effective <= luck;
      const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 120) : "";
      const text =
        "【幸运检定】" +
        character.name +
        (reason.length > 0 ? " · " + reason : "") +
        " 1d100 = " +
        roll +
        " / 幸运 " +
        luck +
        " → " +
        (success ? "成功" : "失败") +
        (requestedSpend > 0
          ? "；消耗 " + requestedSpend + " 点幸运，检定值降为 " + effective + "，剩余幸运 " + (luck - requestedSpend)
          : "");
      if (requestedSpend > 0) {
        await prisma.character.update({ where: { id: character.id }, data: { luck: luck - requestedSpend } });
      }
      await deps.postDice({
        roomId,
        userId: me.userId,
        visibility: unitVisibility(input.visibility),
        text,
        view: { expression: "1d100", total: roll, terms: ["1d100[" + roll + "]", "幸运 " + luck], min: 1, max: 100 },
        results: { kind: "LUCK", roll, luck, spend: requestedSpend, success }
      });
      ack({ ok: true, text });
    } catch (error) {
      console.error("room:luck-check failed", error);
      ack({ ok: false, error: "幸运检定失败，请重试" });
    }
  });

  socket.on("room:push-roll", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string }) => void) => {
    try {
      const input = payload as {
        roomId?: unknown;
        characterId?: unknown;
        skillId?: unknown;
        reason?: unknown;
        visibility?: unknown;
      };
      if (
        typeof input?.roomId !== "string" ||
        typeof input.characterId !== "string" ||
        typeof input.skillId !== "string"
      ) {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const roomId = input.roomId;
      const characterId = input.characterId;
      const skillId = input.skillId;
      const membership = await deps.loadMembership(roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }
      if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
        ack({ ok: false, error: "当前房间状态不能进行孤注一掷" });
        return;
      }
      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (character === null) {
        ack({ ok: false, error: "角色不存在" });
        return;
      }
      if (character.userId !== me.userId && membership.role !== "KP") {
        ack({ ok: false, error: "只能为自己的角色孤注一掷，或由 KP 操作" });
        return;
      }
      const pack = await loadRoomPack(roomId);
      if (pack === null) {
        ack({ ok: false, error: "规则包读取失败" });
        return;
      }
      const baseSkillId = skillId.includes("#") ? (skillId.split("#")[0] as string) : skillId;
      const skill =
        pack.compiled.skills.find((item) => item.id === skillId) ??
        pack.compiled.skills.find((item) => item.id === baseSkillId);
      if (skill === undefined) {
        ack({ ok: false, error: "规则包中没有这个技能" });
        return;
      }
      const values = buildEffectiveSkills(pack.compiled, character);
      const target = values[skillId] ?? values[baseSkillId] ?? 0;
      const percentile = rollPercentile(cryptoRng, 0, 0);
      const check = resolveCheck(pack.compiled, percentile.roll, target);
      const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 160) : "";
      const text =
        "【孤注一掷·" +
        skill.name +
        "】" +
        character.name +
        (reason.length > 0 ? " · " + reason : "") +
        " 1d100 = " +
        percentile.roll +
        " / 目标 " +
        target +
        " → " +
        checkLabel(check.result) +
        (check.result === "FAIL" || check.result === "FUMBLE"
          ? "；KP 可结算孤注一掷失败的后果"
          : "");
      await deps.postDice({
        roomId,
        userId: me.userId,
        visibility: unitVisibility(input.visibility),
        text,
        view: { expression: "1d100", total: percentile.roll, terms: ["1d100[" + percentile.roll + "]", "目标 " + target], min: 1, max: 100 },
        results: { kind: "PUSH", skillId, target, result: check.result }
      });
      ack({ ok: true, text });
    } catch (error) {
      console.error("room:push-roll failed", error);
      ack({ ok: false, error: "孤注一掷失败，请重试" });
    }
  });

  socket.on("room:specialty-candidates", async (payload: unknown, ack: (result: { ok: boolean; error?: string; candidates?: ReturnType<typeof sanitizeSpecialtyCandidates> }) => void) => {
    try {
      const input = payload as { roomId?: unknown };
      if (typeof input?.roomId !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const membership = await deps.loadMembership(input.roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }
      const room = await prisma.room.findUnique({
        where: { id: input.roomId },
        select: { ruleOverride: true }
      });
      if (room === null) {
        ack({ ok: false, error: "房间不存在" });
        return;
      }
      const override = recordOf(room.ruleOverride);
      ack({ ok: true, candidates: sanitizeSpecialtyCandidates(override.specialtyCandidates) });
    } catch (error) {
      console.error("room:specialty-candidates failed", error);
      ack({ ok: false, error: "读取专精候选失败，请重试" });
    }
  });

  socket.on("room:specialty-candidates-save", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string; candidates?: ReturnType<typeof sanitizeSpecialtyCandidates> }) => void) => {
    try {
      const input = payload as { roomId?: unknown; candidates?: unknown };
      if (typeof input?.roomId !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const membership = await deps.loadMembership(input.roomId, me.userId);
      if (membership === null || membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 可以编辑专精候选" });
        return;
      }
      const candidates = sanitizeSpecialtyCandidates(input.candidates);
      const room = await prisma.room.findUnique({
        where: { id: input.roomId },
        select: { ruleOverride: true }
      });
      if (room === null) {
        ack({ ok: false, error: "房间不存在" });
        return;
      }
      const override = recordOf(room.ruleOverride);
      await prisma.room.update({
        where: { id: input.roomId },
        data: {
          ruleOverride: {
            ...override,
            specialtyCandidates: candidates
          } as never
        }
      });
      ack({ ok: true, text: "已保存 " + candidates.length + " 条专精候选", candidates });
    } catch (error) {
      console.error("room:specialty-candidates-save failed", error);
      ack({ ok: false, error: "保存专精候选失败，请重试" });
    }
  });

  socket.on("room:advance-time", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string }) => void) => {
    try {
      const input = payload as {
        roomId?: unknown;
        unit?: unknown;
        steps?: unknown;
        note?: unknown;
        visibility?: unknown;
      };
      if (typeof input?.roomId !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const membership = await deps.loadMembership(input.roomId, me.userId);
      if (membership === null || membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 可以推进叙事时间" });
        return;
      }
      const units = ["MINUTE", "HOUR", "DAY"] as const;
      const unit = typeof input.unit === "string" && (units as readonly string[]).includes(input.unit)
        ? (input.unit as "MINUTE" | "HOUR" | "DAY")
        : "HOUR";
      const steps = finiteNumber(input.steps, 1, 10000) ?? 1;
      const note = typeof input.note === "string" ? input.note.trim().slice(0, 120) : "";
      const activeGame = await prisma.game.findFirst({
        where: { roomId: input.roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true }
      });
      if (activeGame === null) {
        ack({ ok: false, error: "当前没有进行中的局" });
        return;
      }
      const gameCharacters = await prisma.gameCharacter.findMany({
        where: { gameId: activeGame.id },
        select: { id: true, characterId: true, conditions: true, character: { select: { name: true } } }
      });
      const expiredLines: string[] = [];
      let changedCount = 0;
      for (const gameCharacter of gameCharacters) {
        const before = parseConditions(gameCharacter.conditions);
        const ticked = tickConditions(before, unit, steps);
        const changed =
          ticked.expired.length > 0 || JSON.stringify(ticked.conditions) !== JSON.stringify(before);
        if (changed === false) continue;
        await prisma.gameCharacter.update({
          where: { id: gameCharacter.id },
          data: { conditions: ticked.conditions as never }
        });
        await forEachCombatParticipant(io, input.roomId, { kind: "CHARACTER", id: gameCharacter.characterId }, (participant) => {
          participant.conditions = ticked.conditions;
        });
        changedCount += 1;
        for (const expired of ticked.expired) {
          expiredLines.push(gameCharacter.character.name + " 的 " + expired.type + " 已到期");
        }
      }
      const text =
        "【推进时间】" +
        steps +
        " " +
        (unit === "MINUTE" ? "分钟" : unit === "HOUR" ? "小时" : "天") +
        "（" +
        activeGame.title +
        "）" +
        (note.length > 0 ? " · " + note : "") +
        "；" +
        (changedCount === 0
          ? "没有需要结算的限时状态"
          : "结算了 " + changedCount + " 名角色的限时状态" + (expiredLines.length > 0 ? "；" + expiredLines.join("；") : ""));
      await deps.postDice({
        roomId: input.roomId,
        userId: me.userId,
        visibility: unitVisibility(input.visibility),
        text,
        view: {
          expression: "时间推进",
          total: steps,
          terms: [steps + " " + unit, expiredLines.length + " 条状态到期"],
          min: 1,
          max: Math.max(1, steps)
        },
        results: { kind: "ADVANCE_TIME", unit, steps, changedCount, expired: expiredLines }
      });
      io.to("room:" + input.roomId).emit("room:refresh", { roomId: input.roomId, reason: "advance-time" });
      ack({ ok: true, text });
    } catch (error) {
      console.error("room:advance-time failed", error);
      ack({ ok: false, error: "时间推进失败，请重试" });
    }
  });

  socket.on("room:condition-add", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string }) => void) => {
    try {
      const input = payload as {
        roomId?: unknown;
        unitRef?: unknown;
        type?: unknown;
        unit?: unknown;
        remaining?: unknown;
        note?: unknown;
        visibility?: unknown;
      };
      if (typeof input?.roomId !== "string" || typeof input.type !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const unit = deps.parseKpUnitRef(input.unitRef);
      if (unit === null) {
        ack({ ok: false, error: "单位引用不合法" });
        return;
      }
      const membership = await deps.loadMembership(input.roomId, me.userId);
      if (membership === null || membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 可以编辑状态" });
        return;
      }
      const type = input.type.trim().slice(0, 40);
      if (type.length === 0) {
        ack({ ok: false, error: "状态类型不能为空" });
        return;
      }
      if (CORE_CONDITIONS.has(type)) {
        ack({ ok: false, error: "核心状态由 HP / CON / SAN 规则驱动，不能手工增删" });
        return;
      }
      const units = ["ROUND", "CHARGE", "MINUTE", "HOUR", "DAY", "NARRATIVE"];
      const durationUnit = typeof input.unit === "string" && units.includes(input.unit) ? input.unit : "ROUND";
      const remaining = finiteNumber(input.remaining, 0, 100000) ?? 0;
      const note = typeof input.note === "string" ? input.note.trim().slice(0, 120) : "";
      const condition = makeCondition({
        type,
        unit: durationUnit as "ROUND" | "CHARGE" | "MINUTE" | "HOUR" | "DAY" | "NARRATIVE",
        remaining,
        note,
        visibility: conditionVisibility(input.visibility)
      });
      if (unit.kind === "CHARACTER") {
        const game = await prisma.game.findFirst({
          where: { roomId: input.roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });
        if (game === null) {
          ack({ ok: false, error: "当前没有进行中的局" });
          return;
        }
        const gameCharacter = await prisma.gameCharacter.findUnique({
          where: { gameId_characterId: { gameId: game.id, characterId: unit.id } }
        });
        if (gameCharacter === null) {
          ack({ ok: false, error: "该角色不在当前局中" });
          return;
        }
        const next = [...parseConditions(gameCharacter.conditions), condition];
        await prisma.gameCharacter.update({
          where: { id: gameCharacter.id },
          data: { conditions: next as never }
        });
        await forEachCombatParticipant(io, input.roomId, unit, (participant) => {
          participant.conditions = next;
        });
        ack({ ok: true, text: "已添加状态 " + type });
      } else {
        const card = await prisma.card.findUnique({ where: { id: unit.id } });
        if (card === null || card.roomId !== input.roomId || card.type !== "NPC") {
          ack({ ok: false, error: "NPC 卡不存在或不属于本房间" });
          return;
        }
        const stats = recordOf(card.stats);
        const next = [...parseConditions(stats.conditions), condition];
        await prisma.card.update({
          where: { id: card.id },
          data: { stats: { ...stats, conditions: next } as never }
        });
        await forEachCombatParticipant(io, input.roomId, unit, (participant) => {
          participant.conditions = next;
        });
        ack({ ok: true, text: "已添加状态 " + type });
      }
      io.to("room:" + input.roomId).emit("room:refresh", { roomId: input.roomId, reason: "condition-add" });
    } catch (error) {
      console.error("room:condition-add failed", error);
      ack({ ok: false, error: "状态添加失败，请重试" });
    }
  });

  socket.on("room:condition-remove", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string }) => void) => {
    try {
      const input = payload as { roomId?: unknown; unitRef?: unknown; conditionId?: unknown };
      if (typeof input?.roomId !== "string" || typeof input.conditionId !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const unit = deps.parseKpUnitRef(input.unitRef);
      if (unit === null) {
        ack({ ok: false, error: "单位引用不合法" });
        return;
      }
      const membership = await deps.loadMembership(input.roomId, me.userId);
      if (membership === null || membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 可以编辑状态" });
        return;
      }
      if (unit.kind === "CHARACTER") {
        const game = await prisma.game.findFirst({
          where: { roomId: input.roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });
        if (game === null) {
          ack({ ok: false, error: "当前没有进行中的局" });
          return;
        }
        const gameCharacter = await prisma.gameCharacter.findUnique({
          where: { gameId_characterId: { gameId: game.id, characterId: unit.id } }
        });
        if (gameCharacter === null) {
          ack({ ok: false, error: "该角色不在当前局中" });
          return;
        }
        const next = removeConditionById(parseConditions(gameCharacter.conditions), input.conditionId);
        await prisma.gameCharacter.update({ where: { id: gameCharacter.id }, data: { conditions: next as never } });
        await forEachCombatParticipant(io, input.roomId, unit, (participant) => {
          participant.conditions = next;
        });
      } else {
        const card = await prisma.card.findUnique({ where: { id: unit.id } });
        if (card === null || card.roomId !== input.roomId || card.type !== "NPC") {
          ack({ ok: false, error: "NPC 卡不存在或不属于本房间" });
          return;
        }
        const stats = recordOf(card.stats);
        const next = removeConditionById(parseConditions(stats.conditions), input.conditionId);
        await prisma.card.update({ where: { id: card.id }, data: { stats: { ...stats, conditions: next } as never } });
        await forEachCombatParticipant(io, input.roomId, unit, (participant) => {
          participant.conditions = next;
        });
      }
      ack({ ok: true, text: "状态已移除" });
      io.to("room:" + input.roomId).emit("room:refresh", { roomId: input.roomId, reason: "condition-remove" });
    } catch (error) {
      console.error("room:condition-remove failed", error);
      ack({ ok: false, error: "状态移除失败，请重试" });
    }
  });

  socket.on("room:environment-damage", async (payload: unknown, ack: (result: { ok: boolean; error?: string; text?: string }) => void) => {
    try {
      const input = payload as {
        roomId?: unknown;
        unitRef?: unknown;
        damageType?: unknown;
        expression?: unknown;
        rounds?: unknown;
        note?: unknown;
        visibility?: unknown;
      };
      if (typeof input?.roomId !== "string" || typeof input.expression !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }
      const unit = deps.parseKpUnitRef(input.unitRef);
      if (unit === null) {
        ack({ ok: false, error: "单位引用不合法" });
        return;
      }
      const membership = await deps.loadMembership(input.roomId, me.userId);
      if (membership === null || membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 可以施加环境伤害" });
        return;
      }
      const expression = input.expression.trim().slice(0, 40);
      let total = 0;
      try {
        total = Math.max(0, rollDice(parseDice(expression), cryptoRng).total);
      } catch {
        ack({ ok: false, error: "伤害表达式不合法" });
        return;
      }
      const damageType =
        typeof input.damageType === "string" && input.damageType.trim().length > 0
          ? input.damageType.trim().slice(0, 20)
          : "环境伤害";
      const rounds = finiteNumber(input.rounds, 0, 999) ?? 0;
      const note = typeof input.note === "string" ? input.note.trim().slice(0, 120) : "";

      if (unit.kind === "CHARACTER") {
        const character = await prisma.character.findUnique({ where: { id: unit.id } });
        if (character === null) {
          ack({ ok: false, error: "角色不存在" });
          return;
        }
        const game = await prisma.game.findFirst({
          where: { roomId: input.roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });
        if (game === null) {
          ack({ ok: false, error: "当前没有进行中的局" });
          return;
        }
        const gameCharacter = await prisma.gameCharacter.findUnique({
          where: { gameId_characterId: { gameId: game.id, characterId: unit.id } }
        });
        if (gameCharacter === null) {
          ack({ ok: false, error: "该角色不在当前局中" });
          return;
        }
        const applied = applyBodyDamage({
          hp: gameCharacter.currentHp,
          maxHp: character.maxHp,
          con: character.con,
          conditions: parseConditions(gameCharacter.conditions),
          damage: total,
          rng: cryptoRng
        });
        const nextConditions = appendDotCondition(applied.conditions, expression, damageType, rounds);
        await prisma.$transaction([
          prisma.gameCharacter.update({
            where: { id: gameCharacter.id },
            data: {
              currentHp: applied.hp,
              conditions: nextConditions as never,
              status: applied.dead ? "DEAD" : "ALIVE"
            }
          }),
          prisma.character.update({ where: { id: character.id }, data: { hp: applied.hp } })
        ]);
        await forEachCombatParticipant(io, input.roomId, unit, (participant) => {
          syncCombatFlags(participant, { ...applied, conditions: nextConditions });
        });
        const text =
          "【环境伤害·" +
          damageType +
          "】" +
          character.name +
          " " +
          expression +
          " = " +
          total +
          " 点（HP " +
          gameCharacter.currentHp +
          "→" +
          applied.hp +
          "）" +
          (applied.dead
            ? "，单次伤害达到最大生命值，当场死亡"
            : applied.majorWound
              ? "，达到重伤阈值" +
                (applied.conRoll === null
                  ? ""
                  : "，CON 检定 1d100 = " +
                    applied.conRoll +
                    " → " +
                    (applied.conSuccess ? "成功" : "失败" + (applied.unconscious ? "并昏迷" : "")))
              : "") +
          (rounds > 0 ? "；附加持续伤害 " + rounds + " 轮" : "") +
          (note.length > 0 ? " · " + note : "");
        await deps.postDice({
          roomId: input.roomId,
          userId: me.userId,
          visibility: unitVisibility(input.visibility),
          text,
          view: {
            expression,
            total,
            terms: [expression + "[" + total + "]", "HP " + gameCharacter.currentHp + " → " + applied.hp],
            min: 1,
            max: Math.max(1, total)
          },
          results: { kind: "ENVIRONMENT", damageType, total, rounds }
        });
        io.to("room:" + input.roomId).emit("room:refresh", { roomId: input.roomId, reason: "environment-damage" });
        ack({ ok: true, text });
        return;
      }

      const card = await prisma.card.findUnique({ where: { id: unit.id } });
      if (card === null || card.roomId !== input.roomId || card.type !== "NPC") {
        ack({ ok: false, error: "NPC 卡不存在或不属于本房间" });
        return;
      }
      const stats = recordOf(card.stats);
      const attributes = recordOf(stats.attributes);
      // 战斗中优先读取席位运行时 HP / CON / 状态；NPC 卡的 stats.hp 往往只是初始模板。
      const runtimeHit = await findCombatParticipant(input.roomId, unit);
      const hp = runtimeHit?.participant.hp ?? finiteNumber(stats.hp, 0, 999999) ?? 0;
      const maxHp = runtimeHit?.participant.maxHp ?? finiteNumber(stats.maxHp, 1, 999999) ?? Math.max(1, hp);
      const con = runtimeHit?.participant.attributes.con ?? finiteNumber(attributes.con, 0, 999) ?? 0;
      const baseConditions =
        runtimeHit === null ? parseConditions(stats.conditions) : parseConditions(runtimeHit.participant.conditions);
      const applied = applyBodyDamage({
        hp,
        maxHp,
        con,
        conditions: baseConditions,
        damage: total,
        rng: cryptoRng
      });
      const nextConditions = appendDotCondition(applied.conditions, expression, damageType, rounds);
      await prisma.card.update({
        where: { id: card.id },
        data: { stats: { ...stats, maxHp, hp: applied.hp, conditions: nextConditions } as never }
      });
      await forEachCombatParticipant(io, input.roomId, unit, (participant) => {
        syncCombatFlags(participant, { ...applied, conditions: nextConditions });
      });
      const text =
        "【环境伤害·" +
        damageType +
        "】NPC " +
        card.name +
        " " +
        expression +
        " = " +
        total +
        " 点（HP " +
        hp +
        "→" +
        applied.hp +
        "）" +
        (applied.dead ? "，当场死亡" : applied.majorWound ? "，达到重伤阈值" : "") +
        (rounds > 0 ? "；附加持续伤害 " + rounds + " 轮" : "") +
        (note.length > 0 ? " · " + note : "");
      await deps.postDice({
        roomId: input.roomId,
        userId: me.userId,
        visibility: unitVisibility(input.visibility),
        text,
        view: {
          expression,
          total,
          terms: [expression + "[" + total + "]", "HP " + hp + " → " + applied.hp],
          min: 1,
          max: Math.max(1, total)
        },
        results: { kind: "ENVIRONMENT", damageType, total, rounds }
      });
      io.to("room:" + input.roomId).emit("room:refresh", { roomId: input.roomId, reason: "environment-damage" });
      ack({ ok: true, text });
    } catch (error) {
      console.error("room:environment-damage failed", error);
      ack({ ok: false, error: "环境伤害结算失败，请重试" });
    }
  });
}
