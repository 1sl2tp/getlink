export type IntentName =
  | "ignore"
  | "add_item"
  | "change_qty"
  | "remove_item"
  | "price_query"
  | "price_list"
  | "confirm"
  | "decline"
  | "clarification_answer";

export type ResolutionSource =
  | "customer_alias"
  | "store_alias"
  | "canonical"
  | "fuzzy"
  | "llm"
  | "clarification"
  | "admin_edit";

export type ParsedIntent = {
  intent: IntentName;
  raw_product_text: string;
  quantity: number | null;
  unit_hint: string | null;
  attributes: Record<string, unknown>;
  line_note: string;
  reference_target: string | null;
  needs_clarification: boolean;
  clarification_question_hint?: string | null;
};

const INTENTS = new Set<IntentName>([
  "ignore","add_item","change_qty","remove_item","price_query","price_list",
  "confirm","decline","clarification_answer",
]);

function asText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g," ").trim();
}

export function validateParsedIntent(input: unknown): ParsedIntent {
  if (!input || typeof input !== "object") throw new Error("invalid_intent_payload");
  const row = input as Record<string, unknown>;
  const intent = asText(row.intent) as IntentName;
  if (!INTENTS.has(intent)) throw new Error("invalid_intent");

  let quantity: number | null = null;
  if (row.quantity !== null && row.quantity !== undefined && row.quantity !== "") {
    quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid_quantity");
  }
  if ((intent === "add_item" || intent === "change_qty") && quantity === null) {
    throw new Error("quantity_required");
  }

  const rawProductText = asText(row.raw_product_text);
  if (["add_item","change_qty","remove_item","price_query"].includes(intent) && !rawProductText) {
    throw new Error("product_text_required");
  }

  const attributes = row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes)
    ? row.attributes as Record<string, unknown>
    : {};

  return {
    intent,
    raw_product_text: rawProductText,
    quantity,
    unit_hint: row.unit_hint == null ? null : asText(row.unit_hint) || null,
    attributes,
    line_note: asText(row.line_note),
    reference_target: row.reference_target == null ? null : asText(row.reference_target) || null,
    needs_clarification: Boolean(row.needs_clarification),
    clarification_question_hint: row.clarification_question_hint == null
      ? null
      : asText(row.clarification_question_hint) || null,
  };
}

export type ProductResolution = {
  productCode: string;
  productName: string;
  confidence: number;
  source: ResolutionSource;
} | null;
