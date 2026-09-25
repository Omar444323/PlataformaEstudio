"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { abrirPdf } from "../lib/pdf";

// Todas las coordenadas se guardan relativas al ANCHO de la página (0–1),
// así el mismo trazo encaja igual en el iPad, en el portátil y con cualquier zoom.

const A4 = { w: 595, h: 842 };
const COLORES_BOLI = ["#14203a", "#1f4fd8", "#c62828", "#1f7a4d"];
const COLORES_SUBRAYADOR = ["#ffe066", "#8ef0a0", "#ffa8d0", "#8fd3ff"];
const GROSORES = { fino: 0.0022, medio: 0.0036, grueso: 0.0058 };
const GROSOR_SUBRAYADOR = 0.022;
const RADIO_BORRADOR = 0.014;
const MAX_PIXELES = 12_000_000; // tope por lienzo para que el iPad no se quede sin memoria

const redondear = (n) => Math.round(n * 10000) / 10000;

function useDebounceGuardado(documentoId, correo) {
  const pendientes = useRef(new Map()); // pagina → datos
  const temporizador = useRef(null);
  const [estado, setEstado] = useState("guardado"); // guardado | pendiente | guardando | error

  const vaciar = useCallback(async () => {
    if (pendientes.current.size === 0) return;
    const filas = [...pendientes.current.entries()].map(([pagina, d]) => ({
      documento_id: documentoId,
      autor: correo,
      pagina,
      trazos: d.trazos,
      textos: d.textos,
      actualizado_en: new Date().toISOString(),
    }));
    pendientes.current.clear();
    setEstado("guardando");
    const { error } = await supabase
      .from("anotaciones")
      .upsert(filas, { onConflict: "documento_id,autor,pagina" });
    if (error) {
      // se vuelven a poner en cola y se reintenta
      filas.forEach((f) => {
        if (!pendientes.current.has(f.pagina))
          pendientes.current.set(f.pagina, { trazos: f.trazos, textos: f.textos });
      });
      setEstado("error");
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(vaciar, 5000);
      return;
    }
    setEstado(pendientes.current.size ? "pendiente" : "guardado");
  }, [documentoId, correo]);

  const programar = useCallback(
    (pagina, datos) => {
      pendientes.current.set(pagina, datos);
      setEstado("pendiente");
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(vaciar, 900);
    },
    [vaciar]
  );

  useEffect(() => {
    const avisar = (e) => {
      if (pendientes.current.size) {
        vaciar();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", avisar);
    return () => {
      window.removeEventListener("beforeunload", avisar);
      clearTimeout(temporizador.current);
      vaciar();
    };
  }, [vaciar]);

  return { estado, programar, vaciar };
}

export default function VisorApuntes({ doc, correo, alCerrar, alActualizarDoc }) {
  const [pdf, setPdf] = useState(null);
  const [tamanos, setTamanos] = useState(null); // [{w,h}] en puntos
  const [error, setError] = useState("");
  const [datos, setDatos] = useState({}); // pagina → {trazos, textos}
  const [herramienta, setHerramienta] = useState("boli");
  const [colorBoli, setColorBoli] = useState(COLORES_BOLI[0]);
  const [colorSub, setColorSub] = useState(COLORES_SUBRAYADOR[0]);
  const [grosor, setGrosor] = useState("medio");
  const [zoom, setZoom] = useState(1);
  const [anchoBase, setAnchoBase] = useState(800);
  const [soloLapiz, setSoloLapiz] = useState(false);
  const [hayTactil, setHayTactil] = useState(false);
  const [paginaActual, setPaginaActual] = useState(1);
  const historial = useRef({ atras: [], adelante: [] });
  const [, forzar] = useState(0);
  const contenedor = useRef(null);
  const { estado, programar, vaciar } = useDebounceGuardado(doc.id, correo);

  // Preferencias de este dispositivo
  useEffect(() => {
    try {
      setSoloLapiz(localStorage.getItem("apuntesSoloLapiz") === "1");
      const g = localStorage.getItem("apuntesGrosor");
      if (g && GROSORES[g]) setGrosor(g);
    } catch {}
    setHayTactil(navigator.maxTouchPoints > 0);
  }, []);

  const cambiarSoloLapiz = (v) => {
    setSoloLapiz(v);
    try {
      localStorage.setItem("apuntesSoloLapiz", v ? "1" : "0");
    } catch {}
  };

  // Carga del archivo y de mis anotaciones
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { data: filas, error: e1 } = await supabase
          .from("anotaciones")
          .select("pagina, trazos, textos")
          .eq("documento_id", doc.id);
        if (e1) throw e1;
        const mapa = {};
        (filas || []).forEach(
          (f) =>
            (mapa[f.pagina] = {
              trazos: f.trazos || [],
              textos: (f.textos || []).filter((t) => t.t?.trim()),
            })
        );
        if (!cancelado) setDatos(mapa);

        if (doc.tipo === "pdf") {
          const { data: blob, error: e2 } = await supabase.storage.from("apuntes").download(doc.ruta);
          if (e2) throw e2;
          const documento = await abrirPdf(await blob.arrayBuffer());
          const t = [];
          for (let i = 1; i <= documento.numPages; i++) {
            const p = await documento.getPage(i);
            const v = p.getViewport({ scale: 1 });
            t.push({ w: v.width, h: v.height });
          }
          if (!cancelado) {
            setPdf(documento);
            setTamanos(t);
          }
        } else if (!cancelado) {
          setTamanos(Array.from({ length: doc.paginas }, () => A4));
        }
      } catch (e) {
        if (!cancelado) setError(e.message || "No se pudo abrir el documento.");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [doc.id, doc.tipo, doc.ruta, doc.paginas]);

  // Ancho disponible
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const medir = () => setAnchoBase(Math.min(el.clientWidth - 32, 980));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tamanos]);

  const ancho = Math.round(anchoBase * zoom);

  const cambiarZoom = (nuevo) => {
    const z = Math.min(3, Math.max(0.5, Math.round(nuevo * 100) / 100));
    const el = contenedor.current;
    const rel = el ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0;
    setZoom(z);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = rel * el.scrollHeight - el.clientHeight / 2;
    });
  };

  // Aplica un cambio en una página, lo guarda y lo apunta en el historial
  const aplicar = useCallback(
    (pagina, nuevo, anterior) => {
      setDatos((d) => ({ ...d, [pagina]: nuevo }));
      programar(pagina, nuevo);
      historial.current.atras.push({ pagina, antes: anterior, despues: nuevo });
      if (historial.current.atras.length > 100) historial.current.atras.shift();
      historial.current.adelante = [];
      forzar((n) => n + 1);
    },
    [programar]
  );

  const deshacer = () => {
    const paso = historial.current.atras.pop();
    if (!paso) return;
    historial.current.adelante.push(paso);
    setDatos((d) => ({ ...d, [paso.pagina]: paso.antes }));
    programar(paso.pagina, paso.antes);
    forzar((n) => n + 1);
  };

  const rehacer = () => {
    const paso = historial.current.adelante.pop();
    if (!paso) return;
    historial.current.atras.push(paso);
    setDatos((d) => ({ ...d, [paso.pagina]: paso.despues }));
    programar(paso.pagina, paso.despues);
    forzar((n) => n + 1);
  };

  // Atajos de teclado en el portátil
  useEffect(() => {
    const tecla = (e) => {
      if (e.target.closest?.("[contenteditable], input, textarea")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? rehacer() : deshacer();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        rehacer();
      } else if (!mod) {
        const mapa = { b: "boli", s: "subrayador", e: "borrador", t: "texto", m: "mano" };
        if (mapa[e.key.toLowerCase()]) setHerramienta(mapa[e.key.toLowerCase()]);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const alHacerScroll = () => {
    const el = contenedor.current;
    if (!el || !tamanos) return;
    const marca = el.scrollTop + el.clientHeight / 3;
    let y = 16;
    for (let i = 0; i < tamanos.length; i++) {
      y += (ancho * tamanos[i].h) / tamanos[i].w + 16;
      if (y > marca) {
        setPaginaActual(i + 1);
        return;
      }
    }
  };

  const anadirPagina = async () => {
    const paginas = doc.paginas + 1;
    const { error: e } = await supabase
      .from("documentos")
      .update({ paginas, editado_en: new Date().toISOString() })
      .eq("id", doc.id);
    if (e) return setError(e.message);
    alActualizarDoc({ ...doc, paginas });
    setTamanos((t) => [...t, A4]);
    requestAnimationFrame(() => {
      const el = contenedor.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  };

  const cerrar = async () => {
    await vaciar();
    alCerrar();
  };

  const pincel = useMemo(
    () => ({
      herramienta,
      color: herramienta === "subrayador" ? colorSub : colorBoli,
      ancho: herramienta === "subrayador" ? GROSOR_SUBRAYADOR : GROSORES[grosor],
      soloLapiz,
    }),
    [herramienta, colorSub, colorBoli, grosor, soloLapiz]
  );

  const textoEstado = {
    guardado: "Guardado",
    pendiente: "Sin guardar…",
    guardando: "Guardando…",
    error: "Sin conexión, reintentando",
  }[estado];

  return (
    <div className="visor" role="dialog" aria-label={doc.titulo}>
      <header className="visor-barra">
        <div className="visor-fila">
          <button className="boton-texto visor-volver" onClick={cerrar}>
            ← Apuntes
          </button>
          <strong className="visor-titulo" title={doc.titulo}>
            {doc.titulo}
          </strong>
          <span className={`visor-estado ${estado}`} aria-live="polite">
            {textoEstado}
          </span>
        </div>

        <div className="visor-fila herramientas-visor" role="toolbar" aria-label="Herramientas">
          <div className="grupo-herr" role="group" aria-label="Herramienta">
            {[
              ["boli", "Bolígrafo", "B"],
              ["subrayador", "Subrayador", "S"],
              ["borrador", "Borrador", "E"],
              ["texto", "Texto", "T"],
              ["mano", "Mover", "M"],
            ].map(([id, nombre, atajo]) => (
              <button
                key={id}
                className="herr"
                aria-pressed={herramienta === id}
                onClick={() => setHerramienta(id)}
                title={`${nombre} (${atajo})`}
              >
                <IconoHerr id={id} />
                <span className="herr-nombre">{nombre}</span>
              </button>
            ))}
          </div>

          {/* Los grupos se ocultan sin desaparecer para que la barra no cambie de alto al cambiar de herramienta */}
          <div
            className="grupo-herr"
            role="group"
            aria-label="Color"
            style={{ visibility: herramienta === "borrador" || herramienta === "mano" ? "hidden" : "visible" }}
          >
            {(herramienta === "subrayador" ? COLORES_SUBRAYADOR : COLORES_BOLI).map((c) => {
              const activo = herramienta === "subrayador" ? colorSub === c : colorBoli === c;
              return (
                <button
                  key={c}
                  className="muestra"
                  style={{ background: c }}
                  aria-pressed={activo}
                  aria-label={`Color ${c}`}
                  onClick={() => (herramienta === "subrayador" ? setColorSub(c) : setColorBoli(c))}
                />
              );
            })}
          </div>
          <div
            className="grupo-herr"
            role="group"
            aria-label="Grosor"
            style={{ visibility: herramienta === "boli" ? "visible" : "hidden" }}
          >
            {Object.keys(GROSORES).map((g) => (
              <button
                key={g}
                className="herr grosor"
                aria-pressed={grosor === g}
                aria-label={`Grosor ${g}`}
                onClick={() => {
                  setGrosor(g);
                  try {
                    localStorage.setItem("apuntesGrosor", g);
                  } catch {}
                }}
              >
                <span style={{ height: `${GROSORES[g] * 900}px` }} />
              </button>
            ))}
          </div>

          <div className="grupo-herr" role="group" aria-label="Historial">
            <button className="herr" onClick={deshacer} disabled={!historial.current.atras.length} title="Deshacer (Ctrl+Z)">
              <IconoHerr id="deshacer" />
            </button>
            <button className="herr" onClick={rehacer} disabled={!historial.current.adelante.length} title="Rehacer (Ctrl+Y)">
              <IconoHerr id="rehacer" />
            </button>
          </div>

          <div className="grupo-herr" role="group" aria-label="Zoom">
            <button className="herr" onClick={() => cambiarZoom(zoom - 0.25)} aria-label="Alejar">
              −
            </button>
            <button className="herr zoom-valor" onClick={() => cambiarZoom(1)} title="Ajustar al ancho">
              {Math.round(zoom * 100)}%
            </button>
            <button className="herr" onClick={() => cambiarZoom(zoom + 0.25)} aria-label="Acercar">
              +
            </button>
          </div>

          {hayTactil && (
            <label className="interruptor" title="Con el lápiz escribes y con el dedo te desplazas">
              <input
                type="checkbox"
                checked={soloLapiz}
                onChange={(e) => cambiarSoloLapiz(e.target.checked)}
              />
              <span>Solo lápiz</span>
            </label>
          )}
        </div>
      </header>

      <div className="visor-hojas" ref={contenedor} onScroll={alHacerScroll}>
        {error && <p className="fallo visor-aviso">{error}</p>}
        {!error && !tamanos && <p className="aviso visor-aviso">Abriendo…</p>}
        {tamanos?.map((t, i) => (
          <Hoja
            key={i}
            numero={i + 1}
            tamano={t}
            ancho={ancho}
            pdf={pdf}
            cuaderno={doc.tipo === "cuaderno"}
            datos={datos[i + 1] || VACIO}
            pincel={pincel}
            aplicar={aplicar}
            contenedor={contenedor}
            alVerLapiz={() => !soloLapiz && hayTactil && cambiarSoloLapiz(true)}
          />
        ))}
        {doc.tipo === "cuaderno" && tamanos && (
          <button className="boton secundario anadir-pagina" onClick={anadirPagina}>
            Añadir página
          </button>
        )}
      </div>

      {tamanos && (
        <span className="indicador-pagina">
          {paginaActual} / {tamanos.length}
        </span>
      )}
    </div>
  );
}

const VACIO = { trazos: [], textos: [] };

/* ---------------- Una página ---------------- */

function Hoja({ numero, tamano, ancho, pdf, cuaderno, datos, pincel, aplicar, contenedor, alVerLapiz }) {
  const alto = Math.round((ancho * tamano.h) / tamano.w);
  const refHoja = useRef(null);
  const refFondo = useRef(null);
  const refSub = useRef(null);
  const refTinta = useRef(null);
  const refVivo = useRef(null);
  const [visible, setVisible] = useState(false);
  const [enfocarTexto, setEnfocarTexto] = useState(null);
  const gesto = useRef(null);
  const datosRef = useRef(datos);
  datosRef.current = datos;

  const escala = useMemo(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxDpr = Math.sqrt(MAX_PIXELES / Math.max(1, ancho * alto));
    return Math.max(1, Math.min(dpr, maxDpr));
  }, [ancho, alto]);

  // Solo se pintan las páginas cercanas a la pantalla
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      root: contenedor.current,
      rootMargin: "120% 0px",
    });
    io.observe(refHoja.current);
    return () => io.disconnect();
  }, [contenedor]);

  // Fondo: la página del PDF
  useEffect(() => {
    const lienzo = refFondo.current;
    if (!lienzo || cuaderno) return;
    if (!visible || !pdf) {
      lienzo.width = 0;
      lienzo.height = 0;
      return;
    }
    let tarea = null;
    let cancelado = false;
    pdf.getPage(numero).then((pagina) => {
      if (cancelado) return;
      const viewport = pagina.getViewport({ scale: (ancho * escala) / tamano.w });
      lienzo.width = Math.floor(viewport.width);
      lienzo.height = Math.floor(viewport.height);
      tarea = pagina.render({ canvasContext: lienzo.getContext("2d"), viewport });
      tarea.promise.catch(() => {});
    });
    return () => {
      cancelado = true;
      tarea?.cancel();
    };
  }, [visible, pdf, numero, ancho, escala, tamano.w, cuaderno]);

  // Trazos guardados
  useEffect(() => {
    const sub = refSub.current;
    const tinta = refTinta.current;
    const vivo = refVivo.current;
    if (!sub || !tinta) return;
    const w = visible ? Math.floor(ancho * escala) : 0;
    const h = visible ? Math.floor(alto * escala) : 0;
    for (const c of [sub, tinta, vivo]) {
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    }
    if (!visible) return;
    const cs = sub.getContext("2d");
    const ct = tinta.getContext("2d");
    cs.clearRect(0, 0, w, h);
    ct.clearRect(0, 0, w, h);
    for (const t of datos.trazos) pintarTrazo(t.h === "sub" ? cs : ct, t, w);
  }, [datos.trazos, visible, ancho, alto, escala]);

  const posicion = (e) => {
    const r = refVivo.current.getBoundingClientRect();
    return [redondear((e.clientX - r.left) / r.width), redondear((e.clientY - r.top) / r.width)];
  };

  const empezar = (e) => {
    if (e.pointerType === "pen") alVerLapiz();
    const desplazar =
      pincel.herramienta === "mano" || (e.pointerType === "touch" && pincel.soloLapiz);
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    if (desplazar) {
      const el = contenedor.current;
      gesto.current = { tipo: "mover", x: e.clientX, y: e.clientY, sx: el.scrollLeft, sy: el.scrollTop };
      return;
    }

    const p = posicion(e);
    if (pincel.herramienta === "texto") {
      e.preventDefault();
      const nuevo = { id: crypto.randomUUID(), x: p[0], y: p[1], t: "", c: pincel.color, s: 0.02 };
      setEnfocarTexto(nuevo.id);
      const d = datosRef.current;
      aplicar(numero, { ...d, textos: [...d.textos, nuevo] }, d);
      return;
    }
    if (pincel.herramienta === "borrador") {
      gesto.current = { tipo: "borrar", antes: datosRef.current, trazos: datosRef.current.trazos };
      borrarEn(p);
      return;
    }
    gesto.current = {
      tipo: "dibujar",
      trazo: {
        h: pincel.herramienta === "subrayador" ? "sub" : "boli",
        c: pincel.color,
        w: pincel.ancho,
        p: [p[0], p[1]],
      },
    };
    pintarVivo();
  };

  const mover = (e) => {
    const g = gesto.current;
    if (!g) return;
    if (g.tipo === "mover") {
      const el = contenedor.current;
      el.scrollLeft = g.sx - (e.clientX - g.x);
      el.scrollTop = g.sy - (e.clientY - g.y);
      return;
    }
    const agrupados = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const eventos = agrupados.length ? agrupados : [e];
    if (g.tipo === "borrar") {
      eventos.forEach((ev) => borrarEn(posicion(ev)));
      return;
    }
    const pts = g.trazo.p;
    for (const ev of eventos) {
      const [x, y] = posicion(ev);
      const dx = x - pts[pts.length - 2];
      const dy = y - pts[pts.length - 1];
      if (dx * dx + dy * dy < 0.0012 * 0.0012) continue;
      pts.push(x, y);
    }
    pintarVivo();
  };

  const terminar = () => {
    const g = gesto.current;
    gesto.current = null;
    if (!g) return;
    if (g.tipo === "dibujar") {
      const vivo = refVivo.current;
      vivo.getContext("2d").clearRect(0, 0, vivo.width, vivo.height);
      const t = g.trazo;
      if (t.p.length === 2) t.p.push(t.p[0] + 0.0005, t.p[1]); // un toque = un punto
      const d = datosRef.current;
      aplicar(numero, { ...d, trazos: [...d.trazos, t] }, d);
    } else if (g.tipo === "borrar" && g.trazos !== g.antes.trazos) {
      aplicar(numero, { ...g.antes, trazos: g.trazos }, g.antes);
    }
  };

  const borrarEn = ([x, y]) => {
    const g = gesto.current;
    const r2 = RADIO_BORRADOR * RADIO_BORRADOR;
    const quedan = g.trazos.filter((t) => {
      const margen = r2 + (t.w / 2) ** 2;
      for (let i = 0; i < t.p.length; i += 2) {
        const dx = t.p[i] - x;
        const dy = t.p[i + 1] - y;
        if (dx * dx + dy * dy <= margen) return false;
      }
      return true;
    });
    if (quedan.length !== g.trazos.length) {
      g.trazos = quedan;
      // vista previa inmediata sin tocar todavía el historial
      const w = refTinta.current.width;
      const cs = refSub.current.getContext("2d");
      const ct = refTinta.current.getContext("2d");
      cs.clearRect(0, 0, w, refSub.current.height);
      ct.clearRect(0, 0, w, refTinta.current.height);
      for (const t of quedan) pintarTrazo(t.h === "sub" ? cs : ct, t, w);
    }
  };

  const pintarVivo = () => {
    const vivo = refVivo.current;
    const ctx = vivo.getContext("2d");
    ctx.clearRect(0, 0, vivo.width, vivo.height);
    pintarTrazo(ctx, gesto.current.trazo, vivo.width);
  };

  const cambiarTexto = (id, cambios) => {
    const d = datosRef.current;
    const textos = cambios
      ? d.textos.map((t) => (t.id === id ? { ...t, ...cambios } : t))
      : d.textos.filter((t) => t.id !== id);
    aplicar(numero, { ...d, textos }, d);
  };

  const cursor = {
    boli: "crosshair",
    subrayador: "crosshair",
    borrador: "cell",
    texto: "text",
    mano: "grab",
  }[pincel.herramienta];

  return (
    <div
      ref={refHoja}
      className={`hoja${cuaderno ? " cuaderno" : ""}`}
      style={{ width: ancho, height: alto, "--celda": `${ancho / 32}px` }}
      data-pagina={numero}
    >
      {!cuaderno && <canvas ref={refFondo} className="capa" />}
      <canvas ref={refSub} className="capa capa-sub" />
      <canvas ref={refTinta} className="capa" />
      <canvas
        ref={refVivo}
        className={`capa capa-vivo${pincel.herramienta === "subrayador" ? " capa-sub" : ""}`}
        style={{ cursor }}
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="capa capa-textos">
        {datos.textos.map((t) => (
          <NotaTexto
            key={t.id}
            nota={t}
            ancho={ancho}
            enfocar={enfocarTexto === t.id}
            alCambiar={(c) => cambiarTexto(t.id, c)}
            alBorrar={() => cambiarTexto(t.id, null)}
          />
        ))}
      </div>
    </div>
  );
}

