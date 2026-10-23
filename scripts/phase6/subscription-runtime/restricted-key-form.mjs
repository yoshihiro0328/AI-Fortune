// Execute only as a read-only CUA page evaluation on an owner-opened draft.
// Never return page text, key values, unexpected names, or exception details.
export function restrictedKeyFormState({ expectedName }) {
  const denied = { allowed: false };
  if (
    location.href !==
      "https://dashboard.stripe.com/acct_1UQlQdI73kTcvXz8/test/apikeys/create" ||
    !/^yorisoi-plus-[a-f0-9]{8}-(listener|app|lifecycle)$/.test(expectedName)
  )
    return denied;
  const input = document.querySelector('main input[id="key-name"]');
  if (!input || (input.value !== "" && input.value !== expectedName))
    return denied;
  const resources = [
    "Accounts",
    "Events",
    "Checkout Sessions",
    "Debugging Tools",
    "Prices",
    "Customers",
    "Subscriptions",
    "Invoices",
    "Customer Portal",
  ];
  const selected = [];
  const rows = document.querySelectorAll("main tr");
  if (rows.length < 2) return denied;
  for (const row of rows) {
    const buttons = row.querySelectorAll(
      '[role="button"].db-SegmentedControlOption--selected',
    );
    for (const button of buttons) {
      const choice = button.textContent?.trim();
      if (choice === "なし") continue;
      const resource = row.children[0]?.textContent?.trim();
      if (
        row.querySelector("a") ||
        !resources.includes(resource) ||
        !["読み取り", "書き込み"].includes(choice)
      )
        return denied;
      selected.push([resources[resources.indexOf(resource)], choice]);
    }
  }
  return { allowed: true, blank: input.value === "", selected };
}

// A redirect between the metadata check and evaluation is checked again inside
// the page. An unexpected page is never read via DOM/AX/screenshot fallback.
export async function inspectRestrictedKeyDraft(tab, expectedName) {
  if (
    (await tab.url()) !==
    "https://dashboard.stripe.com/acct_1UQlQdI73kTcvXz8/test/apikeys/create"
  )
    return { allowed: false };
  return tab.playwright.evaluate(restrictedKeyFormState, { expectedName });
}

// Persist the intent outside this helper before invoking it. A rejected or
// uncertain submit consumes this instance: no retry and no post-click read.
export function restrictedKeySubmitOnce() {
  let attempted = false;
  return async ({ inspect, submit, permissions }) => {
    if (attempted) throw Error("KEY_SUBMIT_ALREADY_ATTEMPTED");
    const state = await inspect();
    const normalize = (rows) =>
      JSON.stringify([...rows].map(JSON.stringify).sort());
    if (
      !state.allowed ||
      state.blank ||
      normalize(state.selected) !== normalize(permissions)
    )
      throw Error("KEY_DRAFT_DENIED");
    attempted = true;
    await submit();
    return { submittedOnce: true, creationVerified: false };
  };
}
