import { createClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import zlib from "node:zlib";

// Carga el horario programado de Cercanías (GTFS de Renfe) en Supabase, pero solo los
// pasos por las estaciones que alguien tiene en transporte_config y los próximos días.
// La Edge Function `transporte` lo cruza con el tiempo real para sacar los próximos trenes.
//
//   GET  -> el cron de Vercel (vercel.json), con Authorization: Bearer CRON_SECRET
//   POST -> la app al guardar un trayecto, con la sesión del usuario
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GTFS = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip";
const DIAS = 4; // ayer (trenes de madrugada) + hoy + 2 días

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

const sinTildes = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* ---------- ZIP sin dependencias ---------- */

// Lee el directorio central y devuelve, por nombre, dónde empieza cada fichero comprimido.
function indiceZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El GTFS no parece un ZIP");
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const ficheros = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP dañado");
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + largoNombre).split("/").pop();
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    ficheros[nombre] = { metodo, datos: buf.subarray(inicio, inicio + comprimido) };
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return ficheros;
}

// Recorre un fichero del ZIP línea a línea sin descomprimirlo entero en memoria
// (stop_times.txt son más de 200 MB).
async function* lineas(entrada) {
  if (!entrada) return;
  const origen = Readable.from([entrada.datos]);
  const flujo = entrada.metodo === 8 ? origen.pipe(zlib.createInflateRaw()) : origen;
  const decodificador = new StringDecoder("utf8"); // no parte las letras con tilde entre trozos
  let resto = "";
  for await (const trozo of flujo) {
    const texto = resto + decodificador.write(trozo);
    const partes = texto.split("\n");
    resto = partes.pop();
    for (const l of partes) yield l.replace(/\r$/, "");
  }
  if (resto) yield resto.replace(/\r$/, "");
}

function partirCSV(l) {
  if (!l.includes('"')) return l.split(",").map((c) => c.trim());
  const out = [];
  let actual = "";
  let dentro = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '"') {
      if (dentro && l[i + 1] === '"') {
        actual += '"';
        i++;
      } else dentro = !dentro;
    } else if (c === "," && !dentro) {
      out.push(actual.trim());
      actual = "";
    } else actual += c;
  }
  out.push(actual.trim());
  return out;
}

async function leerCSV(entrada, alFila) {
  let cab = null;
  for await (const l of lineas(entrada)) {
    if (!l.trim()) continue;
    const c = partirCSV(l.charCodeAt(0) === 0xfeff ? l.slice(1) : l);
    if (!cab) {
      cab = Object.fromEntries(c.map((n, i) => [n, i]));
      continue;
    }
    alFila(c, cab);
  }
}

/* ---------- Fechas (Madrid) ---------- */

function diaMadrid(fecha) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(fecha); // AAAA-MM-DD
}

function sumarDias(dia, n) {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ---------- Carga ---------- */

async function cargar() {
  const db = admin();

  const { data: config, error } = await db
    .from("transporte_config")
    .select("origen, destino")
    .eq("tipo", "cercanias")
    .eq("activo", true);
  if (error) throw new Error(error.message);

  const res = await fetch(GTFS);
  if (!res.ok) throw new Error(`Renfe GTFS ${res.status}`);
  const zip = indiceZip(Buffer.from(await res.arrayBuffer()));

  // Estaciones (todas: sirven para buscar por nombre al configurar)
  const estaciones = [];
  await leerCSV(zip["stops.txt"], (c, h) => {
    const nombre = c[h.stop_name];
    estaciones.push({
      stop_id: c[h.stop_id],
      nombre,
      nombre_busqueda: sinTildes(nombre),
      lat: Number(c[h.stop_lat]) || null,
      lon: Number(c[h.stop_lon]) || null,
    });
  });

  // Códigos que hay que cargar. Las filas guardan el código; si alguna antigua guarda
  // el nombre, se resuelve aquí por nombre exacto.
  const porNombre = new Map(estaciones.map((e) => [e.nombre_busqueda, e.stop_id]));
  const codigos = new Set();
  for (const f of config || []) {
    for (const v of [f.origen, f.destino]) {
      if (!v) continue;
      const t = String(v).trim();
      const codigo = /^\d{4,5}$/.test(t) ? t : porNombre.get(sinTildes(t));
      if (codigo) codigos.add(codigo);
    }
  }

  // Servicios que circulan en la ventana de días
  const hoy = diaMadrid(new Date());
  const ventana = Array.from({ length: DIAS }, (_, i) => sumarDias(hoy, i - 1));
  const servicios = [];
  const serviciosVentana = new Set();
  const nombresDia = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  await leerCSV(zip["calendar.txt"], (c, h) => {
    const desde = c[h.start_date];
    const hasta = c[h.end_date];
    for (const dia of ventana) {
      const compacto = dia.replaceAll("-", "");
      if (compacto < desde || compacto > hasta) continue;
      const [y, m, d] = dia.split("-").map(Number);
      const semana = nombresDia[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
      if (c[h[semana]] !== "1") continue;
      servicios.push({ service_id: c[h.service_id], fecha: dia });
      serviciosVentana.add(c[h.service_id]);
    }
  });

  // Línea de cada ruta y ruta/servicio de cada viaje (solo los que circulan en la ventana)
  const lineaDeRuta = new Map();
  await leerCSV(zip["routes.txt"], (c, h) => lineaDeRuta.set(c[h.route_id], c[h.route_short_name]));
  const viajes = new Map();
  await leerCSV(zip["trips.txt"], (c, h) => {
    if (serviciosVentana.has(c[h.service_id]))
      viajes.set(c[h.trip_id], { route_id: c[h.route_id], service_id: c[h.service_id] });
  });

  // Pasos por las estaciones configuradas
  const pasos = [];
  if (codigos.size) {
    await leerCSV(zip["stop_times.txt"], (c, h) => {
      const stop = c[h.stop_id];
      if (!codigos.has(stop)) return;
      const v = viajes.get(c[h.trip_id]);
      if (!v) return;
      pasos.push({
        trip_id: c[h.trip_id],
        service_id: v.service_id,
        route_id: v.route_id,
        linea: lineaDeRuta.get(v.route_id) || v.route_id.slice(7),
        stop_id: stop,
        llegada: c[h.arrival_time],
        salida: c[h.departure_time],
        secuencia: Number(c[h.stop_sequence]),
      });
    });
  }

  const { error: e2 } = await db.rpc("cercanias_reemplazar", {
    p_estaciones: estaciones,
    p_servicios: servicios,
    p_pasos: pasos,
    p_codigos: [...codigos],
  });
  if (e2) throw new Error(e2.message);

  return { estaciones: estaciones.length, servicios: servicios.length, pasos: pasos.length, codigos: [...codigos] };
}

async function responder() {
  try {
    const r = await cargar();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await admin().from("cercanias_cargas").insert({ ok: false, error }).then(() => {}, () => {});
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

// Cron de Vercel
export async function GET(request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || request.headers.get("authorization") !== `Bearer ${secreto}`)
    return Response.json({ error: "No autorizado" }, { status: 401 });
  return responder();
}

// Desde la app, al guardar un trayecto
export async function POST(request) {
  const cabecera = request.headers.get("authorization") || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) return Response.json({ error: "Falta la sesión" }, { status: 401 });

  const { data: usuario, error } = await admin().auth.getUser(token);
  if (error || !usuario?.user) return Response.json({ error: "Sesión no válida" }, { status: 401 });

  const permitidos = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!permitidos.includes((usuario.user.email || "").toLowerCase()))
    return Response.json({ error: "Sin acceso" }, { status: 403 });

  return responder();
}
