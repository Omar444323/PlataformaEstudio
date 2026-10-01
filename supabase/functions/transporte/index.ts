// Edge Function: transporte
// Llegadas de la EMT y estado de Cercanías para las paradas y trayectos que cada uno
// tiene en transporte_config. Nada de paradas ni líneas fijas en el código.
//
//   GET                         -> todo lo activo del usuario
//   GET ?accion=parada&id=4710  -> nombre y líneas de una parada EMT (para validar al guardar)
//   GET ?accion=calle&q=texto   -> paradas EMT cerca de una calle (la EMT no busca por nombre de parada)
//
// IMPORTANTE: en esta función la verificación de JWT se queda ACTIVADA (como eventos).
// Además se comprueba que el correo está en usuarios_permitidos.
//
// Secretos: EMT_EMAIL y EMT_PASSWORD (obligatorios). EMT_CLIENT_ID y EMT_PASSKEY si se
// registra una app en MobilityLabs (dan más cuota); si existen se usan en lugar de los otros.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const EMT = "https://openapi.emtmadrid.es";
const RENFE_AVISOS = "https://gtfsrt.renfe.com/alerts.json";
const RENFE_VIAJES = "https://gtfsrt.renfe.com/trip_updates.json";
const TIEMPO_MAX = 5_000; // por fuente
const CACHE_MS = 30_000;

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Falta el secreto ${k}`);
  return v;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/* ---------- Utilidades ---------- */

// Abandona una fuente si tarda más de TIEMPO_MAX, sin tumbar el resto.
function conLimite<T>(p: Promise<T>, quien: string): Promise<T> {
  let t: number;
  const limite = new Promise<T>((_, rechazar) => {
    t = setTimeout(() => rechazar(new Error(`${quien} no respondió en 5 s`)), TIEMPO_MAX);
  });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}

// Caché en memoria con caducidad. Vive mientras la instancia de la función esté caliente.
const cache = new Map<string, { hasta: number; valor: any }>();
async function cacheado<T>(clave: string, ms: number, f: () => Promise<T>): Promise<T> {
  const c = cache.get(clave);
  if (c && c.hasta > Date.now()) return c.valor;
  const valor = await f();
  cache.set(clave, { hasta: Date.now() + ms, valor });
  return valor;
}

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[-_.,]/g, " ").replace(/\s+/g, " ").trim();
const normLinea = (s: string | null) => (s || "").replace(/[\s-]/g, "").toUpperCase();

/* ---------- Hora de Madrid ---------- */

function partesMadrid(fecha: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value])
  );
  const m = /GMT([+-]\d+)?(?::(\d+))?/.exec(p.timeZoneName || "");
  const offsetMin = m && m[1] ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0) : 0;
  return { dia: `${p.year}-${p.month}-${p.day}`, offsetMin };
}

// En GTFS las horas cuentan desde "mediodía menos 12 h" del día de servicio (en la práctica,
// la medianoche local) y pueden pasar de 24:00.
function epochGTFS(dia: string, hhmmss: string): number {
  const [y, mo, d] = dia.split("-").map(Number);
  const [h, mi, s] = hhmmss.split(":").map(Number);
  const mediodiaUTC = Date.UTC(y, mo - 1, d, 12);
  const { offsetMin } = partesMadrid(new Date(mediodiaUTC));
  return mediodiaUTC - offsetMin * 60_000 - 12 * 3600_000 + ((h * 60 + mi) * 60 + (s || 0)) * 1000;
}

function diaAnterior(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const horaCorta = (ms: number) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(ms);

/* ---------- EMT ---------- */

// El token se guarda en memoria y se reutiliza hasta que caduca o la EMT lo rechaza.
let tokenEMT: { valor: string; hasta: number } | null = null;
let pidiendoToken: Promise<string> | null = null;

async function loginEMT(): Promise<string> {
  const cabeceras: Record<string, string> = {};
  const clientId = Deno.env.get("EMT_CLIENT_ID");
  const passKey = Deno.env.get("EMT_PASSKEY");
  if (clientId && passKey) {
    cabeceras["X-ClientId"] = clientId;
    cabeceras["passKey"] = passKey;
  } else {
    cabeceras["email"] = env("EMT_EMAIL");
    cabeceras["password"] = env("EMT_PASSWORD");
  }
  const res = await fetch(`${EMT}/v3/mobilitylabs/user/login/`, { headers: cabeceras });
  const j = await res.json().catch(() => ({}));
  const d = j?.data?.[0];
  if (!res.ok || !d?.accessToken) {
    throw new Error(`Login EMT: ${j?.description || res.status}`);
  }
  // tokenSecExpiration son segundos hasta que caduca. Margen de 60 s.
  const segundos = Number(d.tokenSecExpiration) || 3600;
  tokenEMT = { valor: d.accessToken, hasta: Date.now() + (segundos - 60) * 1000 };
  return d.accessToken;
}

async function obtenerToken(forzar = false): Promise<string> {
  if (!forzar && tokenEMT && tokenEMT.hasta > Date.now()) return tokenEMT.valor;
  // Si llegan varias peticiones a la vez, que solo una haga login.
  if (!pidiendoToken) pidiendoToken = loginEMT().finally(() => (pidiendoToken = null));
  return pidiendoToken;
}

// La EMT a veces responde 200 con code 80/81/98 cuando el token no vale.
const tokenRechazado = (res: Response, j: any) =>
  res.status === 401 || res.status === 403 || ["80", "81", "98"].includes(String(j?.code));

async function llamarEMT(ruta: string, init: RequestInit = {}): Promise<any> {
  for (let intento = 0; intento < 2; intento++) {
    const token = await obtenerToken(intento > 0);
    const res = await fetch(`${EMT}${ruta}`, {
      ...init,
      headers: { ...(init.headers || {}), accessToken: token, "Content-Type": "application/json" },
    });
    const j = await res.json().catch(() => ({}));
    if (tokenRechazado(res, j)) {
      tokenEMT = null;
      continue;
    }
    if (!res.ok) throw new Error(`EMT ${res.status}: ${j?.description || ""}`.trim());
    return j;
  }
  throw new Error("La EMT rechaza las credenciales");
}

function hoyAAAAMMDD() {
  return partesMadrid(new Date()).dia.replaceAll("-", "");
}

async function llegadasEMT(parada: string, linea: string | null) {
  const ruta = `/v2/transport/busemtmad/stops/${encodeURIComponent(parada)}/arrives/${
    linea ? `${encodeURIComponent(linea)}/` : ""
  }`;
  const j = await cacheado(`emt:${parada}:${linea || ""}`, CACHE_MS, () =>
    llamarEMT(ruta, {
      method: "POST",
      body: JSON.stringify({
        cultureInfo: "ES",
        Text_StopRequired_YN: "Y",
        Text_EstimationsRequired_YN: "Y",
        Text_IncidencesRequired_YN: "N",
        DateTime_Referenced_Incidencies_YYYYMMDD: hoyAAAAMMDD(),
      }),
    })
  );
  const datos = j?.data?.[0] || {};
  const nombre = datos?.StopInfo?.[0]?.stopName || datos?.StopInfo?.[0]?.Description || null;
  const llegadas = (datos.Arrive || [])
    .filter((a: any) => !linea || normLinea(String(a.line)) === normLinea(linea))
    .map((a: any) => {
      const seg = Number(a.estimateArrive);
      return {
        linea: String(a.line),
        destino: a.destination || "",
        segundos: seg,
        // La EMT usa 999999 para "más de 20 minutos"
        minutos: seg >= 999999 ? null : Math.floor(seg / 60),
        masDe20: seg >= 999999,
        metros: Number(a.DistanceBus) || null,
      };
    })
    .sort((x: any, y: any) => x.segundos - y.segundos);
  return { nombre, llegadas };
}

/* ---------- Renfe ---------- */

async function feedRenfe(url: string) {
  return cacheado(`renfe:${url}`, CACHE_MS, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MAX) });
    if (!res.ok) throw new Error(`Renfe ${res.status}`);
    return res.json();
  });
}

function avisoActivo(a: any, ahoraSeg: number) {
  const periodos = a.activePeriod || [];
  if (!periodos.length) return true;
  return periodos.some(
    (p: any) => (!p.start || Number(p.start) <= ahoraSeg) && (!p.end || Number(p.end) >= ahoraSeg)
  );
}

// route_id de Renfe: 10T0035C5 -> núcleo "10", línea "C5"
const lineaDeRuta = (r: string) => normLinea(r.slice(7));
const nucleoDeRuta = (r: string) => r.slice(0, 2);

function incidenciasDe(feed: any, linea: string, nucleo: string | null, estaciones: string[]) {
  const ahoraSeg = Date.now() / 1000;
  const L = normLinea(linea);
  const salida: any[] = [];
  for (const e of feed?.entity || []) {
    const a = e.alert;
    if (!a || !avisoActivo(a, ahoraSeg)) continue;
    const afecta = (a.informedEntity || []).some((ie: any) => {
      if (ie.stopId && estaciones.includes(String(ie.stopId))) return true;
      if (!ie.routeId) return false;
      const r = String(ie.routeId).trim();
      const mismaLinea = L && (lineaDeRuta(r) === L || lineaDeRuta(r).replace(/[A-Z]$/, "") === L);
      return mismaLinea && (!nucleo || nucleoDeRuta(r) === nucleo);
    });
    if (!afecta) continue;
    const tr = a.descriptionText?.translation || a.headerText?.translation || [];
    const texto = (tr.find((t: any) => t.language === "es") || tr[0])?.text || "";
    salida.push({
      id: e.id,
      texto: texto.trim(),
      desde: a.activePeriod?.[0]?.start ? new Date(Number(a.activePeriod[0].start) * 1000).toISOString() : null,
      hasta: a.activePeriod?.[0]?.end ? new Date(Number(a.activePeriod[0].end) * 1000).toISOString() : null,
    });
  }
  return salida;
}

function retrasosDe(feed: any) {
  const m = new Map<string, { retraso: number; cancelado: boolean }>();
  for (const e of feed?.entity || []) {
    const tu = e.tripUpdate;
    if (!tu?.trip?.tripId) continue;
    const stu = tu.stopTimeUpdate?.[0];
    const retraso = Number(tu.delay ?? stu?.arrival?.delay ?? stu?.departure?.delay ?? 0) || 0;
    m.set(String(tu.trip.tripId), { retraso, cancelado: tu.trip.scheduleRelationship === "CANCELED" });
  }
  return m;
}

/* ---------- Petición ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Sesión: el JWT ya lo valida Supabase; aquí solo la lista blanca.
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

    const url = new URL(req.url);
    const accion = url.searchParams.get("accion");

    // Ayudas para la pantalla de configuración
    if (accion === "parada") {
      const id = (url.searchParams.get("id") || "").replace(/\D/g, "");
      if (!id) return Response.json({ ok: false, error: "Número de parada vacío" }, { headers: cors });
      const j = await conLimite(llamarEMT(`/v1/transport/busemtmad/stops/${id}/detail/`), "EMT");
      const p = j?.data?.[0]?.stops?.[0];
      if (!p) return Response.json({ ok: false, error: "La EMT no conoce esa parada" }, { headers: cors });
      return Response.json(
        {
          ok: true,
          parada: {
            id: String(p.stop),
            nombre: p.name,
            lineas: (p.dataLine || []).map((l: any) => ({ linea: String(l.label), hacia: l.headerB || l.headerA || "" })),
          },
        },
        { headers: cors }
      );
    }

    if (accion === "calle") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 3) return Response.json({ ok: true, paradas: [] }, { headers: cors });
      const numero = /\s(\d+)$/.exec(q)?.[1] || "0";
      const calle = q.replace(/\s\d+$/, "");
      const j = await conLimite(
        llamarEMT(`/v1/transport/busemtmad/stops/arroundstreet/${encodeURIComponent(calle)}/${numero}/300/`),
        "EMT"
      );
      const paradas = (j?.data || []).slice(0, 15).map((p: any) => ({
        id: String(p.stopId),
        nombre: p.stopName,
        metros: p.metersToPoint,
        lineas: (p.lines || []).map((l: any) => String(l.label)),
      }));
      return Response.json({ ok: true, paradas }, { headers: cors });
    }

    // Vista principal, cacheada 30 s por usuario
    const respuesta = await cacheado(`todo:${correo}`, CACHE_MS, async () => {
      const { data: filas, error } = await admin
        .from("transporte_config")
        .select("id, tipo, etiqueta, parada, linea, origen, destino, orden")
        .eq("correo", correo)
        .eq("activo", true)
        .order("orden", { ascending: true })
        .order("creado_en", { ascending: true });
      if (error) throw new Error(error.message);

      const emtFilas = (filas || []).filter((f) => f.tipo === "emt");
      const cerFilas = (filas || []).filter((f) => f.tipo === "cercanias");

      // Cada parada tiene su propio límite de 5 s: si una tarda, las demás salen igual.
      const emt = Promise.all(
        emtFilas.map(async (f) => {
          if (!f.parada) return { ...f, llegadas: [], error: "Sin número de parada" };
          try {
            const r = await conLimite(llegadasEMT(String(f.parada), f.linea), "La EMT");
            return { ...f, nombreParada: r.nombre, llegadas: r.llegadas, error: null };
          } catch (e) {
            return { ...f, llegadas: [], error: e instanceof Error ? e.message : String(e) };
          }
        })
      );

      // Los feeds de Renfe llevan su propio límite de 5 s dentro (feedRenfe).
      const cercanias = cercaniasDe(admin, cerFilas);

      const [rEmt, rCer] = await Promise.allSettled([
        emtFilas.length ? emt : Promise.resolve([]),
        cerFilas.length ? cercanias : Promise.resolve({ trayectos: [] }),
      ]);

      return {
        ok: true,
        generado: new Date().toISOString(),
        emt: {
          error: rEmt.status === "rejected" ? String(rEmt.reason?.message || rEmt.reason) : null,
          paradas: rEmt.status === "fulfilled" ? rEmt.value : [],
        },
        cercanias: {
          error: rCer.status === "rejected" ? String(rCer.reason?.message || rCer.reason) : null,
          trayectos: rCer.status === "fulfilled" ? (rCer.value as any).trayectos : [],
          horarioCargado: rCer.status === "fulfilled" ? (rCer.value as any).horarioCargado ?? null : null,
        },
      };
    });

    return Response.json(respuesta, { headers: { ...cors, "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500, headers: cors });
  }
});

/* ---------- Cercanías ---------- */

async function cercaniasDe(admin: any, filas: any[]) {
  // Feeds en paralelo; si el de horarios falla seguimos con las incidencias y al revés.
  const [avisos, viajes] = await Promise.allSettled([
    conLimite(feedRenfe(RENFE_AVISOS), "Renfe (incidencias)"),
    conLimite(feedRenfe(RENFE_VIAJES), "Renfe (tiempo real)"),
  ]);
  const retrasos = viajes.status === "fulfilled" ? retrasosDe(viajes.value) : null;

  const { data: carga } = await admin
    .from("cercanias_cargas")
    .select("cargado_en")
    .eq("ok", true)
    .order("cargado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ahora = Date.now();
  const hoy = partesMadrid(new Date(ahora)).dia;
  const ayer = diaAnterior(hoy);

  const { data: servicios } = await admin
    .from("cercanias_servicios")
    .select("service_id, fecha")
    .in("fecha", [hoy, ayer]);
  const fechasDe = new Map<string, string[]>();
  for (const s of servicios || []) {
    fechasDe.set(s.service_id, [...(fechasDe.get(s.service_id) || []), s.fecha]);
  }

  const trayectos = [];
  for (const f of filas) {
    let aviso: string | null = null;
    // Lo normal es que origen/destino ya sean códigos (se resuelven al guardar). Si una
    // fila antigua trae el nombre, se busca aquí y se avisa para volver a guardarla.
    const resolver = async (v: string | null) => {
      if (!v) return null;
      if (/^\d{4,5}$/.test(v.trim())) {
        const { data } = await admin.from("cercanias_estaciones").select("stop_id, nombre").eq("stop_id", v.trim()).maybeSingle();
        return { codigo: v.trim(), nombre: data?.nombre || v.trim() };
      }
      aviso = "Guarda de nuevo este trayecto para fijar los códigos de estación.";
      const { data } = await admin
        .from("cercanias_estaciones")
        .select("stop_id, nombre")
        .eq("nombre_busqueda", sinTildes(v))
        .limit(1)
        .maybeSingle();
      return data ? { codigo: data.stop_id, nombre: data.nombre } : { codigo: null, nombre: v };
    };
    const origen = await resolver(f.origen);
    const destino = await resolver(f.destino);
    const linea = normLinea(f.linea);

    let trenes: any[] = [];
    let nucleo: string | null = null;
    let estadoHorario = "ok";

    if (!origen?.codigo || !destino?.codigo) {
      estadoHorario = "sin_estaciones";
    } else if (!fechasDe.size) {
      estadoHorario = "sin_cargar";
    } else {
      const { data: pasos } = await admin
        .from("cercanias_pasos")
        .select("trip_id, service_id, route_id, linea, stop_id, llegada, salida, secuencia")
        .in("stop_id", [origen.codigo, destino.codigo])
        .in("service_id", [...fechasDe.keys()]);

      if (!pasos?.length) estadoHorario = carga ? "sin_trenes" : "sin_cargar";

      // Emparejar origen y destino del mismo tren. Que el origen vaya antes que el destino
      // en el recorrido es lo que filtra el sentido de la marcha.
      const porViaje = new Map<string, any>();
      for (const p of pasos || []) {
        if (linea && normLinea(p.linea) !== linea) continue;
        const v = porViaje.get(p.trip_id) || { ...p };
        if (p.stop_id === origen.codigo) v.o = p;
        if (p.stop_id === destino.codigo) v.d = p;
        porViaje.set(p.trip_id, v);
      }
      for (const v of porViaje.values()) {
        if (!v.o || !v.d || v.o.secuencia >= v.d.secuencia) continue;
        nucleo = nucleo || nucleoDeRuta(v.route_id);
        for (const dia of fechasDe.get(v.service_id) || []) {
          const sale = epochGTFS(dia, v.o.salida);
          const llega = epochGTFS(dia, v.d.llegada);
          const rt = retrasos?.get(v.trip_id);
          const retraso = rt?.retraso || 0;
          const saleReal = sale + retraso * 1000;
          if (saleReal < ahora - 60_000 || sale > ahora + 3 * 3600_000) continue;
          trenes.push({
            viaje: v.trip_id,
            linea: v.linea,
            sale: horaCorta(sale),
            llega: horaCorta(llega),
            saleReal: horaCorta(saleReal),
            minutos: Math.max(0, Math.round((saleReal - ahora) / 60_000)),
            retrasoMin: Math.round(retraso / 60),
            cancelado: !!rt?.cancelado,
            enTiempoReal: !!rt,
            _orden: saleReal,
          });
        }
      }
      trenes.sort((a, b) => a._orden - b._orden);
      trenes = trenes.slice(0, 5).map(({ _orden, ...t }) => t);
    }

    if (!nucleo && origen?.codigo) {
      const { data } = await admin.from("cercanias_pasos").select("route_id").eq("stop_id", origen.codigo).limit(1).maybeSingle();
      nucleo = data ? nucleoDeRuta(data.route_id) : null;
    }

    trayectos.push({
      id: f.id,
      etiqueta: f.etiqueta,
      orden: f.orden,
      linea: f.linea,
      origen,
      destino,
      aviso,
      incidencias:
        avisos.status === "fulfilled"
          ? incidenciasDe(avisos.value, linea, nucleo, [origen?.codigo, destino?.codigo].filter(Boolean) as string[])
          : null,
      errorIncidencias: avisos.status === "rejected" ? String(avisos.reason?.message || avisos.reason) : null,
      trenes,
      estadoHorario,
      errorTiempoReal: viajes.status === "rejected" ? String(viajes.reason?.message || viajes.reason) : null,
    });
  }

  return { trayectos, horarioCargado: carga?.cargado_en || null };
}
