-- 同房间多场战斗：删除早期手建的「每房只能有一场进行中战斗」partial unique index。
-- 该索引不在 Prisma schema 中，改由应用层席位互斥（activeCombatEntityIds）保证单位不重复参战。
DROP INDEX IF EXISTS "one_active_combat_per_room";
