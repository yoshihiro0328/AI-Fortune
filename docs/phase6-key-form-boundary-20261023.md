# Restricted key draft boundary — 2026-10-23

The d8f0b7ff attempt stopped before Stripe credential handoff, Checkout or payment. Work acquired a full page snapshot after the owner reported opening the next draft. The bound tab was actually on the API key list. The snapshot exposed two newly created restricted keys and a standard secret key. Owner intent did not prove the bound tab's current location. No secret values, partial values or hashes are recorded here, and prior tool output has not been erased.

The two restricted keys were revoked according to the owner; API verification was not performed. The lifecycle key was not created. The receiver was closed without receiving credentials, temporary inputs were removed, the runtime exited, and no listeners remained on the dedicated ports. The original incomplete cleanup result is preserved, with the later owner revocation report added separately. Standard key rotation, replacement storage and immediate old-key expiry were reported by the owner. A revocation display was not found and API validation was not performed. Identity with previous exposures remains unresolved. The replacement is not a trial credential.

## Enforced observation procedure

Use `restricted-key-form.mjs` through the permitted CUA browser surface, on the owner-opened existing tab. This module does not connect to a browser itself. The operator must load its functions into CUA and use them instead of general page snapshots.

1. Inspect URL metadata only. Require the exact named sandbox creation URL, without query or fragment. Never acquire a tab through an API that automatically snapshots it while its current state is unknown.
2. The read-only page evaluation checks the URL again before any DOM access. Require the named draft input. Unexpected names, missing structure, group-wide permissions, unknown selected resources or choices deny the operation with a fixed boolean result. Return only blank-state and allowlisted permission labels; never return arbitrary page text or input values.
3. Restrict edit locators to the creation form's main region containing that exact draft input. Recheck the boundary before edits and before submission. A denied boundary is not a reason to inspect DOM, AX, screenshots, tooltip text, clipboard or full errors. It requires an owner-opened draft, not investigation of the key list.
4. Before creation, verify receiver health and remaining time and persist the nonsecret intent. Compare the complete selected permission set to the already approved set. Use a one-shot submit closure. Mark the attempt consumed before the click; an uncertain result must not be retried. Maintain the persisted intent across turns.
5. After the click, do not observe the page. Hand off secret storage to the owner. Only the owner's next-draft report permits starting at step 1 again; that report never replaces the guard.

The allowed creation-form exception does not authorize key list/detail reads. These checks do not grant permission, replace action-time confirmation when required, prove key creation, or independently prove revocation. No access scope, service configuration, payment counter or execution deadline is changed.

## Validation and review

Seven focused regressions cover list/detail/foreign-account denial with a DOM-access trap, redirect between metadata and evaluation, no arbitrary text output, known draft inspection, permission mismatch, uncertain-click no-retry, and absence of post-submit inspection. These synthetic tests are not evidence of a successful real subscription trial. Existing application/browser-path CI evidence is reused because this change does not alter the app or payment runner.

Manual review checked read-before-guard ordering, output allowlisting, exact permission comparison, no post-click observations and persistence of unknown outcomes. Subsequent operator use must follow this procedure; an unused helper alone cannot prevent a general snapshot call.
