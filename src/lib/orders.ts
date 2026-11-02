// Order lookups for the agent's tools: the Shopify Admin GraphQL API for the live
// store, or the sample orders for the demo. Plus Shopify webhook signatures.
import { createHmac, timingSafeEqual } from "node:crypto";

export type Order = {
  id: string;
  number: string;
  email: string;
  customerName: string | null;
  createdAt: string;
  cancelledAt: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  total: string;
  shipping: string;
  currency: string;
  items: { title: string; quantity: number; price: string }[];
  shipments: { status: string; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null }[];
  shipTo: string | null;
};

export type OrderQuery = { number: string } | { email: string } | { id: string };
export type FindOrders = (q: OrderQuery) => Promise<Order[]>;

const digits = (s: string) => s.replace(/^#/, "").trim();
const EMAIL = /^[^\s"\\@]+@[^\s"\\@]+\.[^\s"\\@]+$/;

export function fixtureOrders(orders: Order[]): FindOrders {
  const newest = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return async (q) => {
    if ("number" in q) return newest.filter((o) => digits(o.number) === digits(q.number));
    if ("email" in q) return newest.filter((o) => o.email.toLowerCase() === q.email.trim().toLowerCase()).slice(0, 5);
    return newest.filter((o) => o.id === q.id);
  };
}

// The values come from the model or a webhook, so only plain order numbers, plain
// email addresses and numeric IDs reach Shopify's search syntax.
export function searchQuery(q: OrderQuery): string | null {
  if ("number" in q) return /^\d{1,12}$/.test(digits(q.number)) ? `name:"#${digits(q.number)}"` : null;
  if ("email" in q) return EMAIL.test(q.email.trim()) ? `email:"${q.email.trim()}"` : null;
  return /^\d{1,20}$/.test(q.id) ? `id:${q.id}` : null;
}

const ORDERS = `query Orders($query: String!) {
  orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name email createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount } }
      lineItems(first: 20) { nodes { title quantity originalUnitPriceSet { shopMoney { amount } } } }
      fulfillments(first: 5) { displayStatus trackingInfo(first: 1) { company number url } }
      shippingAddress { name city countryCodeV2 }
    }
  }
}`;

type Money = { shopMoney?: { amount?: string; currencyCode?: string } } | null;
type Node = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  totalPriceSet: Money;
  totalShippingPriceSet: Money;
  lineItems: { nodes: { title: string; quantity: number; originalUnitPriceSet: Money }[] };
  fulfillments: { displayStatus: string | null; trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[];
  shippingAddress: { name: string | null; city: string | null; countryCodeV2: string | null } | null;
};

const amount = (m: Money) => Number(m?.shopMoney?.amount ?? 0).toFixed(2);

function toOrder(n: Node): Order {
  const a = n.shippingAddress;
  return {
    id: n.id.split("/").pop()!,
    number: n.name,
    email: n.email ?? "",
    customerName: a?.name ?? null,
    createdAt: n.createdAt,
    cancelledAt: n.cancelledAt,
    financialStatus: n.displayFinancialStatus ?? "UNKNOWN",
    fulfillmentStatus: n.displayFulfillmentStatus,
    total: amount(n.totalPriceSet),
    shipping: amount(n.totalShippingPriceSet),
    currency: n.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
    items: n.lineItems.nodes.map((l) => ({ title: l.title, quantity: l.quantity, price: amount(l.originalUnitPriceSet) })),
    shipments: n.fulfillments.map((f) => ({
      status: f.displayStatus ?? "UNKNOWN",
      carrier: f.trackingInfo[0]?.company ?? null,
      trackingNumber: f.trackingInfo[0]?.number ?? null,
      trackingUrl: f.trackingInfo[0]?.url ?? null,
    })),
    shipTo: a?.city ? [a.city, a.countryCodeV2].filter(Boolean).join(", ") : null,
  };
}

export type ShopifyConfig = { shop: string; token?: string; clientId?: string; clientSecret?: string; apiVersion?: string };

export function shopifyOrders(cfg: ShopifyConfig): FindOrders {
  const base = `https://${cfg.shop}.myshopify.com`;
  let cached: { token: string; until: number } | null = cfg.token ? { token: cfg.token, until: Infinity } : null;

  // Dev Dashboard apps get a 24-hour token through the client credentials grant.
  async function token() {
    if (cached && cached.until > Date.now()) return cached.token;
    const res = await fetch(`${base}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId ?? "", client_secret: cfg.clientSecret ?? "" }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Shopify token request returned ${res.status}.`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, until: Date.now() + (body.expires_in - 300) * 1000 };
    return cached.token;
  }

  return async (q) => {
    const query = searchQuery(q);
    if (!query) return [];
    const res = await fetch(`${base}/admin/api/${cfg.apiVersion ?? "2026-10"}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
      body: JSON.stringify({ query: ORDERS, variables: { query } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Shopify returned ${res.status}.`);
    const body = (await res.json()) as { data?: { orders: { nodes: Node[] } }; errors?: { message: string }[] };
    if (body.errors?.length || !body.data) throw new Error(`Shopify: ${body.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
    return body.data.orders.nodes.map(toOrder);
  };
}

// Shopify signs the raw request body with the app's client secret.
export function verifyWebhook(raw: string, hmac: string | null, secret: string): boolean {
  if (!hmac || !secret) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const given = Buffer.from(hmac, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
