const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (
    ![
      "https://ukdzggjfkcwjssjmnqim.supabase.co",
      "https://api.stripe.com",
    ].includes(new URL(request.url).origin)
  )
    throw new Error("PAYMENT_EGRESS_DENIED");
  const body = ["GET", "HEAD"].includes(request.method)
    ? ""
    : await request.text();
  return original("http://127.0.0.1:5209/proxy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payment-token": process.env.PAYMENT_PROXY_TOKEN,
    },
    body: JSON.stringify({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body,
    }),
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(18000),
      ...(request.signal ? [request.signal] : []),
    ]),
  });
};
