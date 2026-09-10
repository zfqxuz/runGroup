import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { importCharacterAction } from "@/server/actions/import-character";

export const dynamic = "force-dynamic";

export default async function ImportCharacterPage(props: { searchParams: { error?: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href="/characters" className="text-xs text-white/40 transition hover:text-white/70">← 返回角色库</Link>
        <h1 className="mt-2 text-2xl font-semibold">导入 xlsx 人物卡</h1>
        <p className="mt-1 text-sm leading-relaxed text-white/50">
          支持「COC7 空白卡」系列的「人物卡」工作表。导入后进入你的个人角色库；
          带进房间仍然走 KP 审核流程。
        </p>
      </header>

      {props.searchParams.error === undefined ? null : (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {props.searchParams.error}
        </p>
      )}

      <form action={importCharacterAction} encType="multipart/form-data" className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-white/70">选择 .xlsx 文件</span>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="block w-full cursor-pointer rounded-lg border border-white/15 bg-ink-900 px-3 py-2.5 text-sm text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-sakura-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink-900"
          />
        </label>
        <button
          type="submit"
          className="mt-5 rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
        >
          解析并导入
        </button>
      </form>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5 text-xs leading-relaxed text-white/40">
        <p>目前导入范围：基础信息、九项属性、职业序号、技能（初始 / 成长 / 职业 / 兴趣）、信用评级、武器。</p>
        <p className="mt-2">导入后若发现技能缺失，通常是因为该技能不在当前规则包中，后续会在规则包补全时自动恢复显示。</p>
      </section>
    </main>
  );
}
