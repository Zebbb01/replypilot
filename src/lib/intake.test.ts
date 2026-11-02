import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { basicAuthOk, parseInboundEmail, ticketFromShopifyEvent } from "./intake.ts";
import { fixtureOrders, type Order } from "./orders.ts";

const findOrders = fixtureOrders(JSON.parse(readFileSync("samples/orders.json", "utf8")) as Order[]);

// The shape Postmark posts for an inbound email (trimmed).
const postmark = {
  FromName: "Alex Kim",
  FromFull: { Email: "Alex.Kim@example.com", Name: "Alex Kim" },
  Subject: "Where is my grinder?",
  MessageID: "73e6d360-66eb-11e1-8e72-a8904824019b",
  TextBody: "Hi, where is order #1002?\n\nOn Mon, someone wrote:\n> old text",
  StrippedTextReply: "Hi, where is order #1002?",
  Headers: [{ Name: "Message-ID", Value: "<CAF=abc@mail.gmail.com>" }],
};

describe("parseInboundEmail", () => {
  it("takes the sender, the new part of the message and the thread ID", () => {
    expect(parseInboundEmail(postmark)).toEqual({
      customerEmail: "alex.kim@example.com",
      customerName: "Alex Kim",
      subject: "Where is my grinder?",
      body: "Hi, where is order #1002?",
      externalId: "73e6d360-66eb-11e1-8e72-a8904824019b",
      threadId: "<CAF=abc@mail.gmail.com>",
    });
  });

  it("falls back to the full text and a placeholder subject", () => {
    const parsed = parseInboundEmail({ ...postmark, StrippedTextReply: "", Subject: "", Headers: [] });
    expect(parsed).toMatchObject({ subject: "(no subject)", body: postmark.TextBody, threadId: null });
  });

  it("refuses a message without a usable sender or text", () => {
    expect(parseInboundEmail({ ...postmark, FromFull: { Email: "not-an-address" } })).toBeNull();
    expect(parseInboundEmail({ ...postmark, TextBody: "", StrippedTextReply: "" })).toBeNull();
    expect(parseInboundEmail("nope")).toBeNull();
  });
});

describe("ticketFromShopifyEvent", () => {
  const event = { id: 1, order_id: 5550001006, status: "delayed", message: "Weather delay at hub" };

  it("opens a proactive ticket for a delivery problem", async () => {
    expect(await ticketFromShopifyEvent("fulfillment_events/create", event, findOrders)).toEqual({
      source: "shopify",
      customerEmail: "priya.nair@example.com",
      customerName: "Priya Nair",
      subject: "Delivery update for order #1006",
      body: 'Shopify reported a delivery problem for order #1006: the carrier status is "delayed" ("Weather delay at hub"). Write to the customer about it before they have to ask.',
    });
  });

  it("ignores routine updates, other topics and unknown orders", async () => {
    expect(await ticketFromShopifyEvent("fulfillment_events/create", { ...event, status: "in_transit" }, findOrders)).toBeNull();
    expect(await ticketFromShopifyEvent("orders/create", event, findOrders)).toBeNull();
    expect(await ticketFromShopifyEvent("fulfillment_events/create", { ...event, order_id: 42 }, findOrders)).toBeNull();
  });
});

describe("basicAuthOk", () => {
  const header = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

  it("accepts any user name with the right password", () => {
    expect(basicAuthOk(header("postmark", "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a wrong or missing password, and an unset secret", () => {
    expect(basicAuthOk(header("postmark", "nope"), "s3cret")).toBe(false);
    expect(basicAuthOk(null, "s3cret")).toBe(false);
    expect(basicAuthOk(header("u", ""), "")).toBe(false);
  });
});
