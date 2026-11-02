// One chat-completions call with tools. Any OpenAI-compatible endpoint works; the
// default is GitHub Models' free tier. Errors say whether a retry can help.
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type AssistantMessage = { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
export type Message =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };
export type Tool = { type: "function"; function: { name: string; description: string; parameters: object } };
export type LlmOptions = { endpoint: string; key: string; model: string };
export type Usage = { tokensIn: number; tokensOut: number };

export class LlmError extends Error {
  retryable: boolean;
  retryAfterMs?: number;
  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

// Waiting longer than this for a rate limit means the day's free allowance is gone.
const MAX_WAIT_MS = 5 * 60_000;

export async function chat(o: LlmOptions, messages: Message[], tools: Tool[]): Promise<{ message: AssistantMessage; usage: Usage }> {
  let res: Response;
  try {
    res = await fetch(`${o.endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.key}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: o.model, temperature: 0.2, messages, tools, tool_choice: "required" }),
    });
  } catch (e) {
    throw new LlmError(`The model could not be reached (${e instanceof Error ? e.message : e}).`, true);
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
    if (wait && wait > MAX_WAIT_MS) throw new LlmError("The free model allowance is used up for now. Try again later.", false);
    throw new LlmError("The model is rate limiting requests.", true, wait);
  }
  if (!res.ok) throw new LlmError(`The model returned ${res.status}.`, res.status >= 500);
  const body = (await res.json()) as { choices?: { message?: AssistantMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const message = body.choices?.[0]?.message;
  if (!message) throw new LlmError("The model returned no message.", true);
  return { message, usage: { tokensIn: body.usage?.prompt_tokens ?? 0, tokensOut: body.usage?.completion_tokens ?? 0 } };
}

// List prices in USD per million tokens, for the cost-per-ticket figures. On GitHub
// Models' free tier the actual cost is zero; these show what a paid API would charge.
const PRICES: Record<string, { in: number; out: number }> = {
  "openai/gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "openai/gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "openai/gpt-4.1": { in: 2, out: 8 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
};

export function costUsd(model: string, u: Usage) {
  const p = PRICES[model];
  return p ? (u.tokensIn * p.in + u.tokensOut * p.out) / 1_000_000 : 0;
}
