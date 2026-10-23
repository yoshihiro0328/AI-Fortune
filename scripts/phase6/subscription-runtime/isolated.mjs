// No network. Real application migrations/RLS; synthetic Auth and Stripe API responses.
import { randomBytes } from "node:crypto";
import { isolatedReady } from "../payment-verification/isolated.mjs";
import { TARGET, check } from "./policy.mjs";
export async function isolatedSubscription() {
  const retained = await isolatedReady(),
    pg = retained.pg;
  const m = {
    project: TARGET.ref,
    account: TARGET.account,
    app: TARGET.app,
    run: "30000000-0000-4000-8000-000000000001",
    synthetic: true,
    protectedUsers: [retained.m.a.id, retained.m.b.id],
    retained: {
      diagnoses: retained.m.diagnosis,
      diagnosis_answers: retained.m.answer,
      free_reports: retained.m.freeReport,
      payments: retained.expected.payment,
      paid_reports: retained.expected.report,
    },
    c: {
      id: "30000000-0000-4000-8000-000000000002",
      email: "plus-c@example.invalid",
    },
    d: {
      id: "30000000-0000-4000-8000-000000000003",
      email: "plus-d@example.invalid",
    },
    customer: "cus_local_plus",
    clock: "clock_local_plus",
    portal: "bpc_local_plus",
    price: "price_local_plus",
    product: "prod_local_plus",
    version: "plus-isolated-current",
    amount: 980,
    currency: "jpy",
    interval: "month",
  };
  m.sessionSecret = randomBytes(32).toString("hex");
  m.c.cookie = randomBytes(32).toString("base64url");
  m.d.cookie = randomBytes(32).toString("base64url");
  for (const x of [m.c, m.d]) {
    await pg.query(
      "insert into auth.users(id,email_confirmed_at) values($1,now())",
      [x.id],
    );
    await pg.query("insert into profiles(user_id) values($1)", [x.id]);
  }
  await pg.query(
    "insert into price_versions(id,kind,amount,stripe_price_id,stripe_product_id,active,is_test) values($1,'plus',980,$2,$3,true,true)",
    [m.version, m.price, m.product],
  );
  await pg.query(
    "update service_settings set portal_configuration_id=$1 where id",
    [m.portal],
  );
  await pg.query(
    "insert into billing_customers(user_id,stripe_customer_id,is_test) values($1,$2,true)",
    [m.c.id, m.customer],
  );
  const now = () => Math.floor(Date.now() / 1000),
    price = {
      id: m.price,
      product: m.product,
      active: true,
      livemode: false,
      type: "recurring",
      currency: "jpy",
      unit_amount: 980,
      recurring: { interval: "month", interval_count: 1 },
    },
    subscriptions = new Map(),
    invoices = new Map(),
    checkouts = new Map(),
    sessions = new Map(),
    calls = [];
  const state = { clock: now(), priceActive: true, portals: 0, payments: 0 };
  const customer = {
    id: m.customer,
    livemode: false,
    test_clock: m.clock,
    metadata: { run: m.run, user_id: m.c.id },
  };
  const token = (id) =>
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(
      JSON.stringify({
        sub: id,
        role: "authenticated",
        iss: TARGET.supabase + "/auth/v1",
        exp: now() + 3600,
      }),
    ).toString("base64url") +
    ".synthetic";
  const result = (data, status = 200) => ({
    status,
    text: JSON.stringify(data),
  });
  function newInvoice(s, status = "paid") {
    const item = s.items.data[0],
      n = [...invoices.values()].flat().length + 1;
    const i = {
      id: "in_local_" + n,
      customer: m.customer,
      livemode: false,
      parent: { subscription_details: { subscription: s.id } },
      status,
      currency: "jpy",
      amount_paid: status === "paid" ? 980 : 0,
      total: 980,
      created: now(),
      period_start: item.current_period_start,
      period_end: item.current_period_end,
      status_transitions: { paid_at: status === "paid" ? now() : null },
      lines: {
        has_more: false,
        data: [
          {
            quantity: 1,
            pricing: { price_details: { price: m.price } },
            period: {
              start: item.current_period_start,
              end: item.current_period_end,
            },
          },
        ],
      },
    };
    invoices.set(s.id, [...(invoices.get(s.id) || []), i]);
    s.latest_invoice = i;
    return i;
  }
  function pay(id) {
    const cs = checkouts.get(id);
    check(cs && cs.status === "open");
    const s = {
      id: "sub_local_" + (subscriptions.size + 1),
      customer: m.customer,
      livemode: false,
      metadata: { user_id: m.c.id, app: "yorisoi" },
      status: "active",
      created: now() + subscriptions.size,
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      items: {
        data: [
          {
            quantity: 1,
            price: { ...price },
            current_period_start: now() - 30,
            current_period_end: now() + 2592000,
          },
        ],
      },
    };
    subscriptions.set(s.id, s);
    newInvoice(s);
    Object.assign(cs, {
      status: "complete",
      subscription: s.id,
      payment_status: "paid",
    });
    state.payments++;
    return s;
  }
  function transition(id, kind) {
    const s = subscriptions.get(id);
    check(s);
    if (kind === "renewed") {
      s.items.data[0].current_period_start = now() - 10;
      s.items.data[0].current_period_end = now() + 5184000;
      newInvoice(s);
    } else if (kind === "failed") {
      s.status = "past_due";
      s.items.data[0].current_period_start = now() - 10;
      s.items.data[0].current_period_end = now() + 2592000;
      for (const i of invoices.get(id)) i.lines.data[0].period.end = now() - 5;
      newInvoice(s, "open");
    } else if (kind === "ended") {
      s.status = "canceled";
      s.ended_at = now();
      s.canceled_at = now();
    } else if (kind === "future") {
      s.items.data[0].current_period_start = now() + 2592000;
      s.items.data[0].current_period_end = now() + 5184000;
      // Separate future-entitlement boundary: no fifth invoice in the four-invoice scenario.
    } else check(false);
    return s;
  }
  let serial = Promise.resolve();
  async function handle(r) {
    const u = new URL(r.url),
      q = Object.fromEntries(u.searchParams),
      h = new Headers(r.headers),
      method = r.method || "GET",
      b = r.body ? JSON.parse(u.origin === TARGET.stripe ? "{}" : r.body) : {};
    calls.push({ method, path: u.pathname });
    if (u.origin === TARGET.stripe) {
      const p = u.pathname,
        f = new URLSearchParams(r.body || "");
      if (p === "/v1/account") return result({ id: TARGET.account });
      if (p === "/v1/prices/" + m.price)
        return result({ ...price, active: state.priceActive });
      if (p === "/v1/customers/" + m.customer) return result(customer);
      if (p === "/v1/billing_portal/configurations/" + m.portal)
        return result({
          id: m.portal,
          livemode: false,
          active: true,
          features: {
            subscription_update: { enabled: false },
            customer_update: { enabled: false },
            subscription_cancel: { enabled: true, mode: "at_period_end" },
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
          },
        });
      if (p === "/v1/billing_portal/sessions") {
        state.portals++;
        return result({
          id: "bps_local_" + state.portals,
          url: TARGET.app + "/__subscription/portal",
          livemode: false,
        });
      }
      if (p === "/v1/subscriptions")
        return result({ data: [...subscriptions.values()], has_more: false });
      if (p.startsWith("/v1/subscriptions/")) {
        const s = subscriptions.get(p.split("/").at(-1));
        check(s);
        if (method === "POST")
          s.cancel_at_period_end = f.get("cancel_at_period_end") === "true";
        return result(s);
      }
      if (p === "/v1/invoices")
        return result({
          data: invoices.get(q.subscription) || [],
          has_more: false,
        });
      if (p === "/v1/checkout/sessions" && method === "POST") {
        const cs = {
          id: "cs_test_local_" + (checkouts.size + 1),
          mode: "subscription",
          customer: m.customer,
          livemode: false,
          amount_total: 980,
          currency: "jpy",
          status: "open",
          payment_status: "unpaid",
          metadata: { user_id: m.c.id },
          url: TARGET.app + "/__subscription/checkout/" + (checkouts.size + 1),
        };
        checkouts.set(cs.id, cs);
        return result(cs);
      }
      if (p.startsWith("/v1/checkout/sessions/"))
        return result(checkouts.get(p.split("/").at(-1)));
      throw Error("SYNTHETIC_STRIPE_UNIMPLEMENTED");
    }
    check(u.origin === TARGET.supabase);
    if (u.pathname === "/auth/v1/token") {
      let user = [m.c, m.d].find((x) => x.email === b.email);
      if (!user && b.refresh_token)
        user = [m.c, m.d].find((x) => "refresh-" + x.id === b.refresh_token);
      check(
        user && (!b.password || b.password === "SyntheticOnly123!"),
        "AUTH_FAILED",
      );
      const s = {
        access_token: token(user.id),
        refresh_token: "refresh-" + user.id,
        expires_in: 3600,
        expires_at: now() + 3600,
        token_type: "bearer",
        user: {
          ...user,
          email_confirmed_at: "2026-01-01T00:00:00Z",
          aud: "authenticated",
          role: "authenticated",
          ...(state.authUserPadding
            ? {
                user_metadata: {
                  fixture_padding: "x".repeat(state.authUserPadding),
                },
              }
            : {}),
        },
      };
      sessions.set(s.access_token, s);
      return result(s);
    }
    if (u.pathname === "/auth/v1/user") {
      const s = sessions.get(h.get("authorization")?.slice(7));
      return s ? result(s.user) : result({ code: "invalid_token" }, 401);
    }
    const t = u.pathname.slice(9),
      values = [],
      where = [];
    if (t.startsWith("rpc/")) {
      const names = {
        consume_limit: ["p_key", "p_limit", "p_seconds"],
        claim_anonymous_diagnoses: ["p_user", "p_session"],
        consultation_entitlement: ["p_user"],
        acquire_lock: ["p_key", "p_token"],
        apply_subscription_snapshot: [
          "p_snapshot",
          "p_invoices",
          "p_event",
          "p_type",
          "p_hash",
        ],
      };
      const name = t.slice(4);
      check(names[name]);
      await pg.exec("set role service_role");
      try {
        return result(
          (
            await pg.query(
              "select " +
                name +
                "(" +
                names[name].map((_, i) => "$" + (i + 1)).join(",") +
                ") as v",
              names[name].map((k) =>
                typeof b[k] === "object" && b[k] !== null
                  ? JSON.stringify(b[k])
                  : b[k],
              ),
            )
          ).rows[0].v,
        );
      } finally {
        await pg.exec("reset role");
      }
    }
    check(/^[a-z_]+$/.test(t));
    for (const [k, v] of Object.entries(q)) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      check(/^[a-z_]+$/.test(k));
      if (v === "is.null") {
        where.push('"' + k + '" is null');
        continue;
      }
      const op = v.startsWith("eq.") ? "=" : v.startsWith("neq.") ? "<>" : null;
      check(op);
      values.push(v.slice(v.indexOf(".") + 1));
      where.push('"' + k + '"' + op + "$" + values.length);
    }
    const select = q.select || "*";
    check(select === "*" || /^[a-z_]+(,[a-z_]+)*$/.test(select));
    let sql;
    const filter = where.length ? " where " + where.join(" and ") : "";
    if (method === "GET") {
      let order = "";
      if (q.order) {
        const [col, dir] = q.order.split(".");
        check(/^[a-z_]+$/.test(col) && ["asc", "desc"].includes(dir));
        order = " order by " + col + " " + dir;
      }
      sql =
        "select " +
        select +
        " from " +
        t +
        filter +
        order +
        (q.limit ? " limit " + Number(q.limit) : "") +
        (q.offset ? " offset " + Number(q.offset) : "");
    } else if (method === "DELETE")
      sql = "delete from " + t + filter + " returning *";
    else {
      check(Object.keys(b).every((k) => /^[a-z_]+$/.test(k)));
      const columns = Object.keys(b),
        params = columns.map((k) => {
          values.push(
            typeof b[k] === "object" && b[k] !== null
              ? JSON.stringify(b[k])
              : b[k],
          );
          return "$" + values.length;
        });
      if (method === "POST")
        sql =
          "insert into " +
          t +
          "(" +
          columns.join(",") +
          ") values(" +
          params.join(",") +
          ") returning *";
      else {
        check(method === "PATCH");
        sql =
          "update " +
          t +
          " set " +
          columns.map((k, i) => k + "=" + params[i]).join(",") +
          filter +
          " returning *";
      }
    }
    const session = sessions.get(h.get("authorization")?.slice(7));
    const role =
      h.get("apikey") === "local-anon"
        ? session
          ? "authenticated"
          : "anon"
        : "service_role";
    await pg.exec("begin");
    try {
      await pg.exec("set local role " + role);
      await pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
        session?.user.id || "",
      ]);
      const rows = (await pg.query(sql, values)).rows;
      await pg.exec("commit");
      return result(
        h.get("accept")?.includes("vnd.pgrst.object")
          ? (rows[0] ?? null)
          : rows,
      );
    } catch (e) {
      await pg.exec("rollback");
      return result({ code: e.code }, 400);
    }
  }
  const transport = (r) => {
    const task = serial.then(() => handle(r));
    serial = task.catch(() => {});
    return task;
  };
  const protectedState = async () => {
    const out = {};
    for (const table of [
      "payments",
      "paid_reports",
      "diagnoses",
      "diagnosis_answers",
      "free_reports",
      "profiles",
      "auth.users",
    ]) {
      const rows = (await pg.query("select * from " + table + " order by 1"))
        .rows;
      out[table] = rows;
    }
    return JSON.stringify(out);
  };
  return {
    pg,
    m,
    transport,
    subscriptions,
    invoices,
    checkouts,
    sessions,
    calls,
    state,
    pay,
    transition,
    protectedState,
    close: () => pg.close(),
  };
}
