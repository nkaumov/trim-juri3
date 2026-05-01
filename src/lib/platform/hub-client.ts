import WebSocket from "ws";

export type HubExecuteResult = {
  conversationId: string;
  messageId: string;
  responseId?: string;
  text: string;
  metadata?: Record<string, unknown>;
  raw?: unknown[];
};

type HubInbound =
  | { type: "auth_response"; success: boolean; session_id?: string; error?: string; form_config?: unknown; widget_config?: unknown }
  | { type: "subscription_response"; success?: boolean; conversation_ids?: string[]; error?: string }
  | { type: "response"; conversation_id?: string; response_id?: string; final?: boolean; timestamp?: string; content?: { text?: string; metadata?: Record<string, unknown> } }
  | { type: "error"; error_code?: string; error_message?: string; error?: string }
  | { type: string; [key: string]: unknown };

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function executeViaPlatformHub(args: {
  hubUrl: string;
  apiKey: string;
  origin?: string;
  userId: string;
  conversationId: string;
  text: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<HubExecuteResult> {
  const timeoutMs = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : 180_000;
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return await new Promise<HubExecuteResult>((resolve, reject) => {
    const rawEvents: unknown[] = [];
    let settled = false;

    const ws = new WebSocket(args.hubUrl, {
      headers: args.origin ? { Origin: args.origin } : undefined,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close(1000, "timeout");
      } catch {
        // ignore
      }
      reject(new Error("platform hub timeout"));
    }, timeoutMs);

    let authed = false;
    let subscribed = false;
    let responseText = "";
    let responseId: string | undefined = undefined;
    let responseMeta: Record<string, unknown> | undefined = undefined;
    let pendingSend: Record<string, unknown> | null = null;
    let subscribeTimer: NodeJS.Timeout | null = null;
    let effectiveConversationId = args.conversationId;

    function fail(message: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (subscribeTimer) clearTimeout(subscribeTimer);
      try {
        ws.close(1000, "error");
      } catch {
        // ignore
      }
      reject(new Error(message));
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (subscribeTimer) clearTimeout(subscribeTimer);
      try {
        ws.close(1000, "done");
      } catch {
        // ignore
      }
      resolve({
        conversationId: effectiveConversationId,
        messageId,
        responseId,
        text: responseText,
        metadata: responseMeta,
        raw: rawEvents,
      });
    }

    ws.on("open", () => {
      const auth = { type: "auth", api_key: args.apiKey, user_id: args.userId };
      ws.send(JSON.stringify(auth));
    });

    ws.on("error", () => {
      fail("platform hub connection error");
    });

    ws.on("close", (code, reason) => {
      if (settled) return;
      const suffix = reason ? ` (${String(reason)})` : "";
      fail(`platform hub connection closed: ${code}${suffix}`);
    });

    ws.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
      const parsed = safeJsonParse(text);
      const msg = (parsed || { type: "unknown", raw: text }) as HubInbound;
      rawEvents.push(msg);

      if (msg.type === "error") {
        const err = asString((msg as { error_message?: unknown }).error_message) || asString((msg as { error?: unknown }).error) || "platform hub error";
        fail(err);
        return;
      }

      if (!authed && msg.type === "auth_response") {
        const success = Boolean((msg as { success?: unknown }).success);
        if (!success) {
          const err = asString((msg as { error?: unknown }).error) || "platform auth failed";
          fail(err);
          return;
        }
        authed = true;
        const subscribe = { type: "subscribe", conversation_ids: [args.conversationId] };
        ws.send(JSON.stringify(subscribe));

        const message = {
          type: "message",
          conversation_id: args.conversationId,
          message_id: messageId,
          user: {
            id: args.userId,
            username: null,
            display_name: null,
          },
          content: {
            text: args.text,
            metadata: args.metadata ?? {},
          },
          composed_at: new Date().toISOString(),
        };
        pendingSend = message;

        // Some servers may omit subscription_response. Send after a short grace delay.
        subscribeTimer = setTimeout(() => {
          if (settled) return;
          if (!pendingSend) return;
          try {
            ws.send(JSON.stringify(pendingSend));
            pendingSend = null;
            subscribed = true;
          } catch {
            // ignore; timeout will handle
          }
        }, 400);
        return;
      }

      if (msg.type === "subscription_response") {
        const success = (msg as { success?: unknown }).success;
        const err = asString((msg as { error?: unknown }).error);
        if (success === false || err) {
          fail(err || "platform subscribe failed");
          return;
        }
        if (!subscribed && pendingSend) {
          ws.send(JSON.stringify(pendingSend));
          pendingSend = null;
        }
        subscribed = true;
        return;
      }

      if (msg.type === "response") {
        const conversationId = asString((msg as { conversation_id?: unknown }).conversation_id);
        if (conversationId && conversationId !== effectiveConversationId) {
          // Some backends may echo/emit a normalized conversation id. Accept the first response as the effective id.
          if (!responseText && !responseId) {
            effectiveConversationId = conversationId;
          } else {
            return;
          }
        }

        const content = asRecord((msg as { content?: unknown }).content);
        const chunk = asString(content["text"]);
        const chunkMeta = content["metadata"];
        if (chunkMeta && typeof chunkMeta === "object") {
          responseMeta = { ...(responseMeta ?? {}), ...(chunkMeta as Record<string, unknown>) };
        }
        if (chunk) responseText += chunk;

        const rid = asString((msg as { response_id?: unknown }).response_id);
        if (rid) responseId = rid;

        const isFinal = Boolean((msg as { final?: unknown }).final);
        if (isFinal) finish();
      }

      // Some deployments may send the assistant message as `type: "message"` (specialist-like).
      if (msg.type === "message") {
        const conversationId = asString((msg as { conversation_id?: unknown }).conversation_id);
        if (conversationId && conversationId !== effectiveConversationId) {
          if (!responseText && !responseId) {
            effectiveConversationId = conversationId;
          } else {
            return;
          }
        }
        const content = asRecord((msg as { content?: unknown }).content);
        const chunk = asString(content["text"]);
        if (!chunk) return;
        responseText += chunk;
        responseMeta = { ...(responseMeta ?? {}), ...(asRecord(content["metadata"]) as Record<string, unknown>) };
        finish();
      }
    });
  });
}
