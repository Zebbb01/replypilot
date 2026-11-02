import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, costUsd, LlmError, type Tool } from "./llm.ts";

const o = { endpoint: "https://models.example/inference/", key: "k", model: "openai/gpt-4.1-mini" };
const tools: Tool[] = [{ type: "function", function: { name: "recent_orders", description: "d", parameters: { type: "object", properties: {} } } }];

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("chat", () => {
  it("sends the conversation with tools and returns the message and token usage", async () => {
    const message = { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "recent_orders", arguments: "{}" } }] };
    const fetch = respond(200, { choices: [{ message }], usage: { prompt_tokens: 120, completion_tokens: 15 } });

    const result = await chat(o, [{ role: "user", content: "hi" }], tools);

    expect(result).toEqual({ message, usage: { tokensIn: 120, tokensOut: 15 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://models.example/inference/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer k" });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: o.model, tools, tool_choice: "required", messages: [{ role: "user", content: "hi" }] });
  });

  it("marks rate limits as retryable and honors Retry-After", async () => {
    respond(429, { error: "slow down" }, { "retry-after": "7" });
    await expect(chat(o, [], tools)).rejects.toMatchObject({ retryable: true, retryAfterMs: 7000 });
  });

  it("gives up when the free allowance resets too far away to wait for", async () => {
    respond(429, { error: "daily limit" }, { "retry-after": "40000" });
    const error = await chat(o, [], tools).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/free model allowance/);
  });

  it("treats a body that is not JSON as a retryable failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200, headers: { "content-type": "text/plain" } })));
    await expect(chat(o, [], tools)).rejects.toMatchObject({ retryable: true, message: "The model returned a response that is not JSON." });
  });

  it("retries server errors and network failures but not bad requests", async () => {
    respond(503, {});
    await expect(chat(o, [], tools)).rejects.toMatchObject({ retryable: true });
    respond(400, { error: "bad" });
    await expect(chat(o, [], tools)).rejects.toMatchObject({ retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(chat(o, [], tools)).rejects.toMatchObject({ retryable: true });
  });
});

describe("costUsd", () => {
  it("prices tokens at the model's list price per million", () => {
    expect(costUsd("openai/gpt-4.1-mini", { tokensIn: 1_000_000, tokensOut: 500_000 })).toBeCloseTo(1.2);
    expect(costUsd("unknown-model", { tokensIn: 1000, tokensOut: 1000 })).toBe(0);
  });
});
