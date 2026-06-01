import type { AgentEvent } from "./events";

/**
 * Parse a POST SSE response (EventSource is GET-only, so we read the body
 * stream ourselves). Frames are separated by a blank line; we combine the
 * `event:` name with the `data:` JSON into a typed AgentEvent.
 */
export async function* parseSSEStream(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if (!res.body) throw new Error("Response has no body");

  const reader = res.body.pipeThrough(new TextDecoderStream(), { signal }).getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let eventName = "message";
        const dataLines: string[] = [];
        for (const raw of frame.split("\n")) {
          if (raw.startsWith(":")) continue; // keep-alive comment
          if (raw.startsWith("event:")) eventName = raw.slice(6).trim();
          else if (raw.startsWith("data:")) dataLines.push(raw.slice(5).replace(/^ /, ""));
        }

        const data = dataLines.join("\n");
        if (!data) continue;

        try {
          const payload = JSON.parse(data);
          yield { type: eventName, ...payload } as AgentEvent;
        } catch {
          // ignore malformed / heartbeat frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
