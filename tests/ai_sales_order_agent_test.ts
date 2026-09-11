import assert from "node:assert/strict";

async function loadModule(path: string): Promise<any> {
  try {
    return await import(new URL(path, import.meta.url).href);
  } catch (error) {
    assert.fail(`required AI sales-agent module is missing or invalid: ${path}\n${String(error)}`);
  }
}

Deno.test("normalizeCustomerText removes accents and collapses spacing", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/normalize.ts");
  assert.equal(mod.normalizeCustomerText("  Bi bé   màu 2 "), "bi be mau 2");
});

Deno.test("nextRoundSuggestion offers 17 to 20 but not 11 to 15", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/rules.ts");
  assert.deepEqual(mod.nextRoundSuggestion(17), { target: 20, gap: 3 });
  assert.equal(mod.nextRoundSuggestion(11), null);
  assert.equal(mod.nextRoundSuggestion(4), null);
});

Deno.test("marketComparison rejects stale data and classifies fresh comparison", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/commerce.ts");
  const now = new Date("2026-09-12T12:00:00.000Z");
  const store = {
    productCode: "HH30",
    priceVnd: 188000,
    equivalenceKey: "hao-hao:30-goi",
  };
  const fresh = {
    priceVnd: 185000,
    equivalenceKey: "hao-hao:30-goi",
    checkedAt: "2026-09-12T08:00:00.000Z",
  };
  const stale = {
    ...fresh,
    checkedAt: "2026-09-11T11:59:59.000Z",
  };
  assert.equal(mod.marketComparison(store, stale, now), null);
  const result = mod.marketComparison(store, fresh, now);
  assert.equal(result?.position, "store_higher");
  assert.equal(result?.differenceVnd, 3000);
});

Deno.test("resolution source order is customer alias then store alias then canonical then fuzzy", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/matcher.ts");
  assert.ok(mod.resolutionSourceRank("customer_alias") < mod.resolutionSourceRank("store_alias"));
  assert.ok(mod.resolutionSourceRank("store_alias") < mod.resolutionSourceRank("canonical"));
  assert.ok(mod.resolutionSourceRank("canonical") < mod.resolutionSourceRank("fuzzy"));
});

Deno.test("validateParsedIntent accepts structured add item and rejects invalid quantity", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/types.ts");
  const valid = mod.validateParsedIntent({
    intent: "add_item",
    raw_product_text: "bi be mau",
    quantity: 2,
    unit_hint: null,
    attributes: {},
    line_note: "",
    reference_target: null,
    needs_clarification: false,
  });
  assert.equal(valid.intent, "add_item");
  assert.equal(valid.quantity, 2);
  assert.throws(() => mod.validateParsedIntent({ ...valid, quantity: -1 }));
});
