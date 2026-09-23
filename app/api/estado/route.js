import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const cabecera = request.headers.get("authorization") || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return Response.json({ error: "Falta la sesión" }, { status: 401 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: usuario, error } = await admin.auth.getUser(token);
  if (error || !usuario?.user) return Response.json({ error: "Sesión no válida" }, { status: 401 });

  const permitidos = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const correo = (usuario.user.email || "").toLowerCase();
  if (!permitidos.includes(correo)) return Response.json({ error: "Sin acceso" }, { status: 403 });

  const { data: filas, error: errorFilas } = await admin
    .from("sync_log")
    .select("id, ran_at, ok, feed_count, created, updated, deleted, error")
    .order("ran_at", { ascending: false })
    .limit(10);

  if (errorFilas) return Response.json({ error: errorFilas.message }, { status: 500 });
  return Response.json({ filas });
}
