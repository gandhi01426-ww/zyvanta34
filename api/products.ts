import type { VercelRequest, VercelResponse } from "./_lib/vercel-types.js";
import { createUniqueCode, normalizeCode } from "./_lib/codes.js";
import { allowMethods, json } from "./_lib/http.js";
import { requireAdmin, supabaseConfigured, supabaseFetch } from "./_lib/supabase.js";

function paymentFields(body: Record<string, unknown> | undefined) {
  const allow_pay_now = body?.allow_pay_now !== false;
  const allow_cod = body?.allow_cod !== false;
  return { allow_pay_now, allow_cod };
}

function pricingFields(body: Record<string, unknown> | undefined) {
  const shippingValue = Number(body?.shipping_charge);
  const taxValue = Number(body?.tax_percent);
  const payNowDiscountValue = Number(body?.pay_now_discount_percent);
  return {
    shipping_charge: Number.isFinite(shippingValue) ? Math.max(0, Math.round(shippingValue)) : 99,
    tax_percent: Number.isFinite(taxValue) ? Math.min(100, Math.max(0, taxValue)) : 5,
    pay_now_discount_percent: Number.isFinite(payNowDiscountValue) ? Math.min(100, Math.max(0, payNowDiscountValue)) : 0,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethods(req, res, ["GET", "POST", "PUT", "DELETE", "OPTIONS"])) return;
  try {
    if (!supabaseConfigured()) return json(res, 503, { error: "Supabase is not configured." });

    if (req.method === "GET") {
      const adminView = req.query.admin === "true";
      if (adminView) await requireAdmin(req);
      const activeFilter = adminView ? "" : "&is_active=eq.true";
      const rows = await supabaseFetch(`products?select=*${activeFilter}&order=is_active.desc,sort_order.asc,name.asc`);
      return json(res, 200, { products: rows });
    }

    await requireAdmin(req);

    if (req.method === "POST") {
      const code = normalizeCode(req.body?.code) || await createUniqueCode("ZYP", "products");
      const payments = paymentFields(req.body);
      const pricing = pricingFields(req.body);
      if (!payments.allow_pay_now && !payments.allow_cod) return json(res, 400, { error: "Select at least one payment method for this product." });
      const [product] = await supabaseFetch<unknown[]>("products", {
        method: "POST",
        body: { ...req.body, ...payments, ...pricing, code, updated_at: new Date().toISOString() },
        prefer: "return=representation",
      });
      return json(res, 201, { product });
    }

    const id = String(req.query.id || req.body?.id || "");
    if (!id) return json(res, 400, { error: "Product id is required." });

    if (req.method === "PUT") {
      const existing = await supabaseFetch<{ code?: string }[]>(
        `products?select=code&id=eq.${encodeURIComponent(id)}&limit=1`,
      );
      const code = normalizeCode(req.body?.code) || normalizeCode(existing[0]?.code) || await createUniqueCode("ZYP", "products");
      const payments = paymentFields(req.body);
      const pricing = pricingFields(req.body);
      if (!payments.allow_pay_now && !payments.allow_cod) return json(res, 400, { error: "Select at least one payment method for this product." });
      const [product] = await supabaseFetch<unknown[]>(`products?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { ...req.body, id: undefined, ...payments, ...pricing, code, updated_at: new Date().toISOString() },
        prefer: "return=representation",
      });
      return json(res, 200, { product });
    }

    await supabaseFetch(`products?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { is_active: false, updated_at: new Date().toISOString() },
    });
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Product request failed." });
  }
}
