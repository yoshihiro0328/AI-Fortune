# Localhost connection diagnosis — 2026-10-23

The pre-key trial was closed through its normal cleanup after C reported connection refusal and D showed `ERR_BLOCKED_BY_CLIENT`. No Stripe key, Checkout, subscription or payment was created. The additional single payment authorization remains unused. The earlier paid attempt and its uncertain synchronization cause remain unchanged.

## Observed cause and limits

The server was still listening, and credential-free reads received an account page (200) and entry redirect (303). This alone did not establish browser reachability. IPv6 loopback refused connections because the server bound only IPv4. Binding both explicit loopback addresses did **not** solve D's error: the same Chrome tab then produced a server-side `HEADER_OVERFLOW` before the request handler ran.

With a bounded raw-header envelope and the existing cookie namespace filter, the same tab reached the login page, reloaded it, opened Plans and returned using the login link. Fixed-category diagnostics confirmed that discarding foreign cookies brought the effective headers below the original limit. No cookie values, request headers, JWTs or raw parser-error packets were recorded. This establishes the stale-cookie header overflow for D's current connection failure; it does not establish the root cause of the older paid attempt.

C's in-app tab remains an internal error document. Its ordinary reload is rejected by the browser URL policy. Work did not use another tab, URL protocol, browser surface or raw browser commands to evade that restriction. C's attached-browser verification remains pending its owner restoring the normal HTTP page after the server is ready.

## Narrow repair

- Listen only on `127.0.0.1` and `::1`, never wildcard or LAN addresses. Startup requires both; partial failure closes the other listener. Cleanup closes both.
- Accept at most 128 KiB of raw headers locally so old localhost cookie namespaces can be filtered before Next runs. After filtering, **all effective headers together still have a 16 KiB limit**. Oversized current authentication cookies or non-cookie headers are rejected.
- Preserve existing cookies. Only this attempt's allowlisted namespace reaches the app; ambiguous or foreign authentication remains excluded. Host/origin checks, OS egress restrictions, credential lifetimes and trial limits are unchanged.
- Retain only fixed parser/scope categories, never error objects or request content.

## Review and validation

Review covered explicit loopback binding, partial-start cleanup, original effective-header budget, namespace boundaries, no mutation retry and no secret-bearing diagnostics. Synthetic regressions cover both address families, failure cleanup, bounded parser rejection, 50 KiB of ignored stale cookies, and rejection of oversized current cookies and non-cookie headers. Existing chunked SSR authentication regressions remain in place.

The actual D browser evidence uses the same tab, localhost port 5218, CUA route and `startRuntime` launcher with its OS communication restrictions. The credential-free probe made no provider connection. This is connection evidence, not a completed real Plus trial or C/D authenticated session.

Validation completed: 190/190 script regressions; targeted lint and whitespace checks; one complete Mac production-app browser flow with synthetic providers, retained paid history, chunked authentication, lost-return reconciliation, Plus/Portal/RLS, cancellation, Free and cleanup (59.8 seconds). An earlier regression run overlapped the credential-free probe and hit fixed-port conflicts; that run is not counted as passing. The probe was stopped and the full suite rerun in isolation successfully.
