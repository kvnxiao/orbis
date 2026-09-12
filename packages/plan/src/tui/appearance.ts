import { Type } from "typebox";
import type { Static } from "typebox";

/** Validate supported selection markers. */
export const symbolsSchema = Type.Union([Type.Literal("unicode"), Type.Literal("emoji")]);
/** Validate supported modal border styles. */
export const borderSchema = Type.Union([
  Type.Literal("rounded"),
  Type.Literal("square"),
  Type.Literal("double"),
  Type.Literal("ascii"),
  Type.Literal("none"),
]);

/** Describe resolved display settings independently of filesystem configuration. */
export const appearanceSchema = Type.Object({
  symbols: symbolsSchema,
  border: borderSchema,
  showHints: Type.Boolean(),
});

/** Supply resolved modal settings without scope inheritance. */
export type PlanAppearance = Static<typeof appearanceSchema>;
/** Apply these display values before personal and project overrides. */
export const defaultAppearance = {
  symbols: "unicode",
  border: "rounded",
  showHints: true,
} satisfies PlanAppearance;
