import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Order from "./pages/Order";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/p/:shopSlug" element={<Order />} />
        <Route path="/p/:shopSlug/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/p/test-kiosk" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
