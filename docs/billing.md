# Billing

Ciciro has two plans: **Free**, with a small monthly AI allowance, and
**Ciciro Pro**, monthly or yearly, with a much larger one. The web sells Pro
through Stripe; the iOS and Android apps sell it through the App Store and
Google Play, via RevenueCat. Whichever way someone pays, the Ciciro server is
the only authority on what they have: every source writes a `Subscription`
row, and `getEntitlement` (`src/lib/entitlements.ts`) reads them.

```
Stripe Checkout ──► Stripe webhook ─────────────────┐
                    /api/billing/webhooks/stripe    ├─► Subscription rows ─► getEntitlement(userId)
App Store / Play ─► RevenueCat ─► RevenueCat webhook┘        (D1)             /api/billing/entitlement
                                  /api/billing/webhooks/revenuecat            /api/auth/me
```

Nothing is hard-coded about prices: they live in Stripe and the stores. The
allowances and every key come from the environment, and each missing piece
switches its part off:

| Missing | Effect |
|---|---|
| Stripe settings | No pricing page (404), no web upgrade, Checkout and Portal return 404. |
| RevenueCat server settings | The app shows no paywall (`billing.store` is false), and store webhooks return 404. |
| RevenueCat key in the app build | The app never shows a paywall or Restore Purchases. |
| `CICIRO_REQUIRE_AUTH` (local mode) | Nothing is metered and there is no plan to show. |

With neither Stripe nor RevenueCat set up, everyone on a hosted server is on
the free plan and its allowance applies. **Merging billing therefore caps AI
use at the free allowance in production.** Set
`CICIRO_FREE_AI_RUNS_PER_MONTH=unlimited` to keep it open until billing
launches.

## Placeholders to decide before launch

- `CICIRO_FREE_AI_RUNS_PER_MONTH`: defaults to **30**.
- `CICIRO_PRO_AI_RUNS_PER_MONTH`: defaults to **1500**.
- The prices themselves: set them in Stripe, App Store Connect and Play
  Console. Keep the same list price in the app and on the web.

## The AI allowance

An "AI action" is one request someone makes of Ciciro: sending a chat message,
an autowrite, a continuity check, a style analysis, a weekly review, or asking
for stuck prompts. Compacting the chat, resuming a turn, and background work
(chapter summaries, spelling, the recap, the reminder nudge) cost nothing, but
stop once the allowance is used up.

Usage is counted per account per calendar month in UTC (`UsageCounter`,
period `YYYY-MM`). `meterAiRun` claims one action atomically before the work
starts; a request that fails gives it back (`withAiRun`). Once the allowance
is used, AI routes answer **402** with `code: "ai_limit_reached"` and the
entitlement; the web shows `AiLimitDialog`, the app shows the limit notice in
chat with a way to Pro. The manuscript, notes and story bible stay fully
editable.

## Environment variables

Server (`wrangler secret put <NAME>` on Cloudflare, or the container env):

| Variable | Notes |
|---|---|
| `CICIRO_FREE_AI_RUNS_PER_MONTH` | Free allowance. A whole number, or `unlimited`. |
| `CICIRO_PRO_AI_RUNS_PER_MONTH` | Pro allowance. A whole number, or `unlimited`. |
| `STRIPE_SECRET_KEY` | `sk_live_…` (or `sk_test_…`). A restricted key works if it can write Customers, Checkout Sessions, Billing Portal sessions and Subscriptions, and read Prices and Charges. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook endpoint below. |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_…` of the monthly Pro price. |
| `STRIPE_PRICE_PRO_YEARLY` | `price_…` of the yearly Pro price. |
| `STRIPE_TAX_MODE` | `managed_payments` (default), `automatic_tax`, or `none`. See [Tax](#tax). |
| `REVENUECAT_SECRET_API_KEY` | RevenueCat secret API key (v1, `sk_…`), for re-reading a customer. |
| `REVENUECAT_WEBHOOK_AUTH` | The exact Authorization header value set on the RevenueCat webhook. |
| `REVENUECAT_YEARLY_PRODUCT_IDS` | Comma-separated store product ids that bill yearly, e.g. `app.ciciro.pro.yearly,pro:yearly`. Everything else is shown as monthly. |
| `ANDROID_PACKAGE` | Defaults to `app.ciciro.mobile`; used for the Play "manage subscription" link. |
| `STRIPE_API_BASE`, `REVENUECAT_API_BASE` | Tests and local stand-ins only. |

App (`apps/mobile/.env`, baked into the build):

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat public SDK key for the iOS app (`appl_…`). |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat public SDK key for the Android app (`goog_…`). |
| `EXPO_PUBLIC_BILLING_PREVIEW` | `1` shows the paywall with sample prices in a development build that has no key, for layout work. Purchasing is off. |

## Stripe (web)

1. **Product and prices.** In the Stripe dashboard, create a product "Ciciro
   Pro" with two recurring prices: monthly and yearly. Put their ids in
   `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_YEARLY`. The pricing page
   reads the amounts from Stripe, so changing a price is a Stripe change plus
   swapping the id.
2. **Customer Portal** (Settings → Billing → Customer portal): allow updating
   the payment method, viewing invoices, cancelling (at the end of the
   period), and switching between the two Pro prices. Add the Terms
   (`https://ciciro.app/terms`) and Privacy (`https://ciciro.app/privacy`)
   links. "Manage billing" on the pricing page and in Settings opens it.
