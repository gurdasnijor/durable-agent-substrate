# Handoff: effect-durable-streams HTTP API Rework

Date: 2026-06-09
Repo: `/Users/gnijor/gurdasnijor/fluent-firegrid`

## Current State

This handoff exists because the prior session drifted away from the Effect Platform examples the user explicitly provided. Treat the current `packages/effect-durable-streams` implementation as an intermediate, not an approved design.

The package currently has an attempted `HttpApi` conversion in `packages/effect-durable-streams/src/Api.ts`, and the old `packages/effect-durable-streams/src/routes/Stream.ts` has been removed. The attempt typechecks/tests/lints locally, but it still needs a design pass against the actual `@effect/platform` README examples and vendored source.

Known local verification from the prior session:

```sh
pnpm --filter effect-durable-streams typecheck
pnpm --filter effect-durable-streams test
pnpm --filter effect-durable-streams lint
```

All three passed at that point.

The repository is dirty with broader migration work. Do not reset or revert unrelated files. In particular, `packages/effect-durable-streams/` is currently untracked in this checkout.

## User Direction

The user wants this reworked to follow Effect Platform APIs directly, not bespoke router glue:

- Use `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, and `HttpApiSwagger`.
- Use `.setPath`, `HttpApiSchema.param`, `.setHeaders`, `.setUrlParams`, `.addError`, `.prefix`, and documented streaming response APIs where applicable.
- Prefer predefined `HttpApiError` empty error types for the HTTP surface.
- Do not hand-build HTTP response/error machinery in `ProtocolError.ts`.
- Do not use `HttpRouter.Default.use` with dependencies inside route files.
- Do not reintroduce a giant `routes/Stream.ts`.
- Do not invent fake reserved endpoints such as `reservedGet`.
- Do not use a reserved-prefix placeholder to dodge proper API structure.
- Do not preserve `appendResponse`-style names that make pure response lowering look like a router.

The user specifically objected to previous code because it:

- parsed headers manually instead of declaring them with `.setHeaders`;
- parsed paths manually instead of using path parameter APIs;
- built custom `HttpServerRespondable` errors instead of group/API error declarations;
- mixed route decoding, protocol decisions, response encoding, telemetry, and store access in one file;
- kept duplicated or transport-specific protocol surfaces that should not exist.

## Required References

Before touching Effect code, read the repo instructions and Effect reference material:

- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/AGENTS.md`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/README.md`

Use the vendored Effect repo only as read-only reference material. Do not import from `repos/effect` and do not edit it.

Most relevant README sections:

- HTTP API overview
- Defining `HttpApiEndpoint`
- Path Parameters
- Catch-All Endpoints
- Setting URL Parameters
- Setting Request Headers
- Adding errors
- Predefined Empty Error Types
- Prefixing
- Implementing a Server
- Serving the Auto Generated Swagger Documentation
- Streaming Requests
- Streaming Responses
- `HttpLayerRouter.addHttpApi` only if choosing that composition style deliberately

Relevant vendored source/examples:

- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform-node/examples/api.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform-node/examples/http-router.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform-node/examples/http-tag-router.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/src/HttpApiEndpoint.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/src/HttpApiBuilder.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/src/HttpApiGroup.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/src/HttpApiError.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/src/HttpApiSchema.ts`
- `/Users/gnijor/gurdasnijor/firegrid/repos/effect/packages/platform/src/HttpServerResponse.ts`

Also read the product specs before deciding behavior:

- `PROTOCOL.md`
- `features/durable-streams/effect-server.feature.yaml`

Use the acai process for spec-driven changes. If behavior changes, the feature ACIDs and tests need to align.

## Current Files To Inspect

- `packages/effect-durable-streams/src/Api.ts`
- `packages/effect-durable-streams/src/Server.ts`
- `packages/effect-durable-streams/src/Protocol.ts`
- `packages/effect-durable-streams/src/ProtocolError.ts`
- `packages/effect-durable-streams/src/Store.ts`
- `packages/effect-durable-streams/src/MemoryStore.ts`
- `packages/effect-durable-streams/src/Telemetry.ts`
- `packages/effect-durable-streams/src/DurableStreamsServer.ts`
- `packages/effect-durable-streams/test/route-precedence.test.ts`
- `packages/effect-durable-streams/test/protocol-decode.test.ts`
- `packages/effect-durable-streams/test/append-decision.test.ts`

