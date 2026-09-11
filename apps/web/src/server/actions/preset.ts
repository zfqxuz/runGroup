"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { applyModulePresetToRoom } from "@/server/modules/materialize";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function applyModulePresetAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const requestedModuleId = clean(formData.get("moduleId"), 64);
  if (roomId.length === 0) redirect("/");

  let moduleId = requestedModuleId;
  if (moduleId.length === 0) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { selectedModuleId: true } });
    moduleId = room?.selectedModuleId ?? "";
  }
  if (moduleId.length === 0) {
    redirect("/rooms/" + roomId + "/prepare?error=preset&reason=" + encodeURIComponent("请先选择团本"));
  }

  const force = String(formData.get("force") ?? "0") === "1";
  const result = await applyModulePresetToRoom({ roomId, moduleId, userId: session.user.id, force });
  if (result.ok === false) {
    redirect("/rooms/" + roomId + "/prepare?error=preset&reason=" + encodeURIComponent(result.error ?? "应用失败"));
  }

  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  revalidatePath("/rooms/" + roomId + "/scenes");

  const counts = result.counts;
  if (counts === undefined) {
    redirect("/rooms/" + roomId + "/prepare?preset=applied");
  }
  redirect(
    "/rooms/" + roomId + "/prepare?preset=applied" +
      "&chapters=" + String(counts.chapters) +
      "&scenes=" + String(counts.scenes) +
      "&npcs=" + String(counts.npcs) +
      "&items=" + String(counts.items) +
      "&clues=" + String(counts.clues) +
      "&encounters=" + String(counts.encounters) +
      "&magic=" + String(counts.magic)
  );
}
