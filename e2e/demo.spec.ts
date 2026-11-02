import { expect, test, type Page } from "@playwright/test";

async function sample(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page).toHaveURL(/\/tickets\/[\w-]+$/);
  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
}

const reply = (page: Page) => page.getByRole("textbox", { name: "Reply" });
const check = (page: Page, title: string) => page.getByRole("list", { name: "Checks" }).getByRole("listitem").filter({ hasText: title });
const audit = (page: Page) => page.getByTestId("audit-log");

test("a sample email is drafted from the order, edited, approved and sent to the outbox", async ({ page }) => {
  await sample(page, "Where is my order?");

  await expect(reply(page)).toHaveValue(/9400100000000000001002/);
  await expect(check(page, "Orders verified")).toContainText("Passed");
  await expect(page.getByText('lookup_order {"order_number":"#1002"}')).toBeVisible();
  await expect(page.getByText("Order #1002: verified for this customer.")).toBeVisible();

  await reply(page).fill(`${await reply(page).inputValue()}\n\nThanks for your patience!`);
  await page.getByRole("button", { name: "Approve and send" }).click();

  await expect(page.getByTestId("ticket-status")).toHaveText("Sent");
  await expect(page.getByTestId("final-reply")).toContainText("Thanks for your patience!");
  await expect(audit(page)).toContainText("Reply edited before approval");
  await expect(audit(page)).toContainText("Reply approved");
  await expect(audit(page)).toContainText("Saved to the outbox (not emailed)");

  await page.getByRole("link", { name: "← Demo inbox" }).click();
  await expect(page.getByRole("row").filter({ hasText: "When will my grinder arrive?" })).toContainText("Sent");
});

test("an edit that adds an amount the order data does not support blocks approval", async ({ page }) => {
  await sample(page, "Arrived damaged");
  await expect(check(page, "Amounts grounded")).toContainText("Passed");

  await reply(page).fill(`${await reply(page).inputValue()} We have refunded $500 to your card.`);

  await expect(check(page, "Amounts grounded")).toContainText("Blocks sending");
  await expect(check(page, "Amounts grounded")).toContainText("$500.00");
  await expect(page.getByRole("button", { name: "Approve and send" })).toBeDisabled();
});

test("the agent does not share another customer's order", async ({ page }) => {
  await sample(page, "Someone else's order");

  await expect(reply(page)).not.toHaveValue(/9400100000000000001002|Grinder|Austin/);
  await expect(reply(page)).toHaveValue(/email address used at checkout/);
  await expect(page.getByText("The order belongs to another email address. Nothing was shared with the model.")).toBeVisible();
});

test("a chargeback threat is flagged for a person, and a rejected draft can be drafted again", async ({ page }) => {
  await sample(page, "Chargeback threat");
  await expect(page.getByText("Needs a person")).toBeVisible();
  await expect(check(page, "Escalation")).toContainText("chargeback");

  await page.getByLabel(/Note for the agent/).fill("Too generic");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("Rejected");
  await expect(audit(page)).toContainText("Draft rejected: Too generic");

  await page.getByRole("button", { name: "Draft again" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Agent trace (run 2)" })).toBeVisible();
});

test("a rate-limited model call is retried, and the audit log shows it", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Write your own").click();
  await page.getByLabel("Subject").fill("Order status");
  await page.getByLabel("Message").fill("[flaky] Where is order #1002?");
  await page.getByRole("button", { name: "Send to the agent" }).click();

  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
  await expect(audit(page)).toContainText("Attempt 1 of the draft step failed: The model is rate limiting requests. Retrying in 5 s.");
  await expect(page.getByTestId("ticket-cost")).toHaveText("$0.0000"); // the mock model has no price
});

test("another browser cannot open a demo ticket", async ({ page, browser }) => {
  await sample(page, "No order number");
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(page.url());
  await expect(stranger.getByText("Ticket not found.")).toBeVisible();
  await other.close();
});
