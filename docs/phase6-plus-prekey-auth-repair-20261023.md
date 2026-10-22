# Retained Plus trial: authenticate before Stripe keys

The stopped attempt never reached Checkout. Supabase's authentication log recorded
HTTP 422 `weak_password` for D's password update. D's current update timestamp
precedes the failed request's log window, while C's update returned HTTP 200.
The prior result remains recorded as originally observed; an additive reconciliation
records the provider rejection without replaying the update or recovering credentials.

The random base64url password generator did not guarantee all required character
classes. The replacement retains 256 random bits and includes lowercase, uppercase,
digits and a special character, within bcrypt's byte limit. Both passwords are
checked before either dedicated-user update. Provider evidence stores only operation,
HTTP status and an allowlisted error code, never the response body or password.

## Same-attempt ordering

1. Verify the retained DB baseline, C/D identities and Customer binding; no Stripe key.
2. Update each dedicated temporary password once and start the restricted auth-only
   app on localhost:5218, with its existing broker on 5219 and OS network controls.
3. Perform one real browser login per C/D and verify their actual JWT RLS results.
   Billing and webhook routes are denied during this stage; no Stripe request is sent.
4. Only after both logins pass, open the private key receiver. Verify it immediately
   before each permitted key creation. Owner saves and submits the three secrets.
5. Transfer credentials to parent memory, remove the handoff file, and restart only
   the local app/broker with the same cookie namespace, authenticated sessions,
   policy counters and evidence. Do not reset passwords or log in again.
6. Use `advance` to perform the mandatory app/CLI/broker health check and exactly
   one next step together. Bare `next` still fails closed without `status`; neither
   command retries a failed or unknown mutation. Do not act on the browser until
   the new browser checkpoint request exists. A `revoke-keys` request means the
   trial has entered cleanup, not that a page needs reloading.
7. Continue the approved single Checkout/payment, real notification, Plus, Portal,
   immediate no-proration cancellation, Free and cleanup sequence.

The original 20-minute execution budget includes pre-key authentication. Only the
owner's key preparation/input wait is excluded, as previously approved; the remaining
execution budget resumes without resetting. An independent absolute two-hour ceiling
starts conservatively before key receipt and never extends. The owner revocation/API/
erase limits are unchanged. Receiver timeout or disconnection closes it and deletes inputs.
A failed runtime cannot transfer its stopped policy into a new runtime. No test keys,
price changes, contracts or payments are created by the preparation regressions.

## Verification and review

- Portable full-flow tests include staged retained success, browser failure and input
  disconnection, asserting zero Stripe requests before authentication, two password
  updates and two login grants total.
- The sandboxed Mac Chrome regression passed the staged retained flow through
  Checkout, notification, Plus, Portal, cancellation, Free and cleanup using synthetic
  providers and the actual application. This is regression evidence, not a claim that
  the real Stripe trial or the actual attached-browser path has passed.
- Receiver regressions exercise actual loopback submission, handoff, abort, input
  closure, insufficient time and deletion, checking that output contains no keys.
- Manual diff review checked identity preservation, write/count reservation, no
  mutation retry, shared session/counter continuity, cleanup independence and secret
  erasure. Existing A/B, one-off billing, content and STEP 10 remain unchanged.

The attached IAB (C) and Chrome (D) must pass actual authentication in the new
staged attempt before any key creation. Real-trial results will be recorded separately.

## Retained state after attempt 55c42f25

C and D both passed real login and JWT RLS. Each now has one application profile.
Keep those rows, the existing Auth users, Customer and binding. The next plan carries
the exact profile snapshots, verifies them before password updates, and exercises
the existing-profile login path. Missing, duplicate or changed profile rows stop the
run before mutations. The profile-absent initial-login regression remains covered.

The operator sent bare `next` without the required `status`. Control stopped before
any Checkout/contract/payment. The browser error followed the runtime shutdown;
it was not evidence of a new network-policy failure. Cleanup restored DB price=false
and Portal=false/binding, kept Stripe catalog=true, verified all three revoked keys
via bounded API checks, stopped processes and deleted temporary credentials.
The full trial is still incomplete. No retry or result is represented as successful.
