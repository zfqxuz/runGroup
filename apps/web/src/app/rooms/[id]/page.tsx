import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: {
      room: {
        include: {
          members: {
            include: {
              user: { select: { id: true, username: true, displayName: true } }
            },
            orderBy: { joinedAt: "asc" }
          }
        }
      }
    }
  });

  if (membership === null) notFound();

  const room = membership.room;
  const isKP = membership.role === "KP";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-14">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回房间列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 flex items-center gap-3 text-xs text-white/50">
            <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-spirit-400">
              {room.system}
            </span>
            <span className="rounded-full border border-white/15 px-2 py-0.5">{room.status}</span>
            <span className="font-mono">邀请码 {room.inviteCode}</span>
          </p>
        </div>
        <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">
          我的身份：{membership.role}
        </span>
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">
          成员（{room.members.length}）
        </h2>
        <ul className="mt-4 flex flex-col divide-y divide-white/5">
          {room.members.map((member) => (
            <li key={member.id} className="flex items-center justify-between py-3 text-sm">
              <span>{member.user.displayName ?? member.user.username}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-white/30">
                  @{member.user.username}
                </span>
                <span
                  className={
                    member.role === "KP"
                      ? "rounded-full border border-sakura-500/40 px-2 py-0.5 text-xs text-sakura-400"
                      : "rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/50"
                  }
                >
                  {member.role}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-dashed border-white/15 px-5 py-8 text-center text-sm text-white/40">
        跑团区（角色卡 / 聊天 / 掷骰）正在开发中
        {isKP ? " · 你是本房间的 KP" : null}
      </section>
    </main>
  );
}
