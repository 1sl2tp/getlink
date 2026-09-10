import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

Deno.serve((_req: Request) => json({ error:"chat_auth_detached" },410));
