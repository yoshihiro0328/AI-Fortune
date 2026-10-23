# Expired Checkout retained-state repair

An unpaid Checkout from a stopped attempt remains in the existing C Customer binding. The resume gate previously required that binding to point at the older paid Checkout, so it rejected the correctly retained state before creating any keys.

The plan now distinguishes one explicitly approved expired Checkout from paid, canceled subscription history. All three start gates accept only that exact retained binding. Before external preparation, the driver reads the Checkout and requires expired/unpaid, null subscription and invoice, the same test Customer and C identity, and 980 JPY. Historical Checkout IDs cannot enter new-operation counters or be submitted, expired again, or canceled as new purchases. Existing C/D, Customer, and prior paid history are preserved.

Validation: exact-ID and wrong-state/owner/amount rejection cases; a connected synthetic flow starting with both synchronized paid history and the expired binding, through login, one new Checkout/payment, notification, Plus, Portal, access checks/RLS, immediate cancellation, Free and cleanup. No real keys or payments are used by these regressions. Local browser coverage and CI are recorded separately from live evidence.

Operationally, the owner performs the one Stripe payment confirmation. Work never resubmits the previously rejected payment tool. The actual trial deadline remains authoritative; a later operator mailbox expiry does not extend it. If insufficient time remains for postpayment verification, cleanup takes priority.
