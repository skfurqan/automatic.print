import { createClient } from "@supabase/supabase-js";

// Real values, loaded from .env.local (gitignored). Publishable key
// only — this file ships to the browser, so it must never contain
// the service_role secret.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
