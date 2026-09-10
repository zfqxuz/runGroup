import Link from "next/link";
import { redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import RoomSetupForm from "@/components/room/RoomSetupForm";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

function buildOptions(packId: string) {
  const pack = resolveRulePack(packId, builtinRegistry());
  return {
    methods: pack.attributes.methods.map((method) => ({
      id: method.id,
      label: method.label
    })),
    events: Object.entries(pack.combat.events).map(([id, rule]) => ({
      id,
      label: rule.label,
      description: rule.description ?? null
    })),
    defaultMode: pack.combat.mode
  };
}

export default async function NewRoomPage() {
  const session = await auth();
  if (session === null) redirect("/login");

  const options = {
    COC7: buildOptions("coc7-baseline"),
    TOUHOU: buildOptions("touhou-ext")
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回房间列表
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">创建房间</h1>
        <p className="mt-1 text-sm text-white/50">
          开团前一次性锁定规则；KP 之后仍可覆盖，但会留下审计记录
        </p>
      </header>
      <RoomSetupForm options={options} />
    </main>
  );
}
