// Edge Function: eventos
// Devuelve los eventos como JSON, para pintarlos en la app sin iframes de Google.
//   ?fuente=entregas  -> lee el .ics de Blackboard (no necesita token de Google)
//   ?fuente=personal  -> lee tu calendario principal con el refresh token
//   ?dias=60          -> ventana hacia delante (por defecto 60)
//
// IMPORTANTE: en esta función la verificación de JWT se queda ACTIVADA.
// Solo responde a usuarios con sesión y con el correo en usuarios_permitidos.
// deno-lint-ignore-file no-explicit-any
import ICAL from "npm:ical.js@1.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Falta el secreto ${k}`);
  return v;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function tokenGoogle(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token de Google: ${res.status}`);
  return (await res.json()).access_token;
}

function desdeICS(texto: string, desde: number, hasta: number) {
  const comp = new ICAL.Component(ICAL.parse(texto));
  for (const tz of comp.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  return comp
    .getAllSubcomponents("vevent")
    .map((v: any) => new ICAL.Event(v))
    .map((ev: any) => {
      const inicio = ev.startDate?.toJSDate?.();
      if (!inicio) return null;
      return {
        id: ev.uid,
        titulo: ev.summary || "(sin titulo)",
        inicio: inicio.toISOString(),
        diaCompleto: !!ev.startDate.isDate,
        descripcion: (ev.description || "").replace(/<[^>]*>/g, " ").slice(0, 300).trim(),
      };
    })
    .filter((e: any) => e && +new Date(e.inicio) >= desde && +new Date(e.inicio) <= hasta);
}

async function desdeGoogle(desde: number, hasta: number) {
  const token = await tokenGoogle();
  const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  u.searchParams.set("timeMin", new Date(desde).toISOString());
  u.searchParams.set("timeMax", new Date(hasta).toISOString());
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", "250");

  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  const datos = await res.json();

  return (datos.items ?? [])
    .filter((e: any) => e.status !== "cancelled")
    .map((e: any) => ({
      id: e.id,
      titulo: e.summary || "(sin titulo)",
      inicio: e.start?.dateTime || `${e.start?.date}T00:00:00.000Z`,
      diaCompleto: !!e.start?.date,
      descripcion: (e.description || "").replace(/<[^>]*>/g, " ").slice(0, 300).trim(),
      ubicacion: e.location || "",
    }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Sesion: el token lo valida Supabase, aqui solo comprobamos la lista blanca
    const cabecera = req.headers.get("authorization") || "";
    const jwt = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
    if (!jwt) return Response.json({ error: "Falta la sesion" }, { status: 401, headers: cors });

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: usuario } = await admin.auth.getUser(jwt);
    const correo = usuario?.user?.email?.toLowerCase();
    if (!correo) return Response.json({ error: "Sesion no valida" }, { status: 401, headers: cors });

    const { data: permitido } = await admin
      .from("usuarios_permitidos")
      .select("email")
      .eq("email", correo)
      .maybeSingle();
    if (!permitido) return Response.json({ error: "Sin acceso" }, { status: 403, headers: cors });

    // Ventana
    const url = new URL(req.url);
    const dias = Math.min(365, Math.max(1, Number(url.searchParams.get("dias")) || 60));
    const fuente = url.searchParams.get("fuente") === "personal" ? "personal" : "entregas";
    const desde = Date.now() - 12 * 3600 * 1000; // deja ver lo de hoy aunque ya haya pasado
    const hasta = Date.now() + dias * 86400 * 1000;

    let eventos: any[];
    if (fuente === "personal") {
      eventos = await desdeGoogle(desde, hasta);
    } else {
      const res = await fetch(env("ICS_URL"));
      if (!res.ok) throw new Error(`Blackboard respondio ${res.status}`);
      eventos = desdeICS(await res.text(), desde, hasta);
    }

    eventos.sort((a, b) => +new Date(a.inicio) - +new Date(b.inicio));

    return Response.json(
      { ok: true, fuente, dias, total: eventos.length, eventos },
      { headers: { ...cors, "Cache-Control": "private, max-age=120" } }
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500, headers: cors });
  }
});
