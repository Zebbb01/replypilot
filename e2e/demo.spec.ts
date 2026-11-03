import { expect, test, type Page } from "@playwright/test";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const list = (page: Page) => page.getByRole("complementary", { name: "Demo tickets" });

async function newEmail(page: Page) {
  await page.goto("/");
  await list(page).getByRole("button", { name: "New email" }).click();
  return page.getByRole("dialog", { name: "New test email" });
}

async function sample(page: Page, title: string) {
  const dialog = await newEmail(page);
  await dialog.getByRole("button", { name: new RegExp(`^${escape(title)}`) }).click();
  await expect(page).toHaveURL(/\/tickets\/[\w-]+$/);
  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
}

const reply = (page: Page) => page.getByRole("textbox", { name: "Reply" });
const check = (page: Page, title: string) => page.getByRole("list", { name: "Checks" }).getByRole("listitem").filter({ hasText: title });
async function activity(page: Page) {
  await page.getByRole("tab", { name: "Activity" }).click();
  return page.getByTestId("audit-log");
}

test("a sample email is drafted from the order, edited, approved and sent to the outbox", async ({ page }) => {
  await sample(page, "Where is my order?");

  await expect(reply(page)).toHaveValue(/9400100000000000001002/);
  await expect(check(page, "Orders verified")).toContainText("Passed");
  await expect(page.getByText('lookup_order {"order_number":"#1002"}')).toBeVisible();
  await expect(page.getByText("Order #1002: verified for this customer.")).toBeVisible();
  await expect(page.getByText("All 6 checks pass")).toBeVisible();

  await reply(page).fill(`${await reply(page).inputValue()}\n\nThanks for your patience!`);
  await page.getByRole("button", { name: "Approve and send" }).click();

  await expect(page.getByTestId("ticket-status")).toHaveText("Sent");
  await expect(page.getByTestId("final-reply")).toContainText("Thanks for your patience!");
  const audit = await activity(page);
  await expect(audit).toContainText("Reply edited before approval");
  await expect(audit).toContainText("Reply approved");
  await expect(audit).toContainText("Saved to the outbox (not emailed)");

  await expect(list(page).getByRole("link", { name: /When will my grinder arrive\?/ })).toContainText("Sent");
});

test("an edit that adds an amount the order data does not support blocks approval", async ({ page }) => {
  await sample(page, "Arrived damaged");
  await expect(check(page, "Amounts grounded")).toContainText("Passed");

  await reply(page).fill(`${await reply(page).inputValue()} We have refunded $500 to your card.`);

  await expect(check(page, "Amounts grounded")).toContainText("Blocks sending");
  await expect(check(page, "Amounts grounded")).toContainText("$500.00");
  await expect(page.getByText("1 check blocks sending")).toBeVisible();
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
  await expect(page.getByRole("main").getByText("Needs a person", { exact: true })).toBeVisible();
  await expect(check(page, "Escalation")).toContainText("chargeback");

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const reject = page.getByRole("dialog", { name: "Reject this draft?" });
  await reject.getByLabel(/Reason/).fill("Too generic");
  await reject.getByRole("button", { name: "Reject draft" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("Rejected");
  await expect(await activity(page)).toContainText("Draft rejected: Too generic");

  await page.getByRole("button", { name: "Redraft" }).click();
  await page.getByRole("dialog", { name: "Ask for a new draft" }).getByRole("button", { name: "Redraft" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
  await page.getByRole("tab", { name: "Trace" }).click();
  await expect(page.getByText("Run 2")).toBeVisible();
});

test("a rate-limited model call is retried, and the audit log shows it", async ({ page }) => {
  const dialog = await newEmail(page);
  await dialog.getByRole("button", { name: "Write your own" }).click();
  await dialog.getByLabel("Subject").fill("Order status");
  await dialog.getByLabel("Message").fill("[flaky] Where is order #1002?");
  await dialog.getByRole("button", { name: "Send to agent" }).click();

  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
  await expect(await activity(page)).toContainText("Attempt 1 of the draft step failed: The model is rate limiting requests. Retrying in 5 s.");
  await expect(page.getByTestId("ticket-cost")).toHaveText("$0"); // the mock model has no price
});

test("another browser cannot open a demo ticket", async ({ page, browser }) => {
  await sample(page, "No order number");
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(page.url());
  await expect(stranger.getByText("Ticket not found.")).toBeVisible();
  await other.close();
});
