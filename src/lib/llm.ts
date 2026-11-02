// One chat-completions call with tools. Any OpenAI-compatible endpoint works; the
// default is the Gemini API's free tier. Errors say whether a retry can help.
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
      // "auto", not "required": every OpenAI-compatible API accepts it, and the agent
      // loop asks again when the model answers without a tool call.
      body: JSON.stringify({ model: o.model, temperature: 0.2, messages, tools, tool_choice: "auto" }),
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
  const body = (await res.json().catch(() => {
    throw new LlmError("The model returned a response that is not JSON.", true);
  })) as { choices?: { message?: AssistantMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const message = body.choices?.[0]?.message;
  if (!message) throw new LlmError("The model returned no message.", true);
  // Gemini bills thinking as output but leaves it out of completion_tokens; the total has it.
  const u = body.usage ?? {};
  const tokensIn = u.prompt_tokens ?? 0;
  return { message, usage: { tokensIn, tokensOut: Math.max(u.completion_tokens ?? 0, (u.total_tokens ?? 0) - tokensIn) } };
}

// Paid-tier list prices in USD per million tokens (Gemini API, November 2026), for
// the cost-per-ticket figures. On the free tier the actual cost is zero; these show
// what the same tickets would cost on a paid key.
const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
};

export function costUsd(model: string, u: Usage) {
  const p = PRICES[model];
  return p ? (u.tokensIn * p.in + u.tokensOut * p.out) / 1_000_000 : 0;
}
