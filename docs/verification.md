# Verification — 2026-10-07

テスト公開環境で無料診断からStripe Sandbox決済、有料AIレポートまで再検証済み。メール配信の送信元設定と運営情報が未確定のため、商用公開完了とはしていません。

## Public deployment

- URL: https://partner-mind-vdiordna-2059.vercel.app
- Repository/PR: https://github.com/yoshihiro0328/AI-Fortune/pull/1
- Branch: codex/partner-mind-mvp
- E2E checkpoint: e2c366c98ef58269ac22669af05e05320ab34bab / dpl_DtG9mibMgGJsPQW6G4yC5GCmaiNt / READY / staging.
- GitHub CI run 37461268607: lint / typecheck / tests / standard Turbopack build successful. Final follow-up commit adds provider-failure tests, DB assertions, documentation and clearer inaccessible-report messaging; its CI is recorded on the PR.
- Vercel public access and encrypted Preview settings remain as previously authorized. Stripe remains test-only. Local Stripe CLI forwarding was stopped during hosted testing.
- One failed deployment contained an outdated test file; the full updated source bundle was redeployed successfully. A browser test found `?new=1` prevented reload resume; starting now replaces it with the owned diagnosis's resume URL. Re-tested on the public site.

## Authentication and persistence

- Email/password signup, verification callback, resend, login/logout, recovery and password update are implemented, with Japanese errors, rate limits and private no-store responses.
- Supabase Email provider / new signup / confirm email enabled. Site URL set to the public alias. Exact `/auth/callback` and `/auth/callback?next=recovery` redirects registered.
- Custom SMTP is NOT configured. Real inbox delivery and the complete default email-link/PKCE callback journey remain unverified. An actual public signup request using a synthetic address returned a handled 400; resend/reset returned non-enumerating responses. These responses do not prove delivery.
- `scripts/auth-live.mjs`: 25 assertions passed locally and on the public alias. Real Supabase-generated signup/recovery tokens verified; session persisted; anonymous diagnosis claimed once; own history read; logout and subsequent login; second user's reads denied; password recovery required and update completed; old password denied/new password accepted; invalid token denied.
- This test uses `admin.generateLink` on synthetic accounts, NOT email delivery. Do not describe it as an inbox test.
- Hosted auth fixture: diagnosis `40f1861b-425a-441a-add9-a9101f5c7d89`; users `536e2519-977e-4ac0-b0de-e53be726873f`, `fce8e524-d3c4-44e9-8178-71ab35913201`.
- Claim RPC is service-role-only, SECURITY INVOKER. Server validates confirmed `getUser()` first. Anonymous records and associated payments are claimed atomically; owned records cannot be re-claimed. Token-hash confirmation does not automatically claim the current browser's data.
- Browser: new anonymous diagnosis, one question per screen, save, reload resume, back to checked previous answer, free result and existing history all verified.

## Safety

- Rule-based triage supplies contextual hints; it no longer blocks on a word match. Structured OpenAI classification handles negation, quotation, tense, threats and contradictory statements; Zod validates the result.
- Classification is re-run when additional answers change the input hash. Classification failure stops analysis rather than inventing a safe result.
- Unit risk cases: 16. Real OpenAI classification: 11/11 expected outcomes (four requested safe examples, five dangerous examples, denial plus concrete violence, and injection-like instructions).
- Public browser diagnosis `a997ccd5-871f-4fa9-838b-00a9d3461ebe` contained “暴力はないです。殴られたことはありません。” and reached a normal free report, risk=false.
- Public danger browser fixture `b9971e51-0196-41c9-857e-1030ebeb759b` reached the safety screen with no paid CTA.
- Public API danger fixture `c193e456-5436-48fc-98ea-18c99d7a1a28`: safety, no free report, Checkout 403, paid report 403. An earlier test expected 409 instead of the correct 403; the test expectation was corrected and re-run successfully.
- Real additional-question fixture `bc27dbb0-6846-41f2-bb4c-18ac16b34df6`: initial 10 answers -> one generated question -> saved additional answer -> contextual reclassification -> free report. No injected DB state or mocked AI in this flow.
- Finite cases are not a guarantee against every false positive/negative.

## Stripe and paid report

