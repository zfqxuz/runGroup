"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth, signOut } from "@/server/auth";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
import { prisma } from "@/server/db/prisma";

export interface UserActionState {
  readonly ok: boolean;
  readonly message: string;
}

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "昵称不能为空")
  .max(32, "昵称最多 32 个字符");

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(72),
  newPassword: z.string().min(8, "新密码至少 8 位").max(72, "新密码最多 72 位"),
  confirmPassword: z.string().min(1, "请再次输入新密码")
});

export async function updateDisplayNameAction(
  _state: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const session = await auth();
  if (session === null) return { ok: false, message: "登录状态已失效，请重新登录" };

  const parsed = displayNameSchema.safeParse(String(formData.get("displayName") ?? ""));
  if (parsed.success === false) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "昵称不合法" };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { displayName: parsed.data }
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "昵称已更新" };
}

export async function updatePasswordAction(
  _state: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const session = await auth();
  if (session === null) return { ok: false, message: "登录状态已失效，请重新登录" };

  const parsed = passwordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? "")
  });
  if (parsed.success === false) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "密码不合法" };
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;
  const passwordMatches = newPassword === confirmPassword;
  if (passwordMatches === false) {
    return { ok: false, message: "两次输入的新密码不一致" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true }
  });
  if (user === null) return { ok: false, message: "账号不存在" };

  const matched = await bcrypt.compare(currentPassword, user.passwordHash);
  if (matched === false) return { ok: false, message: "当前密码不正确" };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash }
  });
  return { ok: true, message: "密码已更新" };
}

export async function setAvatarAction(assetId: string): Promise<UserActionState> {
  const session = await auth();
  if (session === null) return { ok: false, message: "登录状态已失效，请重新登录" };

  const asset = await prisma.asset.findUnique({
    where: { id: assetId.trim() },
    select: { id: true, ownerId: true, type: true, url: true }
  });
  if (asset === null) return { ok: false, message: "头像文件无效，请重新上传" };
  if ((asset.ownerId === session.user.id) === false) {
    return { ok: false, message: "头像文件无效，请重新上传" };
  }
  if ((asset.type === "AVATAR") === false) {
    return { ok: false, message: "头像文件无效，请重新上传" };
  }

  const previous = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { avatarUrl: true }
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarUrl: asset.url }
  });

  const previousUrl = previous === null ? null : previous.avatarUrl;
  const sameAvatar = previousUrl === null || previousUrl === asset.url;
  if (sameAvatar === false) {
    const oldAsset = await prisma.asset.findFirst({
      where: { ownerId: session.user.id, url: previousUrl },
      select: { id: true }
    });
    if (oldAsset) await deleteAssetIfOrphan(oldAsset.id);
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "头像已更新" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
