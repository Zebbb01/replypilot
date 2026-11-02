// Regenerates the screenshots in docs/screenshots, light and dark. Skipped unless SCREENSHOTS=1:
//   SCREENSHOTS=1 npx playwright test screenshots
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to regenerate screenshots.");
// caret: "initial" stops Playwright from styling inputs, which React would report
// as a hydration mismatch.
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

async function sample(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("Needs approval", { timeout: 60_000 });
  return page.url();
}

const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/${name}.png`, caret: "initial", fullPage: true });

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const suffix = scheme === "dark" ? "-dark" : "";

    await sample(page, "Chargeback threat");
    await sample(page, "Someone else's order");
    const review = await sample(page, "Where is my order?");
    await shot(page, `review${suffix}`);

    const reply = page.getByRole("textbox", { name: "Reply" });
    await reply.fill(`${await reply.inputValue()} We have refunded $500 to your card.`);
    await expect(page.getByRole("button", { name: "Approve and send" })).toBeDisabled();
    await shot(page, `review-blocked${suffix}`);

    await page.goto(review);
    await page.getByRole("button", { name: "Approve and send" }).click();
    await expect(page.getByTestId("ticket-status")).toHaveText("Sent");
    await shot(page, `sent${suffix}`);

    await page.goto("/");
    await expect(page.getByRole("row")).toHaveCount(4);
    await shot(page, `home${suffix}`);
  });
}
