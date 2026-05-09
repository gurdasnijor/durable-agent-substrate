import { exampleJsonlSessionMaterializer } from "./example-jsonl-session.ts"

export const builtinMaterializers = {
  "example-jsonl-session": exampleJsonlSessionMaterializer,
} as const
