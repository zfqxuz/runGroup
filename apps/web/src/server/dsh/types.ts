import type { DshStreamEvent } from "@/server/dsh/runner";

export interface DshHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface DshViewer {
  readonly id: string;
  readonly username: string;
  readonly role: string;
}

export interface DshTurnInput {
  readonly pathname: string;
  readonly userId: string;
  readonly username: string;
  readonly role: string;
  readonly skillId: string | null;
  readonly message: string;
  readonly history: readonly DshHistoryMessage[];
}

export interface DshTurnResult {
  readonly ok: boolean;
  readonly reply: string;
  readonly version?: string;
  readonly skillId?: string;
  readonly error?: string;
}

export interface DshTurnOptions {
  readonly onEvent?: (event: DshStreamEvent) => void;
}

export interface DshSkillTask {
  readonly task: string;
  readonly files: Readonly<Record<string, string>>;
}
