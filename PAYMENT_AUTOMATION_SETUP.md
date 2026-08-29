# TexMediator Party A / Party B Payment Setup

The website now contains the server-side automation for this flow:

1. Party A schedules in Acuity and pays the appointment price.
2. Acuity sends a signed `scheduled` webhook to the website.
3. The website verifies the signature and retrieves the appointment directly from Acuity.
4. The website reads Party B's required billing email from the intake form.
5. Stripe creates and emails Party B a separate invoice for the same per-party fee.
6. Stripe tracks the invoice as draft, open, paid, void, or uncollectible.

This integration uses Acuity's API, so the Acuity account must be on a plan that includes API access (Premium or Powerhouse at the time this integration was built).

## 1. Finish Party A payments in Acuity

In Acuity, connect the live Stripe account. For each appointment type, set the price below and require clients to pay the full amount when booking.

| Acuity appointment type | Appointment type ID | Party A price | Party B invoice |
| --- | ---: | ---: | ---: |
| Two-Hour Mediation | 97139812 | $450 | $450 |
| Half-Day — Personal Lines | 96980378 | $850 | $850 |
| Half-Day — Commercial Lines | 96980693 | $1,000 | $1,000 |
| Full-Day — Personal Lines | 96982073 | $1,700 | $1,700 |
| Full-Day — Commercial Lines | 96982161 | $2,000 | $2,000 |

Do not put the combined two-party total into Acuity. Acuity charges Party A only; the automation creates Party B's separate invoice.

Then open **Client Emails → Appointment Receipts**, turn **Send receipts automatically** on, and customize the receipt if desired. This is the receipt Party A receives after paying through the scheduler.

## 2. Add Party B's billing field in Acuity

Create a required single-line intake-form field named exactly:

`Party B billing email address`

Attach the intake form to all five appointment types. The automation can locate the field by this exact name. If you later obtain the field's numeric Acuity ID, add it to `ACUITY_PARTY_B_EMAIL_FIELD_ID` for a more rename-proof setup.

## 3. Create a restricted Stripe key

Create a test-mode restricted key first. Give it only the access this function needs:

- Customers: read and write
- Invoices: read and write
- Invoice Items: read and write

Do not place the key in a source file or commit it to Git. Add it only as a sensitive environment variable in Netlify. After the test flow is approved, create the equivalent live-mode restricted key.

## 4. Add Netlify environment variables

In Netlify, open the TexMediator site, then go to **Project configuration → Environment variables**. Add:

| Variable | Value |
| --- | --- |
| `ACUITY_USER_ID` | The numeric user ID under Acuity **Integrations → API** |
| `ACUITY_API_KEY` | The Acuity API key from the same screen |
| `ACUITY_PARTY_B_EMAIL_FIELD_NAME` | `Party B billing email address` |
| `STRIPE_RESTRICTED_KEY` | Start with the `rk_test_...` key; use `rk_live_...` only at launch |
| `STRIPE_INVOICE_DAYS_UNTIL_DUE` | `1` |
| `BILLING_CONTACT_EMAIL` | `hugh@texmediator.com` |

Mark the Acuity API key and Stripe restricted key as secret or sensitive values. Trigger a fresh deployment after saving them.

## 5. Add the Acuity webhook

In Acuity, open **Integrations → Webhooks** and add this URL:

`https://texmediator.com/.netlify/functions/acuity-scheduled`

Subscribe only to the `scheduled` appointment event. Do not also add the `changed` event for this workflow because Acuity says combining `changed` with specific appointment events can produce duplicate deliveries.

## 6. Configure Stripe email and branding

In Stripe:

1. Add TexMediator's logo, brand colors, support email, and public business information.
2. Enable successful-payment receipt emails. This supplies Party B's receipt after the Stripe invoice is paid; Party A's receipt is controlled in Acuity.
3. Review the invoice template and footer.
4. Confirm the payment methods Hugh wants to accept in Stripe's payment-method settings.

The code deliberately does not hard-code card-only payment methods. Stripe can display eligible methods based on the Dashboard configuration.

## 7. Test before going live

1. Deploy with the Stripe test restricted key.
2. Create a controlled Acuity test booking with Party B's email filled in.
3. Open Stripe in test mode and confirm there is one customer and one Party B invoice for the correct amount.
4. Open the invoice's hosted payment page and pay it with Stripe's standard test card `4242 4242 4242 4242`, any future expiration date, any three-digit CVC, and any valid ZIP code.
5. Confirm the invoice changes to **Paid**.
6. Confirm Party A received the Acuity appointment receipt.
7. Confirm the Acuity appointment ID appears in the invoice metadata and invoice reference.
8. Confirm a repeated webhook does not create a second invoice.

Stripe does not deliver real invoice emails in test mode. Inspect the invoice and hosted invoice page in the Stripe test Dashboard instead.

## 8. Go live

Replace only `STRIPE_RESTRICTED_KEY` with the equivalent `rk_live_...` key, redeploy, and make one controlled live booking. Verify Party A's payment in Stripe, Party B's emailed invoice, and both payment records before accepting normal bookings.

## Duplicate and security safeguards

- Every Acuity webhook signature is checked with HMAC-SHA256 before processing.
- Appointment details are retrieved from Acuity's authenticated API rather than trusted from the incoming webhook.
- Only the five known appointment type IDs can create invoices.
- Stripe API calls use deterministic idempotency keys based on the Acuity appointment ID.
- Existing invoices are also located by Stripe metadata, protecting against duplicates delivered after the normal idempotency window.
- A partially created draft invoice is safely resumed instead of replaced.
- Secret keys stay in Netlify environment variables and never enter the browser or repository.
- Unexpected invoice line items stop the send step for manual review instead of risking an incorrect charge.

Automatic Stripe Tax is not enabled. Hugh should confirm the correct tax treatment with his tax professional before any tax collection is added.