- Sandbox account: `acct_1UNSvsIYwtQeIHKP`; price `price_1UNTB4IYwtQeIHKP6tKc0L8s`, JPY 1,980 one-time.
- Hosted browser Checkout used official test card; `livemode=false`, actual charge zero. Checkout `cs_test_a11vcePyGAEFaqXVCQl8xvx5lERyBaoJLp4xYHDWthmapC6NnBY7lwYpcI` completed with payment_status=paid.
- Stripe event `evt_1UNXH0IYwtQeIHKPH2aHoz2m`: checkout.session.completed, livemode=false, pending_webhooks=0; matching DB event processed at 2026-10-06 12:15:11 UTC.
- Hosted webhook endpoint `we_1UNVR9IYwtQeIHKP4P1WirXK` points to public `/api/webhooks/stripe`.
- Diagnosis `a997ccd5-871f-4fa9-838b-00a9d3461ebe`: payments=paid, paid_reports=ready, attempts=1, report_json=13 fields. All 13 sections rendered. Returning through free result displays “購入したレポートを見る” and opens the saved report without another checkout.
- Signature, amount/currency, Sandbox status and purchase identity are checked. The success URL does not grant access.
- Real DB transaction tests: duplicate event rejected; distinct event for same payment does not duplicate report; concurrent worker refused; failed generation can retry with the same payment; completed report cannot generate again; wrong lease refused; delayed failure cannot downgrade paid; refund revokes content and late success cannot restore it. Synthetic transactions rolled back.
- Failure/retry assertions are DB tests. We did not deliberately interrupt the paid public OpenAI job or charge twice.

## DB and security

- Four total migrations applied; this update adds `20261006114912_account_contact.sql` and `20261006115729_claim_service_role.sql`.
- 20 tables have RLS enabled. Contact table is server-only with name/email/message/status/admin_note/timestamps and indexes. No public read policy added.
- `tests/account-database.sql`: owner can read diagnosis/answers/free/paid/payment after claim; different user cannot; payment ownership follows claim; public and authenticated clients cannot execute claim or read contacts. All real DB assertions passed and rolled back.
- `tests/database.sql`: payment transitions, retry, deduplication, leases, refund, rate-limit and RLS assertions passed and rolled back.
- Public HTTP smoke passed: CSRF, anonymous save/resume, IDOR, unpaid read/generate, premature checkout and forged webhook rejection.
- Additional public security/SEO script: 33 assertions passed, including legal routes, X-Frame-Options, no-store/noindex on account, canonical/OG/Twitter, robots, sitemap, favicon, OGP response, 404, open-redirect denial, oversized body 413, invalid-ID rejection, success-query access denial and contact rate limit 429.
- XSS: React text rendering, no raw HTML/eval sinks found. SQL uses parameterized client queries/RPC values and UUID validation. AI input is untrusted data; no tool execution; ownership/payment authorization is outside the AI.
- Client bundle scan: 44 JavaScript files contained none of the configured server secrets. `.env.local` remains ignored; secrets are never NEXT_PUBLIC values.
- Production dependency audit: zero known vulnerabilities. Development tooling: five high findings share the unpatched braces <=3.0.3 stack-exhaustion advisory (GHSA-vfj7-8cjw-p6xm). Registry latest is 3.0.3; npm's suggested eslint-config-next 14.2.35 is a major downgrade from the current 16.3.8, so it was not applied blindly.
- Supabase advisor INFO entries for RLS-without-policy are intentionally inaccessible server tables; no warning/error findings at review.
- Error cases use mocks for OpenAI timeout/invalid schema, actual route-level Supabase insert failure and Stripe price-fetch failure, and client network/HTML/503 errors. External services were not intentionally taken down.

## UI, contact and SEO

- The approved OpenAI disclosure wording is preserved. Input notice includes name/address/phone/email. All seven legal pages reflect anonymous use, optional registration, storage, AI limitations, Sandbox purchase and provisional operator details.
- Contact browser receipt `838eb211-3aa8-442b-8c4a-1b2ccf27ffd8` confirmed status=open in DB. Success UI explicitly says no automatic email and test-only response operations.
- Mobile width 390px: TOP, diagnosis, free/paid report, signup/login/reset/history, contact, legal and 404 checked; no horizontal overflow. Safety and inaccessible-report screens checked. Paid report console errors=0.
- AI loading includes elapsed-time guidance; network errors have Japanese recovery guidance. Report access errors no longer appear as a successful payment wait.
- Metadata, canonical, favicon, OGP/Twitter, robots and sitemap implemented. Search indexing is disabled for the test site by default; result/report/account remain noindex even if public indexing is enabled later.
- Local checks: lint/typecheck, 57 tests in 6 files, webpack production build pass. Standard Turbopack build passes on GitHub/Vercel; local sandbox denied a port used during its build, so webpack was used locally.

## Before commercial release

1. Provide/authorize sender domain and SMTP credentials; configure delivery, then verify actual confirmation/resend/recovery messages in an owned inbox and the PKCE callback end-to-end. Authentication code/token verification is tested, email delivery is not complete.
2. Provide official operator/representative/address/phone/contact email and choose retention/deletion policy, refund request period and response deadlines. Placeholders are intentionally visible; no identity was invented.
3. Establish contact-response and data deletion operations. DB receipt works, outbound email/admin workflow is not yet configured.
4. Explicit approval and any Stripe business verification are still required before any live-payment transition. Live keys are rejected by current code.
5. Track the development-only braces advisory until a compatible fix is released. No production dependency findings at review.
6. Anonymous purchase recovery after cookie loss is not implemented; account saving is available. GA4, advertising, subscriptions and automated outreach remain outside this MVP.
