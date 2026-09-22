import type { DshContextKind } from "@/shared/dsh-context";
import type { DshHistoryMessage } from "@/server/dsh/types";
import type { DshResolvedContext } from "@/server/dsh/context";

export type DshSkillEffect = "READ" | "WRITE";

/** 谁能用：ALL 所有登录用户；KP 当前房间 KP / 团本作者；OWNER 团本作者或房间 KP。 */
export type DshSkillAudience = "ALL" | "KP" | "OWNER";

export interface DshSkillSpec {
  readonly role: string;
  readonly goal: string;
  readonly rules?: readonly string[];
  readonly progressLabel?: string;
}

export interface DshSkillDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly effect: DshSkillEffect;
  readonly audience: DshSkillAudience;
  readonly kinds: readonly DshContextKind[];
  /** 该场景下不选技能时的默认技能。 */
  readonly isDefault?: boolean;
  /** 只读技能的提示词模板；写入技能不用它。 */
  readonly spec?: DshSkillSpec;
}

export interface DshSkillMeta {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly effect: DshSkillEffect;
  readonly audience: DshSkillAudience;
}

export interface DshSkillPromptInput {
  readonly context: DshResolvedContext;
  readonly message: string;
  readonly history: readonly DshHistoryMessage[];
}

export function toSkillMeta(skill: DshSkillDefinition): DshSkillMeta {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    effect: skill.effect,
    audience: skill.audience
  };
}
