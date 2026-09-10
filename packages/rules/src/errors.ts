export type RulePackErrorCode =
  | "SCHEMA_INVALID"
  | "FORMULA_INVALID"
  | "DERIVED_CYCLE"
  | "MISSING_ACTION_COST"
  | "PIPELINE_INVALID"
  | "RACE_UNKNOWN";

export class RulePackError extends Error {
  readonly code: RulePackErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(
    code: RulePackErrorCode,
    message: string,
    detail: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = "RulePackError";
    this.code = code;
    this.detail = detail;
  }
}