3. **Webhook** (Developers → Webhooks → Add endpoint):
   `https://ciciro.app/api/billing/webhooks/stripe`, listening to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`, `charge.refunded` and
   `charge.dispute.created`. Its signing secret is `STRIPE_WEBHOOK_SECRET`.
4. **Emails.** Turn on Stripe's receipts and its failed-payment emails, or
   leave them to Ciciro's (see [Emails](#emails)).
5. **Test mode first.** Use test keys and prices, then locally:
   `stripe listen --forward-to localhost:3000/api/billing/webhooks/stripe`
   (it prints the `whsec_…` to use) and pay with `4242 4242 4242 4242`.

How the webhook works (`src/lib/billing/stripe.ts`):

- It verifies the signature with `constructEventAsync` and Web Crypto (the
  Worker has no Node crypto), from the raw body.
- Each event id is claimed once in `BillingEvent`, so Stripe's retries and
  duplicates are no-ops; a handler that throws releases the claim so the
  retry runs.
- It never trusts the event's payload for state: it re-reads the customer's
  subscriptions from Stripe and stores those, so events can arrive in any
  order.
- A customer is tied to an account by `User.stripeCustomerId`, set when
  Checkout creates the customer (the session's `client_reference_id` and the
  customer's `metadata.userId` are fallbacks).
- A full refund, or any dispute, cancels the subscription at once, so Pro
  ends with the money. A partial refund changes nothing.

### Tax

`STRIPE_TAX_MODE=managed_payments` (the default) turns on
[Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments)
in Checkout: Stripe is the merchant of record and handles sales tax and VAT
worldwide for a fee. Check the account is eligible first (digital products,
supported account country); if it is not, Checkout fails and you should use
`automatic_tax` instead, which turns on Stripe Tax: add a registration in each
place Ciciro must collect tax (Stripe Tax → Registrations). `none` collects no
tax (test mode only).

## App Store Connect (iOS)

1. **Agreements, tax and banking**: sign the Paid Apps agreement.
2. **Small Business Program**: enroll
   (<https://developer.apple.com/app-store/small-business-program/>) for the
   15% commission instead of 30%. Enrollment is not automatic.
3. **Subscription group** (App → Monetization → Subscriptions): create a
   group "Ciciro Pro" with two auto-renewable subscriptions at the same level,
   for example `app.ciciro.pro.monthly` (1 month) and
   `app.ciciro.pro.yearly` (1 year). Add the yearly id to
   `REVENUECAT_YEARLY_PRODUCT_IDS`. Give each a localized display name,
   description, price, and the review screenshot (the paywall).
4. **App Store Server Notifications**: set the Production and Sandbox URLs
   (Version 2) to the URL RevenueCat shows under the iOS app's settings, so
   renewals, refunds and cancellations reach RevenueCat immediately.
5. **In-App Purchase key**: create one (Users and Access → Integrations →
   In-App Purchase) and upload the `.p8` to RevenueCat.
6. **Metadata**: App Review Guideline 3.1.2(c) needs the Terms of Use link
   (`https://ciciro.app/terms`) in the App Store description or the EULA
   field, and the Privacy Policy URL. The paywall already shows the title,
   length, price, auto-renewal terms, and links to both.
7. **Testing**: sandbox testers (Users and Access → Sandbox), TestFlight, or a
   StoreKit configuration file in Xcode for the simulator. Sandbox purchases
   reach the server with `Subscription.sandbox = true`.

## Google Play Console (Android)

1. **Payments profile** (merchant account) set up for the developer account.
2. **Subscription** (Monetize → Products → Subscriptions): create one, e.g.
   `pro`, with two auto-renewing base plans, `monthly` (1 month) and `yearly`
   (1 year). RevenueCat names these `pro:monthly` and `pro:yearly`; add
   `pro:yearly` to `REVENUECAT_YEARLY_PRODUCT_IDS`.
3. **Real-time developer notifications**: point them at the Pub/Sub topic
   RevenueCat gives you under the Android app's settings.
