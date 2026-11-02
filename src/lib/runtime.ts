// Where orders come from: demo tickets always use the sample orders; the live
// inbox uses the Shopify store when one is configured.
import orderData from "../../samples/orders.json" with { type: "json" };
import { fixtureOrders, shopifyOrders, type FindOrders, type Order } from "./orders.ts";
import { LIVE } from "./tickets.ts";

export const STORE = "Kettle & Pine";
export const sampleOrders = fixtureOrders(orderData as Order[]);

let live: FindOrders | undefined;

export function liveOrders(): FindOrders {
  const env = process.env;
  live ??= env.SHOPIFY_SHOP
    ? shopifyOrders({
        shop: env.SHOPIFY_SHOP,
        token: env.SHOPIFY_ADMIN_TOKEN || undefined,
        clientId: env.SHOPIFY_CLIENT_ID,
        clientSecret: env.SHOPIFY_CLIENT_SECRET,
        apiVersion: env.SHOPIFY_API_VERSION,
      })
    : sampleOrders;
  return live;
}

export const ordersFor = (workspace: string) => (workspace === LIVE ? liveOrders() : sampleOrders);

export function llmOptions() {
  const env = process.env;
  return {
    endpoint: env.LLM_ENDPOINT ?? "https://models.github.ai/inference",
    key: env.LLM_API_KEY ?? "",
    model: env.LLM_MODEL ?? "openai/gpt-4.1-mini",
  };
}
