import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import CharacterBuilder from "@/components/room/CharacterBuilder";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function NewCharacterPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();

  const room = membership.room;
  const pack = resolveRulePack(
    room.system === "TOUHOU" ? "touhou-ext" : "coc7-baseline",
    builtinRegistry()
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <Link
          href={"/rooms/" + room.id}
          className="text-xs text-white/40 transition hover:text-white/70"
        >
          ← 返回房间
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">新建角色卡</h1>
        <p className="mt-1 text-sm text-white/50">
          {room.name} · {pack.id}@{pack.version}
        </p>
      </header>

      <CharacterBuilder
        roomId={room.id}
        system={room.system}
        pack={pack}
        chargenMethod={room.chargenMethod ?? "destiny5"}
      />
    </main>
  );
}
