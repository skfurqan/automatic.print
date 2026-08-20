import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { calcPrice, buildUpiLink } from "../lib/pricing";

export default function Order() {
  const { shopSlug } = useParams();
  const [shop, setShop] = useState(null);
  const [files, setFiles] = useState([]);
  const [colorMode, setColorMode] = useState("bw");
  const [duplex, setDuplex] = useState(false);
  const [copies, setCopies] = useState(1);
  const [order, setOrder] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("shops")
      .select("*")
      .eq("slug", shopSlug)
      .single()
      .then(({ data, error }) => {
        if (error) setError("Shop not found.");
        else setShop(data);
      });
  }, [shopSlug]);

  function handleFileChange(e) {
    setFiles(Array.from(e.target.files));
  }

  async function createOrder() {
    if (!files.length) return setError("Choose at least one file first.");
    setUploading(true);
    setError("");

    try {
      const orderId = crypto.randomUUID();
      const filePaths = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split(".").pop();
        const path = `${shop.id}/${orderId}/page_${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("print-uploads")
          .upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        filePaths.push(path);
      }

      const amount = calcPrice({
        pageCount: files.length,
        colorMode,
        duplex,
        copies,
        shop,
      });

      const { data, error: insertErr } = await supabase
        .from("orders")
        .insert({
          id: orderId,
          shop_id: shop.id,
          file_paths: filePaths,
          page_count: files.length,
          color_mode: colorMode,
          duplex,
          copies,
          amount,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      setOrder(data);
    } catch (e) {
      setError(e.message || "Something went wrong uploading your files.");
    } finally {
      setUploading(false);
    }
  }

  async function markPaid() {
    await supabase.rpc("customer_marks_paid", { p_order_id: order.id });
    setOrder({ ...order, status: "awaiting_confirmation" });
    pollStatus(order.id);
  }

  function pollStatus(orderId) {
    const interval = setInterval(async () => {
      const { data } = await supabase.from("orders").select("status, order_number").eq("id", orderId).single();
      if (data) {
        setOrder((prev) => ({ ...prev, ...data }));
        if (data.status === "completed") clearInterval(interval);
      }
    }, 3000);
  }

  if (error && !shop) return <div className="p-6 text-red-600">{error}</div>;
  if (!shop) return <div className="p-6">Loading...</div>;

  if (order) {
    return <OrderStatus order={order} shop={shop} onMarkPaid={markPaid} />;
  }

  const amount = files.length
    ? calcPrice({ pageCount: files.length, colorMode, duplex, copies, shop })
    : 0;

  return (
    <div className="max-w-md mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-bold">{shop.name}</h1>

      <div>
        <label className="block font-medium mb-1">Upload your file(s)</label>
        <input
          type="file"
          multiple
          accept="image/*,.pdf"
          onChange={handleFileChange}
          className="block w-full border rounded p-2"
        />
        {files.length > 0 && (
          <p className="text-sm text-gray-600 mt-1">{files.length} file(s) selected</p>
        )}
      </div>

      {files.length === 2 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} />
          Treat these as Front & Back of the same document
        </label>
      )}

      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input type="radio" checked={colorMode === "bw"} onChange={() => setColorMode("bw")} />
          Black & White (₹{shop.price_bw_per_page}/page)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={colorMode === "color"} onChange={() => setColorMode("color")} />
          Color (₹{shop.price_color_per_page}/page)
        </label>
      </div>

      <div>
        <label className="block font-medium mb-1">Copies</label>
        <input
          type="number"
          min={1}
          value={copies}
          onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
          className="border rounded p-2 w-20"
        />
      </div>

      <div className="text-xl font-semibold">Total: ₹{amount.toFixed(2)}</div>

      {error && <p className="text-red-600">{error}</p>}

      <button
        onClick={createOrder}
        disabled={uploading || !files.length}
        className="w-full bg-blue-600 text-white rounded py-3 font-medium disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Continue to Pay"}
      </button>
    </div>
  );
}

function OrderStatus({ order, shop, onMarkPaid }) {
  const upiLink = buildUpiLink({ shop, amount: order.amount, orderNumber: order.order_number });

  const statusMessages = {
    pending_payment: "Pay to complete your order",
    awaiting_confirmation: "Waiting for the shop to confirm your payment...",
    queued: "Payment confirmed! Your print is in the queue.",
    printing: "Printing now...",
    completed: "Done! Collect your printout at the counter.",
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-5 text-center">
      <h2 className="text-xl font-bold">Order #{order.order_number}</h2>
      <p className="text-3xl font-bold">₹{order.amount}</p>

      {order.status === "pending_payment" && (
        <>
          <a
            href={upiLink}
            className="block w-full bg-green-600 text-white rounded py-3 font-medium"
          >
            Pay with UPI
          </a>
          <button
            onClick={onMarkPaid}
            className="w-full border border-gray-400 rounded py-3 font-medium"
          >
            I've Paid
          </button>
        </>
      )}

      <p className="text-gray-700">{statusMessages[order.status] || order.status}</p>
    </div>
  );
}