4. **Service account**: create one with the financial and order permissions
   RevenueCat lists, and upload its JSON key to RevenueCat.
5. **Testing**: license testers and the internal testing track.

## RevenueCat

1. Create a project with an iOS app (bundle id `app.ciciro.mobile`) and an
   Android app (package `app.ciciro.mobile`), and connect them to the stores
   as above.
2. Add the store products, attach them all to an entitlement named `pro`
   (for RevenueCat's own charts and tools; the Ciciro server treats every
   store subscription as Pro), and create the **current offering** with the
   standard **Monthly** (`$rc_monthly`) and **Annual** (`$rc_annual`)
   packages. The app shows exactly those two.
3. **Keys**: the public SDK keys go in the app's
   `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`;
   a secret API key (v1) goes in the server's `REVENUECAT_SECRET_API_KEY`.
4. **Webhook** (Integrations → Webhooks): URL
   `https://ciciro.app/api/billing/webhooks/revenuecat`, an Authorization
   header value such as `Bearer <long random string>` (the same string is
   `REVENUECAT_WEBHOOK_AUTH`), all event types, production and sandbox.
5. **App user ids**: the app always logs in with the Ciciro user id
   (`apps/mobile/lib/purchases.ts`, wired to the session), and never shows a
   paywall before sign-in, so there are no anonymous purchasers. Keep
   "Transfer behavior" at the default (transfer to the new App User ID): when
   one Apple ID's purchase moves to another Ciciro account, the webhook
   re-reads both accounts and the old one's row expires.

How the webhook works (`src/lib/billing/revenuecat.ts`): it checks the
Authorization header in constant time, then, like Stripe, ignores the payload
beyond which accounts it names. It re-reads each named customer from
RevenueCat's REST API and upserts one `Subscription` row per store product,
marking rows RevenueCat no longer lists as expired. Duplicate deliveries are
claimed once in `BillingEvent`; even a repeated one would only re-sync.
Refunds arrive as cancellations with `refunded_at` and end Pro at once.

After a purchase or a restore, the app calls `POST /api/billing/sync`, which
re-reads the signed-in account the same way, so Pro turns on without waiting
for the webhook.

## The app

`react-native-purchases` is a native module, so **the dev client must be
rebuilt** (`npx expo run:ios` / `npx expo run:android`, or an EAS build)
after pulling it in; Expo Go cannot run purchases. The paywall
(`apps/mobile/app/paywall.tsx`) is Ciciro's own screen, not RevenueCat's
paywall UI, so it follows the app's themes and languages. It has Restore
Purchases, and so does the Plan group in Settings.

## Paying twice

- **Web, while a store subscription is active**: Checkout re-reads the
  account first and answers 409 with a link to the store's subscription page
  instead of creating a session. The pricing page shows "billed through the
  App Store" with that link and no Upgrade button.
- **App, while a web subscription is active**: the server's entitlement says
  Pro from `stripe`, so the paywall shows the plan ("managed on the web") and
  Settings has no Upgrade or Restore. The paywall also re-reads the
  entitlement just before opening the store sheet.

## Account deletion

`PRE_DELETE_HOOKS` (`src/lib/account/delete.ts`), after the Sign in with Apple
revoke:

- `stripe-cancel-subscription` cancels every live Stripe subscription at
  once, with no proration or further charges. If the account has a Stripe
  customer but Stripe is no longer configured, it refuses the deletion rather
  than leave a subscription billing.
- `revenuecat-delete-customer` deletes the RevenueCat customer (best effort).
  It cannot cancel a store subscription: only the person can, with Apple or
  Google. So, as Apple's deletion guidance asks, the web dialog and the app's
  delete screen tell a store subscriber that billing continues until they
  cancel, with a Manage subscription link, before they delete.

## Emails

`src/lib/billing/notify.ts` is called when a payment fails
(`invoice.payment_failed`) and when a subscription ends
(`customer.subscription.deleted`). Wire those to the payment-failed and
subscription-canceled templates, sending with the Stripe event id as the
idempotency key, once they are on `main`.

## Production D1

The billing tables need `prisma/d1-billing.sql` on production **before** the
build that ships them (see [hosting](hosting.md#database)):

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-billing.sql
```

## Tests

`test/billing-stripe.integration.test.ts` and
`test/billing-revenuecat.integration.test.ts` run the webhooks, Checkout,
Portal, the double-billing guard and the deletion hook against fake Stripe and
RevenueCat servers (`test/helpers/fake-billing.ts`) with real signatures.
`test/entitlements.test.ts` covers resolving a plan across sources,
`test/ai-gating.integration.test.ts` the metering on every AI route, and
`test/billing-web.test.tsx` / `apps/mobile/__tests__/billing.test.tsx` the UI.
