import { DurableStream } from "@durable-streams/client"

export const makeJsonDurableStream = (
  streamUrl: string,
  contentType = "application/json",
): DurableStream =>
  new DurableStream({
    url: streamUrl,
    contentType,
  })