function NotaTexto({ nota, ancho, enfocar, alCambiar, alBorrar }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && ref.current.innerText !== nota.t) ref.current.innerText = nota.t;
  }, [nota.t]);

  useEffect(() => {
    if (enfocar) ref.current?.focus();
  }, [enfocar]);

  const alSalir = () => {
    const t = ref.current.innerText.replace(/\n+$/, "");
    if (!t.trim()) return alBorrar();
    if (t !== nota.t) alCambiar({ t });
  };

  return (
    <div
      className="nota-texto"
      style={{
        left: nota.x * ancho,
        top: nota.y * ancho - nota.s * ancho * 0.7,
        fontSize: nota.s * ancho,
        color: nota.c,
        maxWidth: (1 - nota.x) * ancho - 8,
      }}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className="nota-editable"
        onBlur={alSalir}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Nota de texto"
      />
      <button
        className="nota-borrar"
        onPointerDown={(e) => e.preventDefault()}
        onClick={alBorrar}
        aria-label="Borrar nota"
      >
        ×
      </button>
    </div>
  );
}

/* ---------------- Dibujo ---------------- */

function pintarTrazo(ctx, t, anchoPx) {
  const p = t.p;
  if (p.length < 4) return;
  ctx.save();
  ctx.lineCap = t.h === "sub" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = t.c;
  ctx.lineWidth = t.w * anchoPx;
  if (t.h === "sub") ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(p[0] * anchoPx, p[1] * anchoPx);
  // curva suave pasando por los puntos medios
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = ((p[i] + p[i + 2]) / 2) * anchoPx;
    const my = ((p[i + 1] + p[i + 3]) / 2) * anchoPx;
    ctx.quadraticCurveTo(p[i] * anchoPx, p[i + 1] * anchoPx, mx, my);
  }
  ctx.lineTo(p[p.length - 2] * anchoPx, p[p.length - 1] * anchoPx);
  ctx.stroke();
  ctx.restore();
}

function IconoHerr({ id }) {
  const d = {
    boli: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
    subrayador: "M9 15l-3 3h5l1-1M9 15l7-7 3 3-7 7M9 15l3 3M4 21h16",
    borrador: "M8 20h12M5 14l8-8 6 6-8 8H9l-4-4v-2z",
    texto: "M5 6V4h14v2M12 4v16M9 20h6",
    mano: "M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L4 12.5a1.5 1.5 0 0 1 2.5-1.5L8 13",
    deshacer: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4",
    rehacer: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4",
  }[id];
  return (
    <svg className="icono" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
