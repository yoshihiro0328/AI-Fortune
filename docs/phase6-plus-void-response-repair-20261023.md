# Plus retained trial: committed void response and synchronized history

The 69a2c593 attempt stopped before creating a Checkout. Its encrypted provider record reports `application_post_snapshot`, HTTP 204, then `INVALID_JSON`. The broker stopped the application, so the subsequent browser connection refusal was a consequence of that stop. This is separate from the earlier cookie/header and concurrent-update repairs.

A bounded read after closure confirmed the exact previously paid/canceled C subscription and paid 980 JPY invoice in the database. No new Checkout, contract or payment was issued in this attempt. The prior canceled subscription was successfully synchronized before the response parser failed; its mutation was not replayed.

## Change

- Accept an empty HTTP 204 only for the already authorized Supabase POST `apply_subscription_snapshot` RPC, whose SQL signature returns void. Preserve the empty 204 through the app transport and broker. Empty 200/500 responses and unexpected 204 routes still fail, with no automatic mutation retries.
- Make the synthetic HTTP provider return the actual void response after applying the migrated SQL function, so application-path tests exercise the production response shape.
- At all three start gates, allow at most the one explicitly retained C canceled subscription and paid invoice, checking their historical identity, owner, test mode, amount, price/customer and canceled timestamp. Other users, extra rows, active contracts and changed invoices remain rejected. The historical rows do not consume or expand the allowance for one new contract/payment.
- Exercise both unsynchronized and already synchronized paid history through the connected scenario. Keep the historical baseline and latest closure reconciliation separately; do not erase old failed/unknown records.

## Closure evidence

The provider closure restored DB price visibility to false, restored the original Portal binding and disabled the temporary Portal configuration. Stripe catalog state and Smart Retries were unchanged. Protected A/B and one-off data match the retained comparison. C/D profiles and Customer/binding remain retained. Dedicated processes stopped and temporary credentials were erased.

The owner subsequently reported all three 69a2c593 keys revoked. The five-minute operator wait had expired and credentials had already been erased. API reads before that owner report still showed valid keys; no API verification after the report was performed and no secrets were recovered for it. These facts are recorded separately, without upgrading the original completion flag.

## Validation and review

Focused tests cover empty-204 transmission end to end through wire/app transport/broker and rejection of unexpected empty responses. The existing connected scenario now also starts with synchronized historical database rows and verifies login, one synthetic purchase, notification/Plus, Portal, denial/RLS checks, cancellation/Free, restoration and cleanup. These are synthetic results, not an external Stripe trial pass.

Manual review checked that the change neither broadens destinations/permissions nor adds retries, permits a second purchase, changes catalog/settings or exposes credentials. The PostgREST response handling remains downstream of the existing request policy. Existing malformed/error responses remain fail-closed.
