import {
  ensurePathInput,
  FiregridMcpServerLayer,
  FiregridRuntimeHostLive,
  RuntimeEnvResolverPolicy,
  type RuntimeHostTopologyOptions,
} from "@firegrid/host-sdk"
import { Layer } from "effect"

interface CodexAcpToolCallPipelineOptions {
  readonly baseUrl: string
  readonly namespace?: string
  readonly hostId?: string
  readonly mcpHost?: string
  readonly mcpPort?: number
  readonly mcpPath?: string
  readonly localProcessEnv?: RuntimeHostTopologyOptions["localProcessEnv"]
  readonly envPolicy?: Layer.Layer<RuntimeEnvResolverPolicy>
}

// TFIND-048: the pre-baked `codexAcpToolCallMcpUrl` helper was deleted.
// The client no longer expresses the MCP URL; it sends the URL-less
// `runtimeContextMcp` marker and the host injects the concrete
// contextId-scoped URL at start from its own bound MCP listener.

export const codexAcpOpenAiEnvPolicy = (
  env: NodeJS.ProcessEnv,
): Layer.Layer<RuntimeEnvResolverPolicy> =>
  RuntimeEnvResolverPolicy.withPolicy({
    authorizedBindings: [["OPENAI_API_KEY", "OPENAI_API_KEY"]],
    lookupEnv: name => env[name],
  })

export const tinyCodexAcpToolCallPipeline = (
  options: CodexAcpToolCallPipelineOptions,
) => {
  const namespace = options.namespace ?? `tiny-codex-acp-${crypto.randomUUID()}`
  const hostId = options.hostId ?? "host-a"
  const mcpHost = options.mcpHost ?? "127.0.0.1"
  const mcpPath = options.mcpPath ?? "/mcp"
  const host = FiregridRuntimeHostLive(
    {
      durableStreamsBaseUrl: options.baseUrl,
      namespace,
      hostId,
      hostSessionId: `${hostId}-session`,
      input: true,
      ...(options.localProcessEnv === undefined
        ? {}
        : { localProcessEnv: options.localProcessEnv }),
    },
    options.envPolicy ?? RuntimeEnvResolverPolicy.denyAll,
  )
  return Layer.discard(
    FiregridMcpServerLayer({
      host: mcpHost,
      port: options.mcpPort ?? 0,
      path: ensurePathInput(mcpPath),
    }),
  ).pipe(
    Layer.provideMerge(host),
  )
}
