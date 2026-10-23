# Plus attempt 0827ea74: result and notification repair

The one approved sandbox Checkout completed with one JPY 980 paid invoice. The
trial stopped during subscription synchronization. Plus entitlement, Portal,
post-purchase access denials and post-purchase owner-JWT RLS are **not passed**.
No purchase or contract operation was repeated.

## Closure evidence

- Owner reported all three attempt keys revoked; the existing bounded API check
  independently confirmed listener/app/lifecycle revoked.
- Temporary credential inputs were erased and dedicated processes stopped.
- Limited read-only Stripe MCP reconciliation found the known subscription
  canceled and exactly one invoice: paid JPY 980, remaining 0, no next payment.
  Cancellation used `invoice_now=false` and `prorate=false`.
- Stripe catalog remains at its original active state. DB price is inactive,
  Portal binding restored, and the attempt Portal configuration disabled.
- DB has no subscription/invoice snapshot for this attempt. Current C entitlement
  is Free, limit 3, remaining 3. This is **not** evidence of a successful
  Plus-to-Free transition. Both retained profiles and the Customer binding remain.
- Original automatic closure remains `complete=false` with an unresolved runtime
  marker. An additive private reconciliation records the bounded reads and safe
  resource closure; it does not rewrite the original result or infer a passed test.

## Investigation and changes

The original provider trace records a final aborted/timed-out application request,
but the runtime's categorical stop reason was discarded by a default no-op recorder.
That final error might be a consequence of stopping. The historical root cause is
therefore **not established**.

Concurrent notification deliveries and account refreshes can take the same
subscription lock before an earlier refresh releases it. This failure was
reproduced with synthetic overlapping requests. Queueing refreshes per subscription
within the process avoids that contention, including across route bundles. Every
request still reads current provider state and retains its own event evidence;
the distributed database lock remains in place. Failed operations are not retried.
Cross-process contention still uses the existing database lock and error behavior.

Runtime stop/denial/HTTP categories are now encrypted into the evidence vault.
Only allowlisted codes, methods, routes and status numbers are retained. Arbitrary
paths, query strings, request bodies, headers and error text are excluded.

Cleanup now reads invoices for known ended contracts even when a runtime marker
remains unknown. This cannot clear unknown operations or make overall cleanup pass.
No extra mutation, permission, credential lifetime, retry or purchase budget is added.

## Review and validation

Reviewed queue lifetime, independent event handling, lock preservation, failure
propagation, diagnostic redaction and incomplete-cleanup semantics. Local checks:
37 subscription synchronization/end-date tests and 177 Plus script tests passed;
type checking and targeted lint passed. Both local Chrome end-to-end cases passed
(staged retained minimal, and existing profiles with simultaneous notifications),
including login, synthetic Checkout/payment, Plus, Portal, access denials, RLS,
immediate cancellation, Free and cleanup. CI is recorded in the completion report.

The retained-profile synthetic browser case now submits Checkout completion,
subscription creation and paid-invoice notifications concurrently. This is local
regression evidence, not a replacement for real Stripe webhook verification.

## Remaining scope

The approved one payment has been consumed. Another real sandbox purchase would
be a re-contract for C and require concrete additional-payment/re-contract
authorization; none was issued or attempted. Existing restart guards require
zero prior Checkout/subscription/payment records and a null stored Checkout ID.
They deliberately remain in force. A future authorized re-contract must explicitly
separate this known canceled history from its new-operation counters and verify
that starting state synthetically before issuing keys; it cannot reuse an old
zero-history baseline.
Clock, intentional renewal failure, re-contract, production payment, AI generation,
merge and deployment remain excluded. The actual minimal flow must pass before
publication; this document does not authorize publication or broaden test limits.
