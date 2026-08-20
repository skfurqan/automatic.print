// cleanup-storage
// Called every 15 min by pg_cron (see schema.sql).
// Finds orders that are 'expired' or 'completed' (>1hr old) with
// file_deleted = false, deletes their files from the print-uploads
// bucket via the real Storage API, and marks them file_deleted = true.
//
// Deploy with: supabase functions deploy cleanup-storage

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by
  // Supabase into every Edge Function's environment — never hardcoded,
  // never committed to git.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, file_paths, status, completed_at")
    .eq("file_deleted", false)
    .or("status.eq.expired,status.eq.completed");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const toClean = (orders ?? []).filter((o) => {
    if (o.status === "expired") return true;
    if (o.status === "completed" && o.completed_at) {
      return new Date(o.completed_at).getTime() < Date.now() - 60 * 60 * 1000; // >1hr old
    }
    return false;
  });

  let deletedFiles = 0;
  const clearedOrderIds: string[] = [];

  for (const order of toClean) {
    if (order.file_paths?.length) {
      const { error: removeErr } = await supabase.storage
        .from("print-uploads")
        .remove(order.file_paths);
      if (!removeErr) deletedFiles += order.file_paths.length;
    }
    clearedOrderIds.push(order.id);
  }

  if (clearedOrderIds.length > 0) {
    await supabase
      .from("orders")
      .update({ file_deleted: true })
      .in("id", clearedOrderIds);
  }

  return new Response(
    JSON.stringify({ ordersCleared: clearedOrderIds.length, filesDeleted: deletedFiles }),
    { headers: { "Content-Type": "application/json" } }
  );
});
