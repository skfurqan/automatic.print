import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function Dashboard() {
  const { shopSlug } = useParams();
  const [shop, setShop] = useState(null);
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinError, setPinError] = useState("");
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    supabase
      .from("shops")
      .select("id, name, slug, upi_vpa, upi_payee_name, price_bw_per_page, price_color_per_page, is_active")
      .eq("slug", shopSlug)
      .single()
      .then(({ data }) => setShop(data));
  }, [shopSlug]);

  useEffect(() => {
    if (!unlocked || !shop) return;
    loadOrders();
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, [unlocked, shop]);

  async function loadOrders() {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("shop_id", shop.id)
      .in("status", ["awaiting_confirmation", "queued", "printing"])
      .order("created_at", { ascending: true });
    setOrders(data || []);
  }

  async function confirmOrder(orderId) {
    const { data, error } = await supabase.rpc("shop_confirms_payment", { p_order_id: orderId, p_pin: pin });
    if (error || data === false) {
      setPinError("Wrong PIN — payment not confirmed.");
      setUnlocked(false);
      return;
    }
    loadOrders();
  }

  if (!shop) return <div className="page"><div className="card loading">Loading...</div></div>;

  if (!unlocked) {
    return (
      <div className="page">
        <div className="card">
          <div className="brand">
            <div className="brand-icon">🔒</div>
            <div>
              <h1>{shop.name}</h1>
              <p>Dashboard — PIN required</p>
            </div>
          </div>
          <input
            type="password"
            inputMode="numeric"
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="pin-input"
          />
          {pinError && <p className="error-text">{pinError}</p>}
          <button className="btn btn-primary" onClick={() => { setUnlocked(true); setPinError(""); }}>
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="brand">
          <div className="brand-icon">📋</div>
          <div>
            <h1>{shop.name}</h1>
            <p>Live orders</p>
          </div>
        </div>

        {orders.length === 0 && <div className="empty-state">No pending orders right now.</div>}

        {orders.map((o) => (
          <div key={o.id} className="order-list-item">
            <div>
              <div style={{ fontWeight: 600 }}>Order #{o.order_number} — ₹{o.amount}</div>
              <div className="meta">{o.page_count} page(s), {o.color_mode}, {o.copies}x copies — {o.status}</div>
            </div>
            {o.status === "awaiting_confirmation" && (
              <button
                className="btn btn-primary"
                style={{ width: "auto", padding: "10px 16px", fontSize: 13 }}
                onClick={() => confirmOrder(o.id)}
              >
                Confirm
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
