# Paid-history continuation — 2026-10-23

The prior attempt completed one 980 JPY sandbox payment and immediate cancellation. The subsequent read-only reconciliation confirmed one paid invoice, no outstanding balance, a canceled subscription, disabled DB price and attempt Portal configuration, restored binding, stopped processes, revoked keys and erased temporary credentials. The original failed completion and unknown runtime marker remain unchanged.

## Evidence boundary

Checkout display and payment succeeded. The account return failed before a persisted Plus snapshot or verified webhook was recorded. Portal, post-payment access checks and RLS were not reached. The last recorded transport abort may be a consequence of stopping. A stale synchronization lock and a synthetically reproduced concurrency failure support a possible explanation, not a proven historical root cause. The prior per-subscription serialization fix preserves distributed locking and event evidence.

## Approved continuation

Reuse the exact retained C/D, Customer, binding and disabled Portal configuration. Read and retain the exact previous canceled subscription and paid invoice separately from a maximum of one additional Checkout, subscription and payment. Prior history cannot authorize provider writes, consume the new purchase budget, or masquerade as a new webhook. The app may refresh the unchanged historical canceled snapshot. No additional purchase after an unknown result.

A failed return-page observation can proceed to read the same Checkout and subscription. Only transport failures in those reads permit one bounded read-only reconciliation, under the existing deadline. Permission failures, mismatches, aborts and mutations cannot use this path. A live runtime, real notification evidence, Plus entitlement, UI, Portal, denial and JWT checks remain required. Fixed-category request phases and stage milestones are encrypted; request paths, credentials and personal information are not written to ordinary logs.

The 20-minute trial, 2-hour credential lifetime, existing API limits, 60-second cleanup plus the separately approved 5-minute owner revocation wait remain unchanged. Immediate cancellation uses no invoice/proration. Catalog remains unchanged; DB price and attempt Portal are disabled on exit. No clocks, deliberate failures, Smart Retries changes, AI, merge or deployment.

## Validation

- 185 script tests passed; targeted lint and TypeScript checks passed.
- Production app plus synthetic providers and local Chrome passed the retained paid-history flow: existing profiles and customer binding → one additional payment → overlapping signed notifications → Plus → Portal/return → denial/RLS → immediate cancel → Free → cleanup.
- The same flow included failed payment-return observation, without a repeated purchase.
- Boundary tests deny extra subscriptions/invoices, changed history, historical mutation/event reuse, unresolved closure expansion, permission-failure retries and expired work.
- Manual review covered scope counters, historical row ownership, immutable comparison baseline, retry classification, secret-safe diagnostics and cleanup preservation.

These are preparation results, not a successful real Stripe continuation. Real webhook/Plus/Portal/post-payment checks remain unverified until the authorized next attempt completes.
