import Link from "next/link";
import { setUserRoleAction, toggleUserDisabledAction } from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams: { q?: string; saved?: string; error?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const users = await prisma.user.findMany({
    where:
      q.length === 0
        ? {}
        : {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } }
            ]
          },
    include: {
      _count: { select: { memberships: true, ownedRooms: true, characters: true, modules: true } }
    },
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    take: 200
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
          <h1 className="mt-2 text-2xl font-semibold">用户管理</h1>
          <p className="mt-1 text-sm text-white/50">共 {users.length} 个账号。bdmin 为受保护管理员，不可降权或禁用。</p>
        </div>
        <form className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/40">搜索</span>
            <input
              name="q"
              defaultValue={q}
              placeholder="用户名 / 昵称 / 邮箱"
              className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500"
            />
          </label>
          <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-300 transition hover:bg-spirit-400/10">
            搜索
          </button>
        </form>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">操作已保存：{searchParams.saved}</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">操作失败：{searchParams.error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">数据</th>
              <th className="px-4 py-3">最近登录</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map((user) => {
              const protectedUser = user.username === "bdmin";
              return (
                <tr key={user.id} className="align-middle">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white/80">{user.displayName ?? user.username}</p>
                    <p className="mt-0.5 text-[10px] text-white/35">@{user.username}{user.email === null ? "" : " · " + user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {user.role === "ADMIN" ? (
                      <span className="rounded-full border border-sakura-500/40 bg-sakura-500/10 px-2 py-0.5 text-[10px] text-sakura-300">管理员</span>
                    ) : (
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">普通用户</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.isDisabled ? (
                      <span className="text-[10px] text-red-300">已禁用</span>
                    ) : (
                      <span className="text-[10px] text-emerald-300">正常</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-white/35">
                    房 {user._count.ownedRooms} · 角 {user._count.characters} · 团 {user._count.modules}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-white/35">
                    {user.lastLoginAt === null ? "从未" : user.lastLoginAt.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <form action={setUserRoleAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="role" value={user.role === "ADMIN" ? "USER" : "ADMIN"} />
                        <button
                          type="submit"
                          disabled={protectedUser}
                          className="rounded border border-sakura-500/40 px-2 py-1 text-[10px] text-sakura-300 transition hover:bg-sakura-500/10 disabled:opacity-30"
                        >
                          {user.role === "ADMIN" ? "降为用户" : "设为管理员"}
                        </button>
                      </form>
                      <form action={toggleUserDisabledAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="disabled" value={user.isDisabled ? "0" : "1"} />
                        <button
                          type="submit"
                          disabled={protectedUser}
                          className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10 disabled:opacity-30"
                        >
                          {user.isDisabled ? "解除禁用" : "禁用"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
