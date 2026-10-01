"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const URL_FUNCION = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/transporte`;
const CADA = 60_000;

const sinTildes = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function token() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Sin sesión");
  return t;
}

async function llamar(params = "") {
  const res = await fetch(`${URL_FUNCION}${params}`, {
    headers: {
      Authorization: `Bearer ${await token()}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || "No se pudo cargar");
  return json;
}

// Recarga el horario de Cercanías para las estaciones configuradas (tarda unos segundos).
async function cargarHorario() {
  const res = await fetch("/api/cercanias-carga", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo cargar el horario");
  return json;
}

const horaDe = (iso) =>
  new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
    new Date(iso)
  );

/* ---------- Datos con refresco cada 60 s, solo con la pantalla visible ---------- */

function useTransporte() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const ultima = useRef(0);

  const recargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await llamar());
      ultima.current = Date.now();
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let reloj = null;
    const parar = () => {
      if (reloj) clearInterval(reloj);
      reloj = null;
    };
    const arrancar = () => {
      parar();
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultima.current >= CADA) recargar();
      reloj = setInterval(recargar, CADA);
    };
    arrancar();
    // En el iPhone, al bloquear o cambiar de app la página pasa a oculta: se para el reloj.
    document.addEventListener("visibilitychange", arrancar);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", arrancar);
    };
  }, [recargar]);

  return { datos, error, cargando, recargar };
}

/* ---------- Piezas de presentación ---------- */

function textoMinutos(l) {
  if (l.masDe20) return "+20 min";
  if (l.minutos === 0) return "llegando";
  return `${l.minutos} min`;
}

function ParadaEMT({ p }) {
  return (
    <section className="bloque tr-tarjeta">
      <div className="bloque-cabecera">
        <h2>{p.etiqueta}</h2>
        <span className="aviso">
          Parada {p.parada}
          {p.nombreParada ? ` · ${p.nombreParada}` : ""}
        </span>
      </div>
      {p.error && <p className="fallo">{p.error}</p>}
      {!p.error && p.llegadas.length === 0 && <p className="aviso">Sin llegadas previstas ahora mismo.</p>}
      {p.llegadas.length > 0 && (
        <ul className="tr-lista">
          {p.llegadas.slice(0, 6).map((l, i) => (
            <li key={i} className="tr-fila">
              <span className="tr-linea">{l.linea}</span>
              <span className="tr-destino">{l.destino}</span>
              <strong className="tr-min">{textoMinutos(l)}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tren({ t }) {
  return (
    <li className={`tr-fila${t.cancelado ? " tr-cancelado" : ""}`}>
      <span className="tr-linea">{t.linea}</span>
      <span className="tr-destino">
        {t.sale}
        {t.retrasoMin > 0 && !t.cancelado && <span className="tr-retraso"> +{t.retrasoMin} min</span>}
        <span className="aviso"> · llega {t.llega}</span>
      </span>
      <strong className="tr-min">{t.cancelado ? "Cancelado" : t.minutos === 0 ? "saliendo" : `${t.minutos} min`}</strong>
    </li>
  );
}

const MENSAJE_HORARIO = {
  sin_cargar: "El horario de Cercanías aún no está cargado. Se carga cada noche o al guardar el trayecto.",
  sin_trenes: "No hay trenes programados entre estas estaciones en las próximas horas.",
  sin_estaciones: "Faltan las estaciones de origen y destino. Edita el trayecto.",
};

function TrayectoCercanias({ t }) {
  return (
    <section className="bloque tr-tarjeta">
      <div className="bloque-cabecera">
        <h2>{t.etiqueta}</h2>
        <span className="aviso">
          {t.origen?.nombre} → {t.destino?.nombre}
        </span>
      </div>
      {t.aviso && <p className="aviso">{t.aviso}</p>}

      {t.errorIncidencias && <p className="fallo">Incidencias: {t.errorIncidencias}</p>}
      {t.incidencias?.length > 0 ? (
        <ul className="tr-incidencias">
          {t.incidencias.map((i) => (
            <li key={i.id}>{i.texto}</li>
          ))}
        </ul>
      ) : (
        t.incidencias && <p className="aviso">Sin incidencias en la {t.linea}.</p>
      )}

      {t.trenes.length > 0 && (
        <ul className="tr-lista">
          {t.trenes.map((x) => (
            <Tren key={`${x.viaje}-${x.sale}`} t={x} />
          ))}
        </ul>
      )}
      {t.trenes.length === 0 && MENSAJE_HORARIO[t.estadoHorario] && (
        <p className="aviso">{MENSAJE_HORARIO[t.estadoHorario]}</p>
      )}
      {t.errorTiempoReal && (
        <p className="aviso">Sin tiempo real de Renfe ({t.errorTiempoReal}); horas programadas.</p>
      )}
    </section>
  );
}

/* ---------- Pestaña ---------- */

export default function Transporte() {
  const [vista, setVista] = useState("ahora");
  return (
    <>
      <div className="selector" role="group" aria-label="Vista de transporte">
        {[
          ["ahora", "Ahora"],
          ["config", "Configurar"],
        ].map(([id, texto]) => (
          <button key={id} aria-pressed={vista === id} onClick={() => setVista(id)}>
            {texto}
          </button>
        ))}
      </div>
      {vista === "ahora" ? <Ahora irAConfig={() => setVista("config")} /> : <Configurar />}
    </>
  );
}

function Ahora({ irAConfig }) {
  const { datos, error, cargando, recargar } = useTransporte();

  const elementos = datos
    ? [
        ...datos.emt.paradas.map((p) => ({ ...p, _tipo: "emt" })),
        ...datos.cercanias.trayectos.map((t) => ({ ...t, _tipo: "cercanias" })),
      ].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    : [];

  return (
    <div className="tr">
      <p className="agenda-cabecera tr-cabecera">
        <span className="aviso">
          {datos ? `Actualizado a las ${horaDe(datos.generado)}` : "Cargando…"}
          {" · se refresca cada minuto con la app abierta"}
        </span>
        <button className="boton secundario" onClick={recargar} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </p>

      {error && <p className="fallo">{error}</p>}
      {datos?.emt.error && <p className="fallo">EMT: {datos.emt.error}</p>}
      {datos?.cercanias.error && <p className="fallo">Renfe: {datos.cercanias.error}</p>}

      {datos && elementos.length === 0 && (
        <section className="panel">
          <p>No tienes paradas ni trayectos activos.</p>
          <button className="boton" onClick={irAConfig}>
            Configurar
          </button>
        </section>
      )}

      <div className="tr-rejilla">
        {elementos.map((e) =>
          e._tipo === "emt" ? <ParadaEMT key={e.id} p={e} /> : <TrayectoCercanias key={e.id} t={e} />
        )}
      </div>
    </div>
  );
}

/* ---------- Bloque compacto para Inicio ---------- */

export function TransporteResumen({ ir }) {
  const { datos, error } = useTransporte();

  let lineaBus = null;
  let lineaTren = null;
  let alerta = null;

  if (datos) {
    const p = datos.emt.paradas[0];
    if (p) {
      const [a, b] = p.llegadas;
      lineaBus = p.error
        ? `${p.etiqueta}: sin datos`
        : a
          ? `${p.etiqueta}: ${textoMinutos(a)}${b ? `, luego ${textoMinutos(b)}` : ""}`
          : `${p.etiqueta}: sin llegadas ahora`;
    }
    const tr = datos.cercanias.trayectos;
    const conIncidencia = tr.find((t) => t.incidencias?.length);
    if (conIncidencia) {
      const texto = conIncidencia.incidencias[0].texto.replace(/^#\S+\s*/, "");
      alerta = `${conIncidencia.linea}: ${texto.length > 110 ? `${texto.slice(0, 110)}…` : texto}`;
    }
    const t = tr[0];
    const prox = t?.trenes?.find((x) => !x.cancelado);
    if (t) {
      lineaTren = prox
        ? `${t.etiqueta}: ${prox.saleReal}${prox.retrasoMin > 0 ? ` (+${prox.retrasoMin} min)` : ""}, en ${prox.minutos} min`
        : null;
    }
    if (tr.length && !alerta && !lineaTren) lineaTren = "Cercanías sin incidencias";
    else if (tr.length && !alerta && lineaTren) lineaTren += " · sin incidencias";
  }

  return (
    <section className="bloque tr-resumen">
      <div className="bloque-cabecera">
        <h2>Transporte</h2>
        <button className="boton-texto" onClick={() => ir("transporte")}>
          Ver
        </button>
      </div>
      {!datos && !error && <p className="aviso">Cargando…</p>}
      {error && <p className="aviso">Sin datos de transporte ({error}).</p>}
      {datos && !lineaBus && !lineaTren && !alerta && (
        <p className="aviso">
          <button className="boton-texto" onClick={() => ir("transporte")}>
            Configura tus paradas
          </button>
        </p>
      )}
      {lineaBus && <p className="tr-resumen-linea">{lineaBus}</p>}
      {alerta && <p className="tr-resumen-linea tr-alerta">{alerta}</p>}
      {lineaTren && <p className="tr-resumen-linea aviso">{lineaTren}</p>}
    </section>
  );
}

/* ---------- Configuración ---------- */

const VACIO = { tipo: "emt", etiqueta: "", parada: "", linea: "", origen: null, destino: null };

function Configurar() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(null); // null | "nueva" | id
  const [estado, setEstado] = useState("");

  const leer = useCallback(async () => {
    const { data, error } = await supabase
      .from("transporte_config")
      .select("*")
      .order("orden", { ascending: true })
      .order("creado_en", { ascending: true });
    if (error) setError(error.message);
    else setFilas(data);
  }, []);

  useEffect(() => {
    leer();
  }, [leer]);

  const actualizar = async (id, cambios) => {
    const { error } = await supabase.from("transporte_config").update(cambios).eq("id", id);
    if (error) setError(error.message);
    await leer();
  };

  // Intercambia el orden con la vecina. Si dos tenían el mismo número, se renumera todo.
  const mover = async (i, paso) => {
    const j = i + paso;
    if (j < 0 || j >= filas.length) return;
    const nuevas = [...filas];
    [nuevas[i], nuevas[j]] = [nuevas[j], nuevas[i]];
    await Promise.all(
      nuevas.map((f, k) =>
        f.orden === k + 1 ? null : supabase.from("transporte_config").update({ orden: k + 1 }).eq("id", f.id)
      )
    );
    await leer();
  };

  const recargarHorario = async () => {
    setEstado("Cargando el horario de Renfe…");
    try {
      const r = await cargarHorario();
      setEstado(`Horario cargado: ${r.pasos} pasos de tren por ${r.codigos.length} estaciones.`);
    } catch (e) {
      setEstado(e.message);
    }
  };

  const guardado = async (tipo) => {
    setEditando(null);
    await leer();
    if (tipo === "cercanias") recargarHorario();
  };

  if (error) return <section className="panel"><p className="fallo">{error}</p></section>;
  if (!filas) return <section className="panel"><p className="aviso">Cargando…</p></section>;

  return (
    <section className="panel tr-config">
      {filas.length === 0 && <p className="aviso">Aún no sigues ninguna parada ni trayecto.</p>}

      <ul className="tr-config-lista">
        {filas.map((f, i) => (
          <li key={f.id} className={f.activo ? "" : "tr-inactiva"}>
            {editando === f.id ? (
              <Formulario inicial={f} orden={f.orden} alGuardar={guardado} alCancelar={() => setEditando(null)} />
            ) : (
              <div className="tr-config-fila">
                <span className="etiqueta">{f.tipo === "emt" ? "Bus" : "Tren"}</span>
                <span className="tr-config-texto">
                  <strong>{f.etiqueta}</strong>
                  <span className="aviso">
                    {f.tipo === "emt"
                      ? ` · parada ${f.parada}${f.linea ? `, línea ${f.linea}` : ", todas las líneas"}`
                      : ` · ${f.linea || "cualquier línea"}, ${f.origen} → ${f.destino}`}
                    {!f.activo && " · desactivada"}
                  </span>
                </span>
                <span className="tr-config-botones">
                  <button className="boton-texto" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">
                    ↑
                  </button>
                  <button
                    className="boton-texto"
                    onClick={() => mover(i, 1)}
                    disabled={i === filas.length - 1}
                    aria-label="Bajar"
                  >
                    ↓
                  </button>
                  <button className="boton-texto" onClick={() => actualizar(f.id, { activo: !f.activo })}>
                    {f.activo ? "Desactivar" : "Activar"}
                  </button>
                  <button className="boton-texto" onClick={() => setEditando(f.id)}>
                    Editar
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editando === "nueva" ? (
        <Formulario
          inicial={VACIO}
          orden={Math.max(0, ...filas.map((f) => f.orden)) + 1}
          alGuardar={guardado}
          alCancelar={() => setEditando(null)}
        />
      ) : (
        <p className="fila-formulario">
          <button className="boton" onClick={() => setEditando("nueva")}>
            Añadir parada o trayecto
          </button>
          <button className="boton secundario" onClick={recargarHorario}>
            Recargar horario de Cercanías
          </button>
        </p>
      )}
      {estado && <p className="aviso">{estado}</p>}
    </section>
  );
}

function Formulario({ inicial, orden, alGuardar, alCancelar }) {
  const [f, setF] = useState({ ...VACIO, ...inicial, parada: inicial.parada || "", linea: inicial.linea || "" });
  const [origen, setOrigen] = useState(null); // { codigo, nombre }
  const [destino, setDestino] = useState(null);
  const [infoParada, setInfoParada] = useState(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Si la fila trae código, se muestra su nombre; si trae nombre (filas antiguas), se resuelve aquí.
  useEffect(() => {
    const resolver = async (v, poner) => {
      if (!v) return;
      const q = supabase.from("cercanias_estaciones").select("stop_id, nombre").limit(1);
      const { data } = /^\d{4,5}$/.test(v) ? await q.eq("stop_id", v) : await q.eq("nombre_busqueda", sinTildes(v));
      poner(data?.[0] ? { codigo: data[0].stop_id, nombre: data[0].nombre } : { codigo: null, nombre: v });
    };
    if (inicial.tipo === "cercanias") {
      resolver(inicial.origen, setOrigen);
      resolver(inicial.destino, setDestino);
    }
  }, [inicial]);

  const comprobarParada = async (id = f.parada) => {
    setError("");
    setInfoParada(null);
    try {
      const r = await llamar(`?accion=parada&id=${encodeURIComponent(id)}`);
      setInfoParada(r.parada);
    } catch (e) {
      setError(e.message);
    }
  };

  const guardar = async () => {
    setError("");
    const fila = { tipo: f.tipo, etiqueta: f.etiqueta.trim(), linea: f.linea.trim() || null };
    if (f.tipo === "emt") {
      fila.parada = String(f.parada).replace(/\D/g, "");
      fila.origen = null;
      fila.destino = null;
      if (!fila.parada) return setError("Falta el número de parada.");
      if (!fila.etiqueta) fila.etiqueta = fila.linea ? `Bus ${fila.linea}` : `Parada ${fila.parada}`;
    } else {
      // Se guardan los códigos de estación, no los nombres: así la consulta no tiene que buscarlos.
      if (!origen?.codigo || !destino?.codigo) return setError("Elige origen y destino de la lista.");
      fila.parada = null;
      fila.origen = origen.codigo;
      fila.destino = destino.codigo;
      fila.linea = fila.linea ? fila.linea.replace(/[\s-]/g, "").toUpperCase() : null;
      if (!fila.etiqueta) fila.etiqueta = `${fila.linea || "Tren"} a ${destino.nombre}`;
    }
    setGuardando(true);
    const { error } = inicial.id
      ? await supabase.from("transporte_config").update(fila).eq("id", inicial.id)
      : await supabase.from("transporte_config").insert({ ...fila, orden });
    setGuardando(false);
    if (error) return setError(error.message);
    alGuardar(fila.tipo);
  };

  return (
    <div className="tr-formulario">
      {!inicial.id && (
        <div className="selector" role="group" aria-label="Tipo">
          {[
            ["emt", "Autobús EMT"],
            ["cercanias", "Cercanías"],
          ].map(([id, texto]) => (
            <button key={id} aria-pressed={f.tipo === id} onClick={() => setF({ ...f, tipo: id })}>
              {texto}
            </button>
          ))}
        </div>
      )}

      <label className="tr-campo">
        <span>Nombre que verás</span>
        <input className="entrada" value={f.etiqueta} onChange={cambiar("etiqueta")} placeholder="Opcional" />
      </label>

      {f.tipo === "emt" ? (
        <>
          <div className="tr-campo">
            <span>Parada</span>
            <div className="fila-formulario">
              <input
                className="entrada corta"
                inputMode="numeric"
                value={f.parada}
                onChange={cambiar("parada")}
                placeholder="Nº"
                aria-label="Número de parada"
              />
              <button className="boton secundario" onClick={() => comprobarParada()} disabled={!f.parada}>
                Comprobar
              </button>
            </div>
            {infoParada && (
              <p className="aviso">
                {infoParada.nombre} · líneas {infoParada.lineas.map((l) => l.linea).join(", ")}
              </p>
            )}
            <BuscarParadaEMT
              alElegir={(p) => {
                setF((x) => ({ ...x, parada: p.id }));
                comprobarParada(p.id);
              }}
            />
          </div>
          <label className="tr-campo">
            <span>Línea</span>
            <input
              className="entrada corta"
              value={f.linea}
              onChange={cambiar("linea")}
              placeholder="Todas"
              list="tr-lineas-parada"
            />
            {infoParada && (
              <datalist id="tr-lineas-parada">
                {infoParada.lineas.map((l) => (
                  <option key={l.linea} value={l.linea} />
                ))}
              </datalist>
            )}
          </label>
        </>
      ) : (
        <>
          <label className="tr-campo">
            <span>Línea</span>
            <input className="entrada corta" value={f.linea} onChange={cambiar("linea")} placeholder="C5" />
          </label>
          <BuscarEstacion etiqueta="Origen" valor={origen} alElegir={setOrigen} />
          <BuscarEstacion etiqueta="Destino" valor={destino} alElegir={setDestino} />
          <p className="aviso">
            Solo se muestran los trenes que van de origen a destino, en ese sentido.
          </p>
        </>
      )}

      {error && <p className="fallo">{error}</p>}
      <p className="fila-formulario">
        <button className="boton" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button className="boton secundario" onClick={alCancelar}>
          Cancelar
        </button>
      </p>
    </div>
  );
}

// La EMT no busca paradas por su nombre; sí por calle (y número, si se escribe al final).
function BuscarParadaEMT({ alElegir }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");

  const buscar = async () => {
    setError("");
    setRes(null);
    try {
      const r = await llamar(`?accion=calle&q=${encodeURIComponent(q)}`);
      setRes(r.paradas);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <details className="desplegable tr-buscar">
      <summary>No sé el número: buscar por calle</summary>
      <div className="fila-formulario">
        <input
          className="entrada"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
          placeholder="Calle y número, p. ej. Gran Vía 30"
          aria-label="Calle"
        />
        <button className="boton secundario" onClick={buscar} disabled={q.trim().length < 3}>
          Buscar
        </button>
      </div>
      {error && <p className="fallo">{error}</p>}
      {res?.length === 0 && <p className="aviso">No hay paradas cerca de esa calle.</p>}
      {res?.length > 0 && (
        <ul className="lista-simple tr-resultados">
          {res.map((p) => (
            <li key={p.id}>
              <button className="fila-nota" onClick={() => alElegir(p)}>
                <span className="fila-titulo">
                  {p.id} · {p.nombre}
                </span>
                <span className="fila-fecha">{p.lineas.join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function BuscarEstacion({ etiqueta, valor, alElegir }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);

  useEffect(() => {
    const t = sinTildes(q);
    if (t.length < 3) {
      setRes(null);
      return;
    }
    const id = setTimeout(async () => {
      const { data } = await supabase
        .from("cercanias_estaciones")
        .select("stop_id, nombre")
        .ilike("nombre_busqueda", `%${t}%`)
        .order("nombre")
        .limit(8);
      setRes(data || []);
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="tr-campo">
      <span>{etiqueta}</span>
      {valor?.codigo ? (
        <p className="fila-formulario">
          <strong>{valor.nombre}</strong>
          <span className="aviso">código {valor.codigo}</span>
          <button className="boton-texto" onClick={() => alElegir(null)}>
            Cambiar
          </button>
        </p>
      ) : (
        <>
          {valor?.nombre && <p className="aviso">“{valor.nombre}” no está en la lista de Renfe; elígela de nuevo.</p>}
          <input
            className="entrada"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Escribe el nombre de la estación"
            aria-label={etiqueta}
          />
          {res?.length === 0 && (
            <p className="aviso">
              No hay coincidencias. Si la lista está vacía, pulsa «Recargar horario de Cercanías».
            </p>
          )}
          {res?.length > 0 && (
            <ul className="lista-simple tr-resultados">
              {res.map((e) => (
                <li key={e.stop_id}>
                  <button
                    className="fila-nota"
                    onClick={() => {
                      alElegir({ codigo: e.stop_id, nombre: e.nombre });
                      setQ("");
                    }}
                  >
                    <span className="fila-titulo">{e.nombre}</span>
                    <span className="fila-fecha">{e.stop_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
