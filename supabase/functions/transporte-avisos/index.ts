// Edge Function: transporte-avisos
// La llama Supabase Cron cada minuto mientras haya avisos pendientes (supabase/transporte-avisos.sql).
// Para cada aviso vuelve a mirar el tiempo real (EMT o Renfe) y, cuando faltan `minutos` o
// menos, manda una notificación push a los dispositivos de ese correo.
//
// IMPORTANTE: verificación de JWT DESACTIVADA, como en avisos; se protege con x-cron-secret.
//
// Solo escribe en transporte_avisos (marca enviados y borra caducados) y en push_subs (borra
// suscripciones caducadas).
//
// Secretos: CRON_SECRET, VAPID_*, y los de la EMT igual que la función transporte
// (EMT_CLIENT_ID y EMT_PASSKEY, y/o EMT_EMAIL y EMT_PASSWORD).
// deno-lint-ignore-file no-explicit-any
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const EMT = "https://openapi.emtmadrid.es";
const RENFE_VIAJES = "https://gtfsrt.renfe.com/trip_updates.json";
const CADUCA_MS = 3 * 60_000; // un aviso que ya pasó hace más de esto se borra sin avisar

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Falta el secreto ${k}`);
  return v;
}

const normLinea = (s: string | null) => (s || "").replace(/[\s-]/g, "").toUpperCase();
const horaCorta = (ms: number) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(ms);

/* ---------- EMT (mismo login que la función transporte) ---------- */

async function loginEMT(): Promise<string> {
  const clientId = Deno.env.get("EMT_CLIENT_ID");
  const passKey = Deno.env.get("EMT_PASSKEY");
  const email = Deno.env.get("EMT_EMAIL");
  const password = Deno.env.get("EMT_PASSWORD");
  const intentos: [string, Record<string, string>][] = [];
  if (clientId && passKey) intentos.push(["app", { "X-ClientId": clientId, passKey }]);
  if (email && password) intentos.push(["cuenta", { email, password }]);
  const fallos: string[] = [];
  for (const [quien, cabeceras] of intentos) {
    const res = await fetch(`${EMT}/v3/mobilitylabs/user/login/`, { headers: cabeceras });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.data?.[0]?.accessToken) return j.data[0].accessToken;
    fallos.push(`${quien} ${j?.description || res.status}`);
  }
  throw new Error(`Login EMT: ${fallos.join(", ") || "faltan los secretos"}`);
}

// Llegadas a una parada (y línea), con el número de autobús para seguir al mismo.
async function llegadasEMT(token: string, parada: string, linea: string | null) {
  const res = await fetch(
    `${EMT}/v2/transport/busemtmad/stops/${encodeURIComponent(parada)}/arrives/${linea ? `${encodeURIComponent(linea)}/` : ""}`,
    {
      method: "POST",
      headers: { accessToken: token, "Content-Type": "application/json" },
      body: JSON.stringify({ cultureInfo: "ES", Text_StopRequired_YN: "N", Text_EstimationsRequired_YN: "Y", Text_IncidencesRequired_YN: "N" }),
    }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`EMT ${res.status}`);
  return (j?.data?.[0]?.Arrive || []).map((a: any) => ({
    linea: String(a.line),
    bus: a.bus != null ? String(a.bus) : null,
    segundos: Number(a.estimateArrive),
  }));
}

/* ---------- Petición ---------- */

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("No autorizado", { status: 401 });
  }

  const supa = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  try {
    const ahora = Date.now();

    // Limpieza: enviados hace más de un día
    await supa.from("transporte_avisos").delete().lt("enviado_en", new Date(ahora - 86_400_000).toISOString());

    const { data: avisos, error } = await supa
      .from("transporte_avisos")
      .select("id, correo, tipo, etiqueta, parada, linea, viaje, sale, minutos")
      .is("enviado_en", null);
    if (error) throw new Error(error.message);
    if (!avisos?.length) return Response.json({ ok: true, pendientes: 0 });

    // Fuentes de tiempo real, solo las que hacen falta
    const hayEMT = avisos.some((a) => a.tipo === "emt");
    const hayTren = avisos.some((a) => a.tipo === "cercanias");
    let token: string | null = null;
    let errorEMT: string | null = null;
    if (hayEMT) {
      try {
        token = await loginEMT();
      } catch (e) {
        errorEMT = e instanceof Error ? e.message : String(e);
      }
    }
    const retrasos = new Map<string, number>();
    if (hayTren) {
      try {
        const r = await fetch(RENFE_VIAJES, { signal: AbortSignal.timeout(8_000) });
        const feed = await r.json();
        for (const e of feed?.entity || []) {
          const tu = e.tripUpdate;
          if (!tu?.trip?.tripId) continue;
          const stu = tu.stopTimeUpdate?.[0];
          retrasos.set(String(tu.trip.tripId), Number(tu.delay ?? stu?.arrival?.delay ?? stu?.departure?.delay ?? 0) || 0);
        }
      } catch {
        // Sin tiempo real: se usa la hora programada
      }
    }

    const llegadasPorParada = new Map<string, any[]>();
    const listos: { aviso: any; llega: number }[] = [];
    const caducados: string[] = [];

    for (const a of avisos) {
      let llega: number | null = null;
      if (a.tipo === "cercanias") {
        llega = Date.parse(a.sale) + (retrasos.get(a.viaje) || 0) * 1000;
      } else if (token) {
        const clave = `${a.parada}:${a.linea || ""}`;
        if (!llegadasPorParada.has(clave)) {
          try {
            llegadasPorParada.set(clave, await llegadasEMT(token, a.parada, a.linea));
          } catch {
            llegadasPorParada.set(clave, []);
          }
        }
        const lista = (llegadasPorParada.get(clave) || []).filter(
          (l) => !a.linea || normLinea(l.linea) === normLinea(a.linea)
        );
        // El mismo autobús si la EMT lo identifica; si no, el primero que llega
        const este = a.viaje ? lista.find((l) => l.bus === a.viaje) : lista.sort((x, y) => x.segundos - y.segundos)[0];
        if (este && este.segundos < 999999) llega = ahora + este.segundos * 1000;
        else if (Date.parse(a.sale) < ahora - CADUCA_MS) llega = Date.parse(a.sale); // ya pasó
      }
      if (llega === null) {
        // EMT sin datos: se vuelve a mirar en el siguiente minuto, salvo que ya sea muy tarde
        if (Date.parse(a.sale) < ahora - 30 * 60_000) caducados.push(a.id);
        continue;
      }
      if (llega < ahora - CADUCA_MS) caducados.push(a.id);
      else if (llega - ahora <= a.minutos * 60_000) listos.push({ aviso: a, llega });
    }

    if (caducados.length) await supa.from("transporte_avisos").delete().in("id", caducados);
    if (!listos.length) return Response.json({ ok: true, pendientes: avisos.length, enviados: 0, caducados: caducados.length, errorEMT });

    webpush.setVapidDetails(`mailto:${env("VAPID_CONTACTO")}`, env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

    let enviados = 0;
    const fallos: string[] = [];
    for (const { aviso, llega } of listos) {
      const { data: subs } = await supa.from("push_subs").select("endpoint, p256dh, auth").eq("correo", aviso.correo);
      const min = Math.max(0, Math.round((llega - ahora) / 60_000));
      const titulo = `${aviso.etiqueta}: ${min === 0 ? "llegando" : `en ${min} min`}`;
      const cuerpo =
        aviso.tipo === "cercanias"
          ? `Sale a las ${horaCorta(llega)}${llega - Date.parse(aviso.sale) >= 60_000 ? ` (+${Math.round((llega - Date.parse(aviso.sale)) / 60_000)} min)` : ""}.`
          : `Llega a la parada ${aviso.parada} hacia las ${horaCorta(llega)}.`;
      let alguno = false;
      for (const s of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ titulo, cuerpo, tag: `transporte-${aviso.id}`, url: "/#transporte" })
          );
          alguno = true;
          enviados++;
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await supa.from("push_subs").delete().eq("endpoint", s.endpoint);
            fallos.push("suscripción caducada, borrada");
          } else {
            fallos.push(e?.message || String(e));
          }
        }
      }
      // Sin dispositivos suscritos no se reintenta cada minuto: se da por avisado
      if (alguno || !subs?.length) {
        await supa.from("transporte_avisos").update({ enviado_en: new Date().toISOString() }).eq("id", aviso.id);
        if (!subs?.length) fallos.push(`${aviso.correo} no tiene dispositivos con avisos activados`);
      }
    }

    return Response.json({ ok: true, pendientes: avisos.length, enviados, caducados: caducados.length, errorEMT, ...(fallos.length ? { fallos } : {}) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
});
