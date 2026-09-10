import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

function generateInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createRoom(formData: FormData): Promise<void> {
  "use server";

  const session = await auth();
  if (session === null) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const system = String(formData.get("system") ?? "COC7");
  const chargenMethod = String(formData.get("chargenMethod") ?? "destiny5");
  const eraRaw = String(formData.get("era") ?? "MODERN");
  const era = system === "TOUHOU" ? null : eraRaw === "CLASSIC" ? "CLASSIC" : "MODERN";
  if (name.length === 0) return;

  const room = await prisma.room.create({
    data: {
      name,
      system: system === "TOUHOU" ? "TOUHOU" : "COC7",
      ownerId: session.user.id,
      inviteCode: generateInviteCode(),
      chargenMethod,
      era,
      members: { create: { userId: session.user.id, role: "KP" } }
    }
  });

  redirect("/rooms/" + room.id);
}

async function doSignOut(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-sm outline-none focus:border-sakura-500";

export default async function HomePage() {
  const session = await auth();
  if (session === null) redirect("/login");

  const memberships = await prisma.roomMember.findMany({
    where: { userId: session.user.id },
    include: { room: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "desc" }
  });

  // KP 需要在房间列表上就看到有多少待审
  const roomIds = memberships.map((item) => item.roomId);
  const pendingByRoom = new Map<string, number>();
  if (roomIds.length > 0) {
    const pendingCharacters = await prisma.roomCharacterEntry.findMany({
      where: { roomId: { in: roomIds }, status: "PENDING_REVIEW" },
      select: { roomId: true }
    });
    const pendingCards = await prisma.roomCardEntry.findMany({
      where: { roomId: { in: roomIds }, status: "PENDING_REVIEW" },
      select: { roomId: true }
    });
    for (const row of [...pendingCharacters, ...pendingCards]) {
      pendingByRoom.set(row.roomId, (pendingByRoom.get(row.roomId) ?? 0) + 1);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-14">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">东方 TRPG 跑团平台</h1>
          <p className="mt-1 text-sm text-white/50">
            当前账号：{session.user.name ?? session.user.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/characters"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/35 hover:text-white"
          >
            我的角色
          </Link>
          <Link
            href="/cards"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/35 hover:text-white"
          >
            我的卡牌
          </Link>
          <form action={doSignOut}>

          <button
            type="submit"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/30 hover:text-white"
          >
            退出登录
          </button>
          </form>
        </div>
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium text-white/80">创建房间</h2><Link href="/rooms/new" className="rounded-lg border border-sakura-500/40 px-3 py-1.5 text-xs text-sakura-400 transition hover:bg-sakura-500/10">按配置新建</Link></div>
        <form action={createRoom} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs text-white/50">房间名</span>
            <input name="name" placeholder="例：红魔馆异变调查" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">规则系统</span>
            <select name="system" className={inputClass} defaultValue="COC7">
              <option value="COC7">COC7 原版</option>
              <option value="TOUHOU">东方扩展</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">背景年代</span>
            <select name="era" className={inputClass} defaultValue="MODERN">
              <option value="MODERN">现代</option>
              <option value="CLASSIC">1920 年代</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">车卡方式（房主决定）</span>
            <select name="chargenMethod" className={inputClass} defaultValue="destiny5">
              <option value="destiny5">天命 5 · 掷 5 组选 1 组</option>
              <option value="point480">总点数 480 · 单项 15~90</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
          >
            创建
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-white/80">
          我的房间（{memberships.length}）
        </h2>

        {memberships.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center text-sm text-white/40">
            还没有房间，用上面的表单创建一个
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {memberships.map((membership) => (
              <li key={membership.id}>
                <Link
                  href={"/rooms/" + membership.roomId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/40 px-5 py-4 transition hover:border-sakura-500/40"
                >
                  <div>
                    <p className="font-medium">{membership.room.name}</p>
                    <p className="mt-1 font-mono text-xs text-white/40">
                      邀请码 {membership.room.inviteCode}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-spirit-400">
                      {membership.room.system}
                    </span>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-white/50">
                      {membership.role}
                    </span>
                    {membership.role === "KP" && (pendingByRoom.get(membership.roomId) ?? 0) > 0 ? (
                      <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-amber-300">
                        待审 {pendingByRoom.get(membership.roomId)}
                      </span>
                    ) : null}
                    <span className="text-white/40">
                      {membership.room._count.members} 人
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
