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
      .select("id, name, slug, upi_vpa, upi_payee_name, price_bw_per_page, price_color_per_page, is_active")
      .eq("slug", shopSlug)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("Shop fetch failed:", error);
          setError(`Shop not found (${error.message}).`);
        } else setShop(data);
      });
  }, [shopSlug]);

  function handleFileChange(e) {
    setFiles(Array.from(e.target.files));
    setError("");
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

      const amount = calcPrice({ pageCount: files.length, colorMode, duplex, copies, shop });

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

  if (error && !shop) {
    return (
      <div className="page">
        <div className="card"><p className="error-text">{error}</p></div>
      </div>
    );
  }
  if (!shop) return <div className="page"><div className="card loading">Loading...</div></div>;

  if (order) return <OrderStatus order={order} shop={shop} onMarkPaid={markPaid} />;

  const amount = files.length ? calcPrice({ pageCount: files.length, colorMode, duplex, copies, shop }) : 0;

  return (
    <div className="page">
      <div className="card">
        <div className="brand">
          <div className="brand-icon">🖨️</div>
          <div>
            <h1>{shop.name}</h1>
            <p>Scan, upload, print — no counter queue</p>
          </div>
        </div>

        <div className="field">
          <label>Upload your file(s)</label>
          <label className="upload-box">
            <input type="file" multiple accept="image/*,.pdf" onChange={handleFileChange} />
            <div>{files.length ? "Change files" : "Tap to choose files"}</div>
            <div className="upload-hint">Images or PDF, multiple allowed</div>
          </label>
          {files.length > 0 && <p className="file-count">{files.length} file(s) selected</p>}
        </div>

        {files.length === 2 && (
          <label className="checkbox-row">
            <input type="checkbox" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} />
            Treat these as Front & Back of the same document
          </label>
        )}

        <div className="field">
          <label>Color mode</label>
          <div className="option-grid">
            <div
              className={`option-card ${colorMode === "bw" ? "selected" : ""}`}
              onClick={() => setColorMode("bw")}
            >
              Black &amp; White
              <span className="price">₹{shop.price_bw_per_page}/page</span>
            </div>
            <div
              className={`option-card ${colorMode === "color" ? "selected" : ""}`}
              onClick={() => setColorMode("color")}
            >
              Color
              <span className="price">₹{shop.price_color_per_page}/page</span>
            </div>
          </div>
        </div>

        <div className="field">
          <label>Copies</label>
          <div className="stepper">
            <button onClick={() => setCopies((c) => Math.max(1, c - 1))}>−</button>
            <input type="text" readOnly value={copies} />
            <button onClick={() => setCopies((c) => c + 1)}>+</button>
          </div>
        </div>

        <div className="total-row">
          <span className="total-label">Total</span>
          <span className="total-amount">₹{amount.toFixed(2)}</span>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" onClick={createOrder} disabled={uploading || !files.length}>
          {uploading ? "Uploading..." : "Continue to Pay"}
        </button>
      </div>
    </div>
  );
}

function OrderStatus({ order, shop, onMarkPaid }) {
  const upiLink = buildUpiLink({ shop, amount: order.amount, orderNumber: order.order_number });

  const statusMessages = {
    pending_payment: "Pay to complete your order",
    awaiting_confirmation: "Waiting for the shop to confirm your payment...",
    queued: "Payment confirmed — your print is in the queue.",
    printing: "Printing now...",
    completed: "Done! Collect your printout at the counter.",
  };

  return (
    <div className="page">
      <div className="card status-card">
        <div className="order-number">Order #{order.order_number}</div>
        <div className="status-amount">₹{order.amount}</div>

        {order.status === "pending_payment" && (
          <>
            <a href={upiLink} className="btn btn-success" style={{ display: "block", textDecoration: "none", lineHeight: "1.6" }}>
              Pay with UPI
            </a>
            <button className="btn btn-outline" onClick={onMarkPaid}>I've Paid</button>
          </>
        )}

        <div className={`status-badge ${order.status === "completed" ? "done" : ""}`}>
          {statusMessages[order.status] || order.status}
        </div>
      </div>
    </div>
  );
}
