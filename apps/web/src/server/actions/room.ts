"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { builtinRegistry, resolveRulePack, type CombatMode } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

function generateInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const BUILTIN_BY_SYSTEM: Record<string, string> = {
  COC7: "coc7-baseline",
  TOUHOU: "touhou-ext"
};

export interface RoomSetupOptions {
  readonly name: string;
  readonly system: "COC7" | "TOUHOU";
  readonly chargenMethod: string;
  readonly era: string | null;
  readonly combatMode: CombatMode;
  readonly disabledEvents: readonly string[];
}

export async function createRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (name.length === 0) redirect("/rooms/new?error=name");

  const system = formData.get("system") === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(BUILTIN_BY_SYSTEM[system] ?? "coc7-baseline", builtinRegistry());

  const requestedEra = String(formData.get("era") ?? "");
  const era =
    system === "TOUHOU"
      ? null
      : requestedEra === "CLASSIC"
        ? "CLASSIC"
        : "MODERN";

  // 服务端查包拿真实的方法定义，不接受前端传 JSON —— 否则等于让客户端改规则
  const methodId = String(formData.get("chargenMethod") ?? "");
  const method = pack.attributes.methods.find((item) => item.id === methodId);
  if (method === undefined) redirect("/rooms/new?error=method");

  const requestedMode = formData.get("combatMode") === "INITIATIVE" ? "INITIATIVE" : "ATB";
  const combatMode: CombatMode = requestedMode;

  // 只允许关闭真实存在的事件，否则合并后会产生缺少 label 的非法事件
  const requested = formData.getAll("disabledEvents").map((value) => String(value));
  const disabledEvents = requested.filter(
    (id) => pack.combat.events[id] !== undefined
  );

  const allowRaw = formData.get("allowPlayerCombatRequest");

  const ruleOverride: Record<string, unknown> = {
    attributes: { methods: [method] },
    combat: {
      mode: combatMode,
      events: Object.fromEntries(
        disabledEvents.map((id) => [id, { defaultEnabled: false }])
      )
    }
  };

  const room = await prisma.room.create({
    data: {
      name,
      system,
      ownerId: session.user.id,
      inviteCode: generateInviteCode(),
      chargenMethod: method.id,
      era,
      allowPlayerCombatRequest: allowRaw === null ? true : String(allowRaw) === "1",
      ruleOverride: ruleOverride as never,
      members: { create: { userId: session.user.id, role: "KP" } }
    },
    select: { id: true }
  });

  redirect("/rooms/" + room.id);
}


export async function joinRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const inviteCode = String(formData.get("inviteCode") ?? "").trim().toUpperCase();
  if (inviteCode.length === 0) redirect("/?error=invite");

  const room = await prisma.room.findUnique({ where: { inviteCode } });
  if (room === null) redirect("/?error=invite");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: session.user.id } }
  });
  if (membership === null) {
    await prisma.roomMember.create({
      data: { roomId: room.id, userId: session.user.id, role: "PLAYER" }
    });
  }

  revalidatePath("/");
  revalidatePath("/rooms/" + room.id + "/prepare");
  revalidatePath("/rooms/" + room.id);
  redirect(room.status === "LOBBY" ? "/rooms/" + room.id + "/prepare" : "/rooms/" + room.id);
}

export async function startRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null) redirect("/");
  if (membership.role !== "KP") redirect("/rooms/" + roomId + "/prepare");
  await prisma.room.update({ where: { id: roomId }, data: { status: "PLAYING" } });
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId);
}
