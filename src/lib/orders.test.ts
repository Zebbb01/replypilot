import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureOrders, searchQuery, shopifyOrders, verifyWebhook, type Order } from "./orders.ts";

const samples = JSON.parse(readFileSync("samples/orders.json", "utf8")) as Order[];

afterEach(() => vi.unstubAllGlobals());

describe("fixtureOrders", () => {
  const find = fixtureOrders(samples);

  it("finds an order by number, with or without the hash", async () => {
    expect((await find({ number: "#1002" })).map((o) => o.number)).toEqual(["#1002"]);
    expect((await find({ number: "1002" })).map((o) => o.number)).toEqual(["#1002"]);
    expect(await find({ number: "9999" })).toEqual([]);
  });

  it("finds a customer's orders by email, newest first, ignoring case", async () => {
    expect((await find({ email: "Alex.Kim@Example.com" })).map((o) => o.number)).toEqual(["#1002", "#1005"]);
  });

  it("finds an order by its Shopify ID", async () => {
    expect((await find({ id: "5550001006" }))[0].number).toBe("#1006");
  });
});

describe("searchQuery", () => {
  it("builds a Shopify search only from well-formed values", () => {
    expect(searchQuery({ number: "#1002" })).toBe('name:"#1002"');
    expect(searchQuery({ email: "alex.kim@example.com" })).toBe('email:"alex.kim@example.com"');
    expect(searchQuery({ id: "5550001002" })).toBe("id:5550001002");
  });

  it("refuses values that could change the search", () => {
    expect(searchQuery({ number: "1002 OR email:*" })).toBeNull();
    expect(searchQuery({ email: 'a"@example.com' })).toBeNull();
    expect(searchQuery({ id: "1 OR 2" })).toBeNull();
  });
});

const node = {
  id: "gid://shopify/Order/5550001002",
  name: "#1002",
  email: "alex.kim@example.com",
  createdAt: "2026-10-27T09:40:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "FULFILLED",
  totalPriceSet: { shopMoney: { amount: "149.0", currencyCode: "USD" } },
  totalShippingPriceSet: { shopMoney: { amount: "0.0" } },
  lineItems: { nodes: [{ title: "Conical Burr Grinder", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "149.0" } } }] },
  fulfillments: [{ displayStatus: "IN_TRANSIT", trackingInfo: [{ company: "USPS", number: "9400100000000000001002", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000001002" }] }],
  shippingAddress: { name: "Alex Kim", city: "Austin", countryCodeV2: "US" },
};

describe("shopifyOrders", () => {
  it("gets a client-credentials token once, then maps the Admin API orders", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/admin/oauth/access_token")
        ? Response.json({ access_token: "shpat_x", scope: "read_orders", expires_in: 86399 })
        : Response.json({ data: { orders: { nodes: [node] } } }),
    );
    vi.stubGlobal("fetch", fetch);
    const find = shopifyOrders({ shop: "kettle-and-pine", clientId: "id", clientSecret: "secret", apiVersion: "2026-10" });

    const [order] = await find({ number: "#1002" });
    await find({ email: "alex.kim@example.com" });

    expect(order).toEqual(samples.find((o) => o.number === "#1002"));
    expect(fetch).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://kettle-and-pine.myshopify.com/admin/oauth/access_token");
    expect(String(tokenInit.body)).toBe("grant_type=client_credentials&client_id=id&client_secret=secret");
    const [apiUrl, apiInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(apiUrl).toBe("https://kettle-and-pine.myshopify.com/admin/api/2026-10/graphql.json");
    expect(apiInit.headers).toMatchObject({ "X-Shopify-Access-Token": "shpat_x" });
    expect(JSON.parse(String(apiInit.body)).variables).toEqual({ query: 'name:"#1002"' });
  });

  it("does not call Shopify for a malformed lookup", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await shopifyOrders({ shop: "s", token: "t" })({ number: "x OR y" })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws on GraphQL errors so the step is retried", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ errors: [{ message: "Throttled" }] })));
    await expect(shopifyOrders({ shop: "s", token: "t" })({ number: "1" })).rejects.toThrow(/Throttled/);
  });
});

describe("verifyWebhook", () => {
  const body = JSON.stringify({ id: 1, status: "delayed" });
  const hmac = createHmac("sha256", "secret").update(body).digest("base64");

  it("accepts Shopify's signature over the raw body", () => {
    expect(verifyWebhook(body, hmac, "secret")).toBe(true);
  });

  it("rejects a wrong, missing or other-secret signature", () => {
    expect(verifyWebhook(`${body} `, hmac, "secret")).toBe(false);
    expect(verifyWebhook(body, null, "secret")).toBe(false);
    expect(verifyWebhook(body, hmac, "other")).toBe(false);
    expect(verifyWebhook(body, "short", "secret")).toBe(false);
  });
});
