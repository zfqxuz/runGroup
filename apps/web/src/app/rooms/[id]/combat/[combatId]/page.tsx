import { redirect } from "next/navigation";

export default function CombatDetailRedirectPage({
  params
}: {
  params: { id: string; combatId: string };
}) {
  redirect("/rooms/" + params.id);
}
