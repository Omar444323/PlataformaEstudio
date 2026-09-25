"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { abrirPdf } from "../lib/pdf";
import { MODULOS, clasesDelDia, momento, aMinutos } from "../lib/horario";
import VisorApuntes from "./VisorApuntes";
import BlocNotas from "./BlocNotas";

const MAX_MB = 50;
const SIN_CARPETA = "__sin";
const nombreCorto = (codigo) => MODULOS[codigo]?.corto || MODULOS[codigo]?.nombre || "Sin carpeta";

function idEnUrl() {
  const partes = window.location.hash.slice(1).split("/");
  return partes[0] === "apuntes" ? partes[1] || null : null;
}

/* =====================================================================
   Espacio de apuntes: pestaña fija «Ahora», «Carpetas» y los documentos
   que abras. Con «Dividir», «Ahora» queda a la izquierda y lo demás a la derecha.
   ===================================================================== */

export default function Apuntes({ correo, alSalir }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [abiertas, setAbiertas] = useState([]); // ids de documentos abiertos como pestaña
  const [sel, setSel] = useState("ahora"); // "ahora" | "carpetas" | id de documento
  const [dividir, setDividir] = useState(false);
  const [foco, setFoco] = useState("izq");
  const [idAhora, setIdAhora] = useState(null); // documento que se ve en «Ahora»
  const [ancho, setAncho] = useState(1200);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from("documentos")
      .select("*")
      .order("editado_en", { ascending: false });
    if (error) {
      setError(
        error.code === "42P01" || error.code === "42703"
          ? "Falta actualizar la base de datos: ejecuta supabase/apuntes.sql en Supabase."
          : error.message
      );
      return;
    }
    setError("");
    setDocs(data);
  }, []);

  useEffect(() => {
    cargar();
    // lo que marque el otro como «activo» se ve al volver a la pestaña y cada minuto
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    const id = setInterval(cargar, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      clearInterval(id);
    };
  }, [cargar]);

  // Preferencias del dispositivo y documento de la URL
  useEffect(() => {
    try {
      setDividir(localStorage.getItem("apuntesDividir") === "1");
    } catch {}
    const id = idEnUrl();
    if (id === "carpetas") setSel("carpetas");
    else if (id) {
      setAbiertas([id]);
      setSel(id);
    }
    const medir = () => setAncho(window.innerWidth);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  useEffect(() => {
    const destino = sel === "ahora" ? "#apuntes" : sel === "carpetas" ? "#apuntes/carpetas" : `#apuntes/${sel}`;
    if (window.location.hash !== destino) history.replaceState(null, "", destino);
  }, [sel]);

  const cambiarDividir = () => {
    const v = !dividir;
    setDividir(v);
    if (v && sel === "ahora") setSel("carpetas");
    try {
      localStorage.setItem("apuntesDividir", v ? "1" : "0");
    } catch {}
  };

  const abrir = useCallback((doc) => {
    setAbiertas((a) => (a.includes(doc.id) ? a : [...a, doc.id]));
    setSel(doc.id);
    setFoco("der");
  }, []);

  const cerrarPestana = (id) => {
    setAbiertas((a) => {
      const resto = a.filter((x) => x !== id);
      if (sel === id) setSel(resto[resto.length - 1] || (dividir ? "carpetas" : "ahora"));
      return resto;
    });
  };

  const actualizarDoc = useCallback((d) => setDocs((ds) => ds?.map((x) => (x.id === d.id ? d : x))), []);

  const porId = useMemo(() => Object.fromEntries((docs || []).map((d) => [d.id, d])), [docs]);
  const partido = dividir && ancho >= 700; // en pantallas estrechas no cabe partido

  const comunes = { docs: docs || [], correo, recargar: cargar, abrir, actualizarDoc, setError };

  const renderPanel = (clave, lado) => {
    const enfocado = !partido || foco === lado;
    const alEnfocar = () => setFoco(lado);
    if (clave === "ahora")
      return <PanelAhora {...comunes} enfocado={enfocado} alEnfocar={alEnfocar} alVerDoc={setIdAhora} />;
    if (clave === "carpetas")
      return <Carpetas {...comunes} enfocado={enfocado} alEnfocar={alEnfocar} bloqueado={partido ? idAhora : null} />;
    const d = porId[clave];
    if (!d) return <p className="aviso panel-vacio">{docs ? "Este documento ya no existe." : "Cargando…"}</p>;
    if (partido && d.id === idAhora)
      return <p className="aviso panel-vacio">Este documento ya está abierto a la izquierda, en «Ahora».</p>;
    return (
      <VisorApuntes
        key={d.id}
        doc={d}
        correo={correo}
        incrustado
        enfocado={enfocado}
        alEnfocar={alEnfocar}
        alActualizarDoc={actualizarDoc}
      />
    );
  };

  const selDerecha = partido && sel === "ahora" ? "carpetas" : sel;

  return (
    <div className="espacio">
      <header className="espacio-barra">
        <button className="espacio-salir" onClick={alSalir} title="Volver al menú">
          ←<span className="espacio-salir-texto"> Menú</span>
        </button>
        <nav className="espacio-pestanas" aria-label="Pestañas de apuntes">
          {!partido && (
            <button className="espacio-pestana fija" aria-current={sel === "ahora" ? "page" : undefined} onClick={() => setSel("ahora")}>
              <span className="punto-ahora" aria-hidden="true" />
              Ahora
            </button>
          )}
          <button className="espacio-pestana fija" aria-current={selDerecha === "carpetas" ? "page" : undefined} onClick={() => setSel("carpetas")}>
            Carpetas
          </button>
          {abiertas.map((id) => {
            const d = porId[id];
            return (
              <span
                key={id}
                className="espacio-pestana"
                aria-current={selDerecha === id ? "page" : undefined}
                style={{ "--modulo": MODULOS[d?.asignatura]?.color || "var(--linea)" }}
              >
                <button className="espacio-pestana-abrir" onClick={() => setSel(id)} title={d?.titulo}>
                  {d ? (d.es_lienzo ? `Lienzo · ${nombreCorto(d.asignatura)}` : d.titulo) : "…"}
                </button>
                <button className="espacio-pestana-cerrar" onClick={() => cerrarPestana(id)} aria-label={`Cerrar ${d?.titulo || ""}`}>
                  ×
                </button>
              </span>
            );
          })}
        </nav>
        <button
          className="espacio-dividir"
          aria-pressed={dividir}
          onClick={cambiarDividir}
          title={ancho < 700 ? "La pantalla es demasiado estrecha para dividir" : "«Ahora» a la izquierda y otra pestaña a la derecha"}
        >
          <svg className="icono" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v14H4zM12 5v14" />
          </svg>
          <span className="espacio-dividir-texto">Dividir</span>
        </button>
      </header>

      {error && (
        <p className="fallo espacio-error">
          {error}{" "}
          <button className="boton-texto" onClick={() => setError("")}>
            Cerrar
          </button>
        </p>
      )}

      <div className={`espacio-cuerpo${partido ? " partido" : ""}`}>
        {partido ? (
          <>
            <section className={`panel-espacio${foco === "izq" ? " enfocado" : ""}`}>{renderPanel("ahora", "izq")}</section>
            <section className={`panel-espacio${foco === "der" ? " enfocado" : ""}`}>{renderPanel(selDerecha, "der")}</section>
          </>
        ) : (
          <section className="panel-espacio">{renderPanel(sel, "izq")}</section>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   «Ahora»: lo que toca según el horario y los documentos marcados como activos
   ===================================================================== */

function asignaturaDelMomento() {
  const m = momento();
  if (m.ahora) return { codigo: m.ahora.modulo, motivo: `En clase hasta las ${m.ahora.fin}` };
  if (m.siguiente) {
    const falta = aMinutos(m.siguiente.inicio) - m.min;
    if (falta <= 30 || m.enRecreo)
      return { codigo: m.siguiente.modulo, motivo: `Empieza a las ${m.siguiente.inicio}` };
  }
  return { codigo: null, motivo: m.clases.length ? "Ahora no tienes clase" : "Hoy no hay clase" };
}

function PanelAhora({ docs, correo, recargar, abrir, actualizarDoc, setError, enfocado, alEnfocar, alVerDoc }) {
  const [auto, setAuto] = useState(() => ({ codigo: null, motivo: "" }));
  const [elegida, setElegida] = useState(null); // si eliges otra asignatura a mano
  const [vista, setVista] = useState("doc"); // doc | notas | lienzo
  const [docSel, setDocSel] = useState(null);

  useEffect(() => {
    const actualizar = () => setAuto(asignaturaDelMomento());
    actualizar();
    const id = setInterval(actualizar, 30_000);
    return () => clearInterval(id);
  }, []);

  const codigo = elegida || auto.codigo;
  const hoy = useMemo(() => {
    const vistos = new Set();
    return clasesDelDia(new Date().getDay()).filter((c) => !vistos.has(c.modulo) && vistos.add(c.modulo));
  }, []);

  const deLaAsignatura = docs.filter((d) => d.asignatura === codigo && !d.es_lienzo);
  const activos = deLaAsignatura.filter((d) => d.activo);
  const actual = activos.find((d) => d.id === docSel) || activos[0] || null;

  useEffect(() => {
    alVerDoc(vista === "doc" ? actual?.id || null : null);
  }, [vista, actual?.id, alVerDoc]);
  useEffect(() => () => alVerDoc(null), [alVerDoc]);

  const marcar = async (d, activo) => {
    const { error } = await supabase.from("documentos").update({ activo }).eq("id", d.id);
    if (error) return setError(error.message);
    actualizarDoc({ ...d, activo });
    if (activo) setDocSel(d.id);
  };

  const m = MODULOS[codigo];

  return (
    <div className="ahora" style={{ "--modulo": m?.color || "var(--linea)" }}>
      <div className="ahora-barra">
        <div className="ahora-asignatura">
          <span className="ahora-motivo">{elegida ? "Elegida a mano" : auto.motivo}</span>
          <strong>{codigo ? m?.nombre : "Elige una asignatura"}</strong>
        </div>
        <div className="ahora-chips" role="group" aria-label="Asignatura">
          {hoy.map((c) => (
            <button
              key={c.modulo}
              className="chip"
              style={{ "--modulo": c.color }}
              aria-pressed={codigo === c.modulo}
              onClick={() => setElegida(c.modulo === auto.codigo ? null : c.modulo)}
              title={c.nombre}
            >
              {c.corto || c.nombre}
            </button>
          ))}
          <select
            className="chip chip-select"
            value=""
            onChange={(e) => e.target.value && setElegida(e.target.value)}
            aria-label="Otra asignatura"
          >
            <option value="">Otra…</option>
            {Object.entries(MODULOS).map(([k, mm]) => (
              <option key={k} value={k}>
                {k} · {mm.corto || mm.nombre}
              </option>
            ))}
          </select>
          {elegida && (
            <button className="boton-texto" onClick={() => setElegida(null)}>
              Volver al horario
            </button>
          )}
        </div>
      </div>

      {codigo && (
        <div className="ahora-sub">
          <div className="selector" role="group" aria-label="Qué ver">
            {[
              ["doc", "Documento de clase"],
              ["notas", "Bloc de notas"],
              ["lienzo", "Lienzo"],
            ].map(([id, t]) => (
              <button key={id} aria-pressed={vista === id} onClick={() => setVista(id)}>
                {t}
              </button>
            ))}
          </div>
          {vista === "doc" && activos.length > 1 && (
            <div className="ahora-chips" role="group" aria-label="Documento activo">
              {activos.map((d) => (
                <button key={d.id} className="chip" aria-pressed={actual?.id === d.id} onClick={() => setDocSel(d.id)}>
                  {d.titulo}
                </button>
              ))}
            </div>
          )}
          {vista === "doc" && actual && (
            <button className="boton-texto" onClick={() => marcar(actual, false)} title="Deja de salir en «Ahora»">
              Quitar de activos
            </button>
          )}
        </div>
      )}

      <div className="ahora-contenido">
        {!codigo && (
          <div className="vacio-apuntes">
            <p>{auto.motivo}. Elige una asignatura arriba para ver sus apuntes.</p>
          </div>
        )}

        {codigo && vista === "notas" && <BlocNotas key={codigo} asignatura={codigo} correo={correo} />}

        {codigo && vista === "lienzo" && (
          <LienzoAsignatura key={codigo} asignatura={codigo} correo={correo} docs={docs} recargar={recargar} setError={setError} enfocado={enfocado} alEnfocar={alEnfocar} actualizarDoc={actualizarDoc} />
        )}

        {codigo && vista === "doc" && actual && (
          <VisorApuntes
            key={actual.id}
            doc={actual}
            correo={correo}
            incrustado
            enfocado={enfocado}
            alEnfocar={alEnfocar}
            alActualizarDoc={actualizarDoc}
          />
        )}

        {codigo && vista === "doc" && !actual && (
          <div className="vacio-apuntes ahora-elegir">
            <p>
              <strong>No hay ningún documento activo de {nombreCorto(codigo)}.</strong>
              <br />
              Marca el que estáis dando en clase y aparecerá aquí (también a tu pareja).
            </p>
            {deLaAsignatura.length ? (
              <ul className="lista-marcar">
                {deLaAsignatura.map((d) => (
                  <li key={d.id}>
                    <span>{d.titulo}</span>
                    <button className="boton" onClick={() => marcar(d, true)}>
                      Marcar como activo
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="aviso">
                Esta carpeta está vacía. Sube el PDF desde <strong>Carpetas</strong>.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   Lienzo de una asignatura (un cuaderno en blanco, uno por asignatura)
   ===================================================================== */

function LienzoAsignatura({ asignatura, correo, docs, recargar, setError, enfocado, alEnfocar, actualizarDoc, bloqueado }) {
  const existente = docs.find((d) => d.es_lienzo && d.asignatura === asignatura);
  const creando = useRef(false);

  useEffect(() => {
    if (existente || creando.current) return;
    creando.current = true;
    (async () => {
      const { error } = await supabase.from("documentos").insert({
        titulo: `Lienzo · ${nombreCorto(asignatura)}`,
        tipo: "cuaderno",
        paginas: 1,
        asignatura,
        es_lienzo: true,
        subido_por: correo,
      });
      // 23505 = ya lo había creado el otro a la vez; basta con recargar
      if (error && error.code !== "23505") setError(error.message);
      await recargar();
      creando.current = false;
    })();
  }, [existente, asignatura, correo, recargar, setError]);

  if (!existente) return <p className="aviso panel-vacio">Preparando el lienzo…</p>;
  if (bloqueado === existente.id)
    return <p className="aviso panel-vacio">Este lienzo ya está abierto a la izquierda, en «Ahora».</p>;
  return (
    <VisorApuntes
      key={existente.id}
      doc={existente}
      correo={correo}
      incrustado
      enfocado={enfocado}
      alEnfocar={alEnfocar}
      alActualizarDoc={actualizarDoc}
    />
  );
}

/* =====================================================================
   Carpetas: una por asignatura (+ «Sin carpeta» si hay algo suelto)
   ===================================================================== */

function Carpetas(props) {
  const { docs } = props;
  const [abierta, setAbierta] = useState(null);

  if (abierta) return <Carpeta {...props} codigo={abierta} alVolver={() => setAbierta(null)} />;

  const normales = docs.filter((d) => !d.es_lienzo);
  const sueltos = normales.filter((d) => !d.asignatura || !MODULOS[d.asignatura]);

  return (
    <div className="carpetas">
      <ul className="rejilla-carpetas">
        {Object.entries(MODULOS).map(([codigo, m]) => {
          const suyos = normales.filter((d) => d.asignatura === codigo);
          const activos = suyos.filter((d) => d.activo).length;
          return (
            <li key={codigo}>
              <button className="carpeta" style={{ "--modulo": m.color }} onClick={() => setAbierta(codigo)}>
                <span className="carpeta-pestana" aria-hidden="true" />
                <span className="carpeta-codigo">{codigo}</span>
                <span className="carpeta-nombre">{m.nombre}</span>
                <span className="carpeta-meta">
                  {suyos.length} {suyos.length === 1 ? "documento" : "documentos"}
                  {activos > 0 && <span className="etiqueta ahora">{activos} activo{activos > 1 ? "s" : ""}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {sueltos.length > 0 && (
          <li>
            <button className="carpeta sin" onClick={() => setAbierta(SIN_CARPETA)}>
              <span className="carpeta-pestana" aria-hidden="true" />
              <span className="carpeta-codigo">—</span>
              <span className="carpeta-nombre">Sin carpeta</span>
              <span className="carpeta-meta">{sueltos.length} por ordenar</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function Carpeta({ codigo, alVolver, docs, correo, recargar, abrir, actualizarDoc, setError, enfocado, alEnfocar, bloqueado }) {
  const [vista, setVista] = useState("docs"); // docs | notas | lienzo
  const [subiendo, setSubiendo] = useState("");
  const [creando, setCreando] = useState(false);
  const refArchivo = useRef(null);
  const sin = codigo === SIN_CARPETA;
  const m = MODULOS[codigo];

  const lista = docs.filter((d) => !d.es_lienzo && (sin ? !d.asignatura || !MODULOS[d.asignatura] : d.asignatura === codigo));

  const subir = async (archivos) => {
    const todos = [...archivos];
    for (const [i, archivo] of todos.entries()) {
      const prefijo = todos.length > 1 ? `(${i + 1}/${todos.length}) ` : "";
      if (!/\.pdf$/i.test(archivo.name) && archivo.type !== "application/pdf") {
        setError(`${archivo.name} no es un PDF. Si es un Word, ábrelo y usa Archivo → Guardar como → PDF.`);
        continue;
      }
      if (archivo.size > MAX_MB * 1024 * 1024) {
        setError(`${archivo.name} ocupa más de ${MAX_MB} MB.`);
        continue;
      }
      try {
        setSubiendo(`${prefijo}Leyendo ${archivo.name}…`);
        const documento = await abrirPdf((await archivo.arrayBuffer()).slice(0));
        const paginas = documento.numPages;
        documento.destroy();
        setSubiendo(`${prefijo}Subiendo ${archivo.name}…`);
        const ruta = `${crypto.randomUUID()}.pdf`;
        const { error: e1 } = await supabase.storage.from("apuntes").upload(ruta, archivo, { contentType: "application/pdf" });
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("documentos").insert({
          titulo: archivo.name.replace(/\.pdf$/i, ""),
          tipo: "pdf",
          ruta,
          paginas,
          asignatura: sin ? null : codigo,
          subido_por: correo,
        });
        if (e2) {
          await supabase.storage.from("apuntes").remove([ruta]);
          throw e2;
        }
      } catch (e) {
        setError(`No se pudo subir ${archivo.name}: ${e.message}`);
      }
    }
    setSubiendo("");
    if (refArchivo.current) refArchivo.current.value = "";
    recargar();
  };

  const crearCuaderno = async (titulo) => {
    const { data, error } = await supabase
      .from("documentos")
      .insert({ titulo, tipo: "cuaderno", paginas: 1, asignatura: sin ? null : codigo, subido_por: correo })
      .select()
      .single();
    if (error) return setError(error.message);
    setCreando(false);
    await recargar();
    abrir(data);
  };

  const cambiar = async (d, cambios) => {
    const { error } = await supabase.from("documentos").update(cambios).eq("id", d.id);
    if (error) return setError(error.message);
    actualizarDoc({ ...d, ...cambios });
  };

  const borrar = async (d) => {
    if (!confirm(`¿Borrar "${d.titulo}"? Se borran también las anotaciones de los dos.`)) return;
    if (d.ruta) await supabase.storage.from("apuntes").remove([d.ruta]);
    const { error } = await supabase.from("documentos").delete().eq("id", d.id);
    if (error) setError(error.message);
    recargar();
  };

  return (
    <div className="carpeta-vista" style={{ "--modulo": m?.color || "var(--linea)" }}>
      <div className="carpeta-cabecera">
        <button className="boton-texto" onClick={alVolver}>
          ← Carpetas
        </button>
        <h2>
          {!sin && <span className="carpeta-codigo">{codigo}</span>} {sin ? "Sin carpeta" : m.nombre}
        </h2>
        {!sin && (
          <div className="selector" role="group" aria-label="Contenido de la carpeta">
            {[
              ["docs", "Documentos"],
              ["notas", "Bloc de notas"],
              ["lienzo", "Lienzo"],
            ].map(([id, t]) => (
              <button key={id} aria-pressed={vista === id} onClick={() => setVista(id)}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {vista === "notas" && !sin && <BlocNotas key={codigo} asignatura={codigo} correo={correo} />}

      {vista === "lienzo" && !sin && (
        <div className="carpeta-lienzo">
          <LienzoAsignatura
            key={codigo}
            asignatura={codigo}
            correo={correo}
            docs={docs}
            recargar={recargar}
            setError={setError}
            enfocado={enfocado}
            alEnfocar={alEnfocar}
            actualizarDoc={actualizarDoc}
            bloqueado={bloqueado}
          />
        </div>
      )}

      {(vista === "docs" || sin) && (
        <div className="carpeta-docs">
          <div className="apuntes-acciones">
            <button className="boton" onClick={() => refArchivo.current?.click()} disabled={!!subiendo}>
              Subir PDF
            </button>
            <button className="boton secundario" onClick={() => setCreando((v) => !v)}>
              Cuaderno nuevo
            </button>
            <input
              ref={refArchivo}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => e.target.files?.length && subir(e.target.files)}
            />
            {subiendo && <span className="aviso">{subiendo}</span>}
          </div>

          {creando && <FormCuaderno alCrear={crearCuaderno} alCancelar={() => setCreando(false)} />}

          {lista.length === 0 && (
            <div className="vacio-apuntes">
              <p>Esta carpeta está vacía. Sube un PDF o crea un cuaderno.</p>
            </div>
          )}

          <ul className="lista-docs">
            {lista.map((d) => (
              <li key={d.id} className={`fila-doc${d.activo ? " activo" : ""}`}>
                <button className="fila-doc-abrir" onClick={() => abrir(d)}>
                  <span className={`fila-doc-tipo ${d.tipo}`}>{d.tipo === "pdf" ? "PDF" : "Cuaderno"}</span>
                  <span className="fila-doc-titulo">{d.titulo}</span>
                  <span className="fila-doc-meta">
                    {d.paginas} pág. · {d.subido_por === correo ? "tuyo" : d.subido_por?.split("@")[0]} ·{" "}
                    {new Date(d.editado_en).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                  </span>
                </button>
                <div className="fila-doc-acciones">
                  <label className="interruptor activo-switch" title="Los documentos activos salen en «Ahora» durante la clase">
                    <input type="checkbox" checked={!!d.activo} onChange={(e) => cambiar(d, { activo: e.target.checked })} />
                    <span>{d.activo ? "Activo en clase" : "Activo"}</span>
                  </label>
                  <select
                    className="selector-asignatura"
                    value={d.asignatura || ""}
                    onChange={(e) => cambiar(d, { asignatura: e.target.value || null })}
                    aria-label="Mover a carpeta"
                  >
                    <option value="">Sin carpeta</option>
                    {Object.entries(MODULOS).map(([k, mm]) => (
                      <option key={k} value={k}>
                        {k} · {mm.corto || mm.nombre}
                      </option>
                    ))}
                  </select>
                  {d.subido_por === correo && (
                    <button className="boton-texto" onClick={() => borrar(d)}>
                      Borrar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FormCuaderno({ alCrear, alCancelar }) {
  const [titulo, setTitulo] = useState("");
  return (
    <form
      className="form-cuaderno"
      onSubmit={(e) => {
        e.preventDefault();
        alCrear(titulo.trim() || "Cuaderno sin título");
      }}
    >
      <input
        className="entrada"
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Título, p. ej. Tema 3 · Nóminas"
        aria-label="Título del cuaderno"
      />
      <button className="boton" type="submit">
        Crear y abrir
      </button>
      <button className="boton-texto" type="button" onClick={alCancelar}>
        Cancelar
      </button>
    </form>
  );
}
