import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** 旧的「角色管理」页已合并到统一的角色编辑页（新建 / 编辑同一套页面）。 */
export default function ManageCharacterRedirect({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { roomId?: string };
}) {
  const suffix = searchParams.roomId === undefined ? "" : "?roomId=" + searchParams.roomId;
  redirect("/characters/" + params.id + "/edit" + suffix);
}
