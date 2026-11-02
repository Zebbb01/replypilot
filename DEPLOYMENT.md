# Deploying ReplyPilot to Azure (free tier)

Everything below stays within free tiers on an Azure free account. Allow about 30 minutes; PostgreSQL alone
takes 5 to 10 minutes to create.

## What gets created

`infra/` is a Terraform configuration that creates one resource group in Southeast Asia with:

| Resource | Tier |
| --- | --- |
| Container Apps environment and one app (web + worker containers, 0 to 1 replica) | Consumption (monthly free grant) |
| Azure Database for PostgreSQL Flexible Server, database `replypilot` | B1ms, 32 GB (free for 12 months on a free account) |
| Log Analytics workspace | Pay-as-you-go with a 0.1 GB daily cap (under the 5 GB free) |
| A managed identity for GitHub Actions and its role assignment | Free |
| Optional: a 1-unit monthly budget that emails you at the first cent of cost | Free |

**Check first:**

- The free PostgreSQL allowance is 750 hours a month: **one** B1ms server running all month. If the
  subscription already has a PostgreSQL Flexible Server, the second one is billed.
- The Container Apps and Log Analytics allowances are shared with any other app in the subscription (such as
  LedgerLens). Both apps scale to zero, so together they stay well inside them.
- On a **Free Trial** subscription with the spending limit on, nothing can charge your card: when the $200
  credit or the 30 days run out, Azure disables the subscription and the app stops. Do not upgrade to
  pay-as-you-go to keep it running; run `terraform destroy` or let it lapse.

## 1. Publish the image

1. Push the repository to GitHub as `Zebbb01/replypilot`. For another name, change `image` in
   `infra/variables.tf`.
2. Merge a release into `main`. The **Deploy** workflow builds the image and pushes it to
   `ghcr.io/zebbb01/replypilot`. Its Azure step is skipped until step 4 is done. If the workflow did not
   start on the push (new repositories sometimes miss their first events), run it from **Actions** →
   **Deploy** → **Run workflow**.
3. Container Apps pulls the image without credentials, so it must be public. If GitHub → your profile →
   **Packages** → `replypilot` shows **Private**, open **Package settings** → **Change visibility** →
   **Public**.
4. Print the subject GitHub uses in this repository's OpenID Connect tokens; Terraform needs it:

   ```bash
   gh api repos/Zebbb01/replypilot/actions/oidc/customization/sub
   ```

   New repositories use immutable IDs, so the prefix looks like `repo:Zebbb01@179115543/replypilot@123456789`.

## 2. Get a model key

Create a Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey). It needs no card. Keep
billing off for the key's Google Cloud project: without billing, the key stays on the free tier and nothing
can be charged. Your project's free-tier limits are at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).

Google may use free-tier prompts to improve its products. That is fine for the demo's made-up customers; see
step 6 before putting real customer emails through it.

## 3. Create the Azure resources

From [Azure Cloud Shell](https://shell.azure.com) (Bash; Terraform and the Azure CLI are already there) or a
machine with both installed and `az login` done:

```bash
git clone https://github.com/Zebbb01/replypilot.git
cd replypilot/infra
terraform init
terraform apply \
  -var 'github_oidc_subject_prefix=repo:Zebbb01@179115543/replypilot@123456789' \
  -var 'llm_api_key=AIza...' \
  -var 'alert_email=you@example.com'
```

If Azure refuses the PostgreSQL server in Southeast Asia (`LocationIsOfferRestricted`), add
`-var location=eastasia` (or another region) and apply again.

Keep the Terraform state (`terraform.tfstate`): it is how you update or remove the resources later.

## 4. Connect GitHub Actions

```bash
terraform output github_variables
```

Add each value as a repository **variable** (not a secret; none of them is sensitive): GitHub →
**Settings** → **Secrets and variables** → **Actions** → **Variables**. From now on every push to `main`
rolls the new image out to both containers, signing in to Azure with OpenID Connect.

## 5. Check it

```bash
terraform output app_url
terraform output -raw operator_key   # signs in to the live inbox
```

Open the URL and send one of the sample emails. The first request after a quiet spell wakes the app (up to
30 seconds); the draft takes a few seconds more.

To score the agent on the free model and fill in the README's eval section:

```bash
LLM_API_KEY=AIza... npm run eval
```

## 6. Optional: the live inbox

Without these settings the live inbox still works with the sample orders, and approved replies stay in the
outbox. Each part below is free. Pass the values to `terraform apply` with `-var`, as in step 3.

Real customer emails would go to the model too. On the free tier Google may use them to improve its products,
so keep the free setup to your own test emails; real customers need a paid Gemini key (billed, so not part of
this free deployment).

**Shopify dev store** (`shopify_shop`, `shopify_client_id`, `shopify_client_secret`)

1. In the [Shopify Dev Dashboard](https://dev.shopify.com), create an app. In its version, select the
   `read_orders` scope and, under protected customer data, the customer's name, email and address.
2. Create a dev store **from the Dev Dashboard** (the client credentials grant only works when the app and the
   store belong to the same organization) and install the app on it.
3. `shopify_shop` is the store's subdomain, the part before `.myshopify.com`. The client ID and secret are on
   the app's settings page. The app gets a 24-hour token by itself; nothing to copy.
4. Subscribe to delivery events with the app's token:

   ```bash
   TOKEN=$(curl -s -X POST "https://$SHOP.myshopify.com/admin/oauth/access_token" \
     -d grant_type=client_credentials -d client_id=$CLIENT_ID -d client_secret=$CLIENT_SECRET | jq -r .access_token)
   curl -s "https://$SHOP.myshopify.com/admin/api/2026-10/graphql.json" \
     -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" \
     -d '{"query":"mutation { webhookSubscriptionCreate(topic: FULFILLMENT_EVENTS_CREATE, webhookSubscription: { uri: \"https://YOUR-APP/api/webhooks/shopify\" }) { webhookSubscription { id } userErrors { message } } }"}'
   ```

   Shopify signs these webhooks with the app's client secret, which is how ReplyPilot checks them.
5. Place a test order, fulfill it with a tracking number, and add a `DELAYED` fulfillment event (the Admin
   API's `fulfillmentEventCreate` mutation). A ticket appears in the live inbox.

**Inbound email** (`inbound_email_secret`)

1. On [Postmark](https://postmarkapp.com)'s free developer plan, create a server and open its **Inbound**
   stream. It shows an inbound address such as `abc123@inbound.postmarkapp.com`.
2. Set the inbound webhook URL to `https://postmark:SECRET@YOUR-APP/api/webhooks/email`, where `SECRET` is the
   value you pass as `inbound_email_secret` (letters and digits only).
3. Email that address, or have a Gmail account forward to it. A ticket appears in the live inbox.

**Sending replies** (`smtp_url`, `smtp_from`)

With 2-Step Verification on a Gmail account, create an app password (Google Account → **Security** → **App
passwords**). Then `smtp_url` is `smtps://you%40gmail.com:APPPASSWORD@smtp.gmail.com:465` (no spaces in the
password) and `smtp_from` is `Kettle & Pine Support <you@gmail.com>`. Approved live replies are then emailed,
threaded to the customer's message. Demo replies never are.

## Logs

Open the Log Analytics workspace → **Logs**:

```kusto
ContainerAppConsoleLogs_CL
| where ContainerName_s == "worker"
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```

The per-ticket story (retries, approvals, sends) is in the app's own audit log on each ticket.

## Remove everything

```bash
cd replypilot/infra
terraform destroy
```
