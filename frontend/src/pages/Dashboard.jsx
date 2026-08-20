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
    supabase.from("shops").select("id, name, slug, upi_vpa, upi_payee_name, price_bw_per_page, price_color_per_page, is_active").eq("slug", shopSlug).single().then(({ data }) => setShop(data));
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

  function tryUnlock() {
    // The PIN itself is verified server-side inside shop_confirms_payment —
    // this local check is just to gate the dashboard UI. Real enforcement
    // happens on every confirm action below.
    setUnlocked(true);
    setPinError("");
  }

  async function confirmOrder(orderId) {
    const { data, error } = await supabase.rpc("shop_confirms_payment", {
      p_order_id: orderId,
      p_pin: pin,
    });
    if (error || data === false) {
      setPinError("Wrong PIN — payment not confirmed.");
      setUnlocked(false);
      return;
    }
    loadOrders();
  }

  if (!shop) return <div className="p-6">Loading...</div>;

  if (!unlocked) {
    return (
      <div className="max-w-sm mx-auto p-6 space-y-4">
        <h1 className="text-xl font-bold">{shop.name} — Dashboard</h1>
        <input
          type="password"
          placeholder="Enter shop PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="border rounded p-2 w-full"
        />
        {pinError && <p className="text-red-600 text-sm">{pinError}</p>}
        <button onClick={tryUnlock} className="w-full bg-blue-600 text-white rounded py-2">
          Unlock
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">{shop.name} — Orders</h1>
      {orders.length === 0 && <p className="text-gray-500">No pending orders.</p>}
      {orders.map((o) => (
        <div key={o.id} className="border rounded p-4 flex justify-between items-center">
          <div>
            <p className="font-medium">#{o.order_number} — ₹{o.amount}</p>
            <p className="text-sm text-gray-600">
              {o.page_count} page(s), {o.color_mode}, {o.copies} copies — {o.status}
            </p>
          </div>
          {o.status === "awaiting_confirmation" && (
            <button
              onClick={() => confirmOrder(o.id)}
              className="bg-green-600 text-white rounded px-4 py-2 text-sm"
            >
              Confirm Payment
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
