"""
Print Kiosk — Local Agent
Runs on the shop's PC, connected to the physical printer.

What it does, every 3 seconds:
  1. Ask Supabase: "give me the OLDEST order with status='queued' for this shop"
  2. Lock it (status -> 'printing') so a second poll can't grab it too
  3. Download the file(s) from Supabase Storage
  4. Send to the OS default printer
  5. Mark status -> 'completed'
  6. Repeat

Setup (one-time):
  pip install supabase requests pywin32   (pywin32 only needed on Windows)
  Create a .env file next to this script (see .env.example below) with
  your REAL service_role key — this script needs it because it must
  bypass RLS to update order status and download private files. This
  key must NEVER be shared, committed to git, or put in the frontend.

Run:
  python agent.py
"""

import os
import sys
import time
import tempfile
import platform
from pathlib import Path

from supabase import create_client

# ---- Config: loaded from real environment, no placeholders ----
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
SHOP_SLUG = os.environ.get("SHOP_SLUG", "test-kiosk")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "3"))

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def get_shop_id() -> str:
    res = supabase.table("shops").select("id").eq("slug", SHOP_SLUG).single().execute()
    return res.data["id"]


def claim_next_order(shop_id: str):
    """Get the oldest queued order and atomically lock it to 'printing'."""
    res = (
        supabase.table("orders")
        .select("*")
        .eq("shop_id", shop_id)
        .eq("status", "queued")
        .order("paid_at", desc=False)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None

    order = res.data[0]

    # Atomic claim: only succeeds if status is still 'queued' — this is
    # what prevents two orders (or a race with itself) from double-printing.
    claim = (
        supabase.table("orders")
        .update({"status": "printing"})
        .eq("id", order["id"])
        .eq("status", "queued")
        .execute()
    )
    if not claim.data:
        return None  # someone/something else claimed it first

    return order


def download_files(order) -> list[Path]:
    local_paths = []
    tmp_dir = Path(tempfile.mkdtemp(prefix="printjob_"))
    for i, storage_path in enumerate(order["file_paths"]):
        file_bytes = supabase.storage.from_("print-uploads").download(storage_path)
        ext = Path(storage_path).suffix or ".pdf"
        local_path = tmp_dir / f"page_{i}{ext}"
        local_path.write_bytes(file_bytes)
        local_paths.append(local_path)
    return local_paths


def send_to_printer(file_path: Path, copies: int = 1):
    system = platform.system()
    for _ in range(copies):
        if system == "Windows":
            import win32api  # pywin32
            win32api.ShellExecute(0, "print", str(file_path), None, ".", 0)
        else:
            # Linux/macOS: uses CUPS `lp`, standard on both.
            os.system(f'lp "{file_path}"')


def mark_completed(order_id: str):
    supabase.table("orders").update(
        {"status": "completed", "completed_at": "now()"}
    ).eq("id", order_id).execute()


def main():
    print(f"Print Kiosk agent started for shop '{SHOP_SLUG}'. Polling every {POLL_SECONDS}s...")
    shop_id = get_shop_id()
    print(f"Shop ID: {shop_id}")

    while True:
        try:
            order = claim_next_order(shop_id)
            if order:
                print(f"Order #{order['order_number']}: printing {len(order['file_paths'])} file(s)...")
                files = download_files(order)
                for f in files:
                    send_to_printer(f, copies=order.get("copies", 1))
                mark_completed(order["id"])
                print(f"Order #{order['order_number']}: done.")
            else:
                time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as e:
            print(f"Agent error (will retry): {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
