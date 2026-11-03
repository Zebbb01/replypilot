import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { env } from "../playwright.config";

const run = Date.now();
const basic = (secret: string) => `Basic ${Buffer.from(`postmark:${secret}`).toString("base64")}`;

function shopifyEvent(webhookId: string, secret = env.SHOPIFY_CLIENT_SECRET) {
  const data = JSON.stringify({ id: run, order_id: 5550001006, status: "delayed", message: "Weather delay at hub" });
  return {
    data,
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": "fulfillment_events/create",
      "x-shopify-webhook-id": webhookId,
      "x-shopify-hmac-sha256": createHmac("sha256", secret).update(data).digest("base64"),
    },
  };
}

test("signed webhooks open live tickets that only the operator can review and send", async ({ page, request }) => {
  const forged = await request.post("/api/webhooks/shopify", shopifyEvent(`wh-${run}`, "wrong-secret"));
  expect(forged.status()).toBe(401);

  const first = await request.post("/api/webhooks/shopify", shopifyEvent(`wh-${run}`));
  expect(first.status()).toBe(201);
  const { id } = await first.json();
  const again = await request.post("/api/webhooks/shopify", shopifyEvent(`wh-${run}`));
  expect(await again.json()).toEqual({ id, created: false });

  const email = {
    FromFull: { Email: "maria.santos@example.com", Name: "Maria Santos" },
    Subject: `Kettle question ${run}`,
    MessageID: `pm-${run}`,
    StrippedTextReply: "Did my kettle from order #1001 arrive?",
    Headers: [{ Name: "Message-ID", Value: `<${run}@mail.example>` }],
  };
  expect((await request.post("/api/webhooks/email", { data: email, headers: { authorization: basic("nope") } })).status()).toBe(401);
  expect((await request.post("/api/webhooks/email", { data: email, headers: { authorization: basic(env.INBOUND_EMAIL_SECRET) } })).status()).toBe(201);

  await page.goto("/live");
  await page.getByLabel("Operator key").fill("guess");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\w/ })).toHaveText("That key is not right.");
  await page.getByLabel("Operator key").fill(env.OPERATOR_KEY);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("complementary", { name: "Live tickets" }).getByRole("link", { name: new RegExp(`Kettle question ${run}`) })).toBeVisible();

  await page.goto(`/live/tickets/${id}`);
  await expect(page.getByText("Shopify event", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
  await expect(page.getByRole("textbox", { name: "Reply" })).toHaveValue(/770000001006/);
  await page.getByRole("button", { name: "Approve and email" }).click();
  await page.getByRole("dialog", { name: "Email this reply?" }).getByRole("button", { name: "Send email" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("Sent");
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByTestId("audit-log")).toContainText("Reply approved · operator");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog", { name: "Sign out of the live inbox?" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Operator key")).toBeVisible();
});

test("the live inbox stays closed without the operator key", async ({ page, request }) => {
  expect((await request.get("/api/tickets?view=live")).status()).toBe(401);
  const created = await request.post("/api/webhooks/shopify", shopifyEvent(`wh-closed-${run}`));
  const { id } = await created.json();
  await page.goto(`/live/tickets/${id}`);
  await expect(page.getByText("Ticket not found.")).toBeVisible();
});