## Specific Design Notes

The HTTP surface should be an adapter over `Store.Store`, not the domain truth. In-process Effect callers should use `Store.Store` directly.

The likely shape is:

- `Api.ts`: declarations only, or mostly declarations:
  - `DurableStreamsApi`
  - data-plane group prefixed with `/v1/stream`
  - endpoint schemas for path, headers, URL params, and payloads
  - group/API level `.addError(...)`
- `Handlers.ts` or `ApiLive.ts`: `HttpApiBuilder.group(...)` implementations that call `Store.Store`.
- `Server.ts`: composition only:
  - `HttpApiBuilder.serve(HttpMiddleware.logger)`
  - `HttpApiSwagger.layer(...)`
  - `HttpServer.withLogAddress`
  - `NodeHttpServer.layer(...)`
- A small response-lowering module only if required by the Durable Streams protocol status/header matrix. Name it as an HTTP response adapter, not a router.

Slash-bearing stream paths are the hard part. The prior attempt used a catch-all path and transformed the `"*"` parameter into `streamPath`. That may be acceptable only if it is the documented Effect way to model splat paths. Verify this against the vendored source/README before keeping it. Do not let raw `"*"` plumbing leak through the handlers.

The reserved `__ds` prefix is real in `PROTOCOL.md`, but do not invent placeholder endpoints for it. Either:

- route real control-plane APIs when they exist, or
- keep a narrowly scoped data-plane guard that rejects application stream paths under `__ds`.

Do not reintroduce fake `reservedGet`/reserved route stubs.

Request bodies still need a deliberate decision. `HttpApi` streaming request examples show `Schema.Uint8ArrayFromSelf.pipe(HttpApiSchema.withEncoding({ kind: "Uint8Array", contentType: "application/octet-stream" }))`, but Durable Streams appends carry arbitrary content types. Confirm whether `HttpApi` can model arbitrary binary payloads with dynamic content type. If not, use raw `HttpServerRequest` intentionally and document why.

Streaming responses should use `HttpServerResponse.stream` when the store supports streaming/tailing. Current store read returns a chunk snapshot, not a live subscription. Do not fake live streaming until the store seam exists.

## Known Remaining Problems

- `Telemetry.ts` is probably the wrong abstraction. The user wants tracing/middleware aligned with Effect Platform patterns, not a bespoke attribute formatter.
- `Store.withTracing` may still be useful as a store decorator, but re-evaluate it after reading the tracing/middleware examples.
- `MemoryStore.decide` currently operates over `StreamRecord`, which mixes protocol decision logic with storage representation. Eventually extract the protocol decision over an abstract state view.
- `DurableStreamsServer.ts` is an optional RPC adapter. Keep it only if it stays thin and typed, or explicitly defer it. Do not let it drift from the HTTP/store vocabulary.
- `ProtocolError.ts` should remain domain errors. The HTTP adapter should map them to `HttpApiError` or declared API errors, not carry HTTP response methods.

## Avoid These Regressions

- No `HttpRouter.Default.use` route layer that reads `Store.Store` while registering routes.
- No handrolled path parsing when Effect path APIs can express it.
- No handrolled header validation when `.setHeaders` can express it.
- No fake control-plane or reserved-prefix routes.
- No transport-specific imports in shared protocol/domain modules.
- No new separate protocol package unless a spec/architecture decision explicitly calls for it.
- No conformance harness shortcuts that paper over missing production behavior.

## Suggested Next Session Plan

1. Read the required Effect Platform README sections and vendored source examples.
2. Read `PROTOCOL.md` and `features/durable-streams/effect-server.feature.yaml`.
3. Reassess `Api.ts` against the examples. Prefer deleting and rewriting over patching if the shape is still misleading.
4. Decide how to represent slash-bearing stream paths and arbitrary binary request bodies using official APIs where possible.
5. Keep the HTTP API declaration separate from handler implementation and server composition.
6. Run:

```sh
pnpm --filter effect-durable-streams typecheck
pnpm --filter effect-durable-streams test
pnpm --filter effect-durable-streams lint
```

7. If behavior changes, update feature specs/tests under the acai process.
