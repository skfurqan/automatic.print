# Print Kiosk System

QR-based self-service print kiosk. Customer scans a QR code at a shop,
uploads a file, pays the shop's own UPI ID directly, shop owner
confirms with a one-tap PIN dashboard, and a local agent on the shop's
PC sends the job straight to the connected printer.

## Real setup steps (do these once)

### 1. Database
In Supabase Dashboard → SQL Editor, run `supabase/schema.sql` in full.

Then run this separately, with your real service_role key pasted in
(Dashboard → Project Settings → API → service_role):

```sql
select vault.create_secret('YOUR_SERVICE_ROLE_KEY_HERE', 'service_role_key');
```

### 2. Storage bucket
Confirm a **private** bucket named `print-uploads` exists (the schema
creates it, but double check in Dashboard → Storage).

### 3. Edge Function
```
supabase functions deploy cleanup-storage
```

### 4. Frontend
```
cd frontend
npm install
npm run dev        # local test
npm run build       # production build (already verified working)
```
Deploy `frontend` to Vercel, connected to this GitHub repo, auto-deploys on push.
Real env vars needed in Vercel project settings (copy from `frontend/.env.local`,
never commit that file):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

### 5. Local print agent (on the shop's PC)
```
cd local-agent
pip install -r requirements.txt
cp .env.example .env    # then paste the real service_role key into .env
python agent.py
```

### 6. QR code
Point it at: `https://<your-vercel-domain>/p/test-kiosk`
(or whatever slug you give the shop in the `shops` table)

Shop dashboard (for the owner, PIN-gated): `https://<your-vercel-domain>/p/test-kiosk/dashboard`

## How payment confirmation works (Option A)

No payment gateway — customer pays the shop's real UPI ID directly via
a UPI deep link. Customer taps "I've Paid," shop owner glances at their
own phone, taps Confirm + enters their PIN on the dashboard. That PIN
check happens server-side in `shop_confirms_payment()` — a customer
cannot confirm their own order.

## Auto-cleanup

Every 15 minutes, a Postgres cron job calls the `cleanup-storage` edge
function, which deletes files for orders that are `expired` (abandoned
uploads, >30 min unpaid) or `completed` (>1hr old). Keeps you well
under the 1GB free-tier storage limit with zero manual work.
