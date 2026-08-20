// Real pricing logic — matches shops.price_bw_per_page / price_color_per_page
export function calcPrice({ pageCount, colorMode, duplex, copies, shop }) {
  const perPage = colorMode === "color" ? shop.price_color_per_page : shop.price_bw_per_page;
  // duplex halves physical sheets but not "pages printed" pricing —
  // shop still charges per printed side, so duplex doesn't change price here.
  const total = perPage * pageCount * copies;
  return Math.round(total * 100) / 100;
}

// Builds a real UPI deep link with the shop's actual VPA and a
// per-order-unique amount (down to the paisa) so, if the shop is also
// glancing at their PhonePe notification, the amount alone identifies
// which order just got paid.
export function buildUpiLink({ shop, amount, orderNumber }) {
  const params = new URLSearchParams({
    pa: shop.upi_vpa,
    pn: shop.upi_payee_name,
    am: amount.toFixed(2),
    cu: "INR",
    tn: `Print order #${orderNumber}`,
  });
  return `upi://pay?${params.toString()}`;
}
