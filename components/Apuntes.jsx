"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { abrirPdf } from "../lib/pdf";
import { MODULOS } from "../lib/horario";
import VisorApuntes from "./VisorApuntes";

const MAX_MB = 50;

function idEnUrl() {
  const partes = window.location.hash.slice(1).split("/");
  return partes[0] === "apuntes" ? partes[1] || null : null;
}

export default function Apuntes({ correo }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [abierto, setAbierto] = useState(null);
  const [subiendo, setSubiendo] = useState("");
  const [creando, setCreando] = useState(false);
  const refArchivo = useRef(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from("documentos")
      .select("*")
      .order("editado_en", { ascending: false });
    if (error) {
      setError(
        error.message.includes("does not exist") || error.code === "42P01"
          ? "Falta crear las tablas: ejecuta supabase/apuntes.sql en Supabase."
          : error.message
      );
      return;
    }
    setError("");
    setDocs(data);
    const id = idEnUrl();
    if (id) setAbierto(data.find((d) => d.id === id) || null);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrir = (d) => {
    setAbierto(d);
    history.replaceState(null, "", `#apuntes/${d.id}`);
  };

  const cerrar = () => {
    setAbierto(null);
    history.replaceState(null, "", "#apuntes");
    cargar();
  };

  const subir = async (lista) => {
    const archivos = [...lista];
    for (const [i, archivo] of archivos.entries()) {
      const prefijo = archivos.length > 1 ? `(${i + 1}/${archivos.length}) ` : "";
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
        const bytes = await archivo.arrayBuffer();
        const documento = await abrirPdf(bytes.slice(0));
        const paginas = documento.numPages;
        documento.destroy();

        setSubiendo(`${prefijo}Subiendo ${archivo.name}…`);
        const ruta = `${crypto.randomUUID()}.pdf`;
        const { error: e1 } = await supabase.storage
          .from("apuntes")
          .upload(ruta, archivo, { contentType: "application/pdf" });
        if (e1) throw e1;

        const { error: e2 } = await supabase.from("documentos").insert({
          titulo: archivo.name.replace(/\.pdf$/i, ""),
          tipo: "pdf",
          ruta,
          paginas,
          asignatura: filtro !== "todas" ? filtro : null,
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
    cargar();
  };

  const crearCuaderno = async (titulo, asignatura) => {
    const { data, error } = await supabase
      .from("documentos")
      .insert({ titulo, tipo: "cuaderno", paginas: 1, asignatura, subido_por: correo })
      .select()
      .single();
    if (error) return setError(error.message);
    setCreando(false);
    await cargar();
    abrir(data);
  };

  const borrar = async (d) => {
    if (!confirm(`¿Borrar "${d.titulo}"? Se borran también las anotaciones de los dos.`)) return;
    if (d.ruta) await supabase.storage.from("apuntes").remove([d.ruta]);
    const { error } = await supabase.from("documentos").delete().eq("id", d.id);
    if (error) setError(error.message);
    cargar();
  };

  const cambiarAsignatura = async (d, asignatura) => {
    const { error } = await supabase
      .from("documentos")
      .update({ asignatura: asignatura || null })
      .eq("id", d.id);
    if (error) return setError(error.message);
    setDocs((ds) => ds.map((x) => (x.id === d.id ? { ...x, asignatura: asignatura || null } : x)));
  };

  if (abierto) {
    return (
      <VisorApuntes
        doc={abierto}
        correo={correo}
        alCerrar={cerrar}
        alActualizarDoc={(d) => {
          setAbierto(d);
          setDocs((ds) => ds?.map((x) => (x.id === d.id ? d : x)));
        }}
      />
    );
  }

  const visibles = (docs || []).filter((d) => filtro === "todas" || d.asignatura === filtro);
  const usadas = new Set((docs || []).map((d) => d.asignatura).filter(Boolean));

  return (
    <section className="apuntes">
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

      {creando && <FormCuaderno alCrear={crearCuaderno} alCancelar={() => setCreando(false)} filtro={filtro} />}

      {error && (
        <p className="fallo aviso-error">
          {error}{" "}
          <button className="boton-texto" onClick={() => setError("")}>
            Cerrar
          </button>
        </p>
      )}

      <div className="filtros" role="group" aria-label="Filtrar por asignatura">
        <button aria-pressed={filtro === "todas"} onClick={() => setFiltro("todas")}>
          Todas
        </button>
        {Object.entries(MODULOS).map(([codigo, m]) => (
          <button
            key={codigo}
            aria-pressed={filtro === codigo}
            onClick={() => setFiltro(codigo)}
            style={{ "--modulo": m.color }}
            className={usadas.has(codigo) ? "con-docs" : undefined}
            title={m.nombre}
          >
            {m.corto || m.nombre}
          </button>
        ))}
      </div>

      {!docs && !error && <p className="aviso">Cargando…</p>}

      {docs && visibles.length === 0 && (
        <div className="vacio-apuntes">
          <p>
            {filtro === "todas"
              ? "Todavía no hay apuntes. Sube un PDF o crea un cuaderno en blanco."
              : `No hay nada de ${MODULOS[filtro]?.corto || MODULOS[filtro]?.nombre}. Lo que subas ahora se guarda en esta asignatura.`}
          </p>
        </div>
      )}

      <ul className="rejilla-docs">
        {visibles.map((d) => {
          const m = MODULOS[d.asignatura];
          return (
            <li key={d.id} className="tarjeta-doc" style={{ "--modulo": m?.color || "var(--linea)" }}>
              <button className="tarjeta-abrir" onClick={() => abrir(d)}>
                <span className={`miniatura ${d.tipo}`} aria-hidden="true">
                  <span className="miniatura-tipo">{d.tipo === "pdf" ? "PDF" : "Cuaderno"}</span>
                </span>
                <span className="tarjeta-titulo">{d.titulo}</span>
                <span className="tarjeta-meta">
                  {d.paginas} {d.paginas === 1 ? "página" : "páginas"} ·{" "}
                  {d.subido_por === correo ? "tuyo" : d.subido_por?.split("@")[0]} ·{" "}
                  {new Date(d.editado_en).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                </span>
              </button>
              <div className="tarjeta-pie">
                <select
                  className="selector-asignatura"
                  value={d.asignatura || ""}
                  onChange={(e) => cambiarAsignatura(d, e.target.value)}
                  aria-label="Asignatura"
                >
                  <option value="">Sin asignatura</option>
                  {Object.entries(MODULOS).map(([codigo, mm]) => (
                    <option key={codigo} value={codigo}>
                      {codigo} · {mm.corto || mm.nombre}
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
          );
        })}
      </ul>
    </section>
  );
}

function FormCuaderno({ alCrear, alCancelar, filtro }) {
  const [titulo, setTitulo] = useState("");
  const [asignatura, setAsignatura] = useState(filtro !== "todas" ? filtro : "");
  return (
    <form
      className="form-cuaderno"
      onSubmit={(e) => {
        e.preventDefault();
        alCrear(titulo.trim() || "Cuaderno sin título", asignatura || null);
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
      <select className="entrada" value={asignatura} onChange={(e) => setAsignatura(e.target.value)} aria-label="Asignatura">
        <option value="">Sin asignatura</option>
        {Object.entries(MODULOS).map(([codigo, m]) => (
          <option key={codigo} value={codigo}>
            {codigo} · {m.corto || m.nombre}
          </option>
        ))}
      </select>
      <button className="boton" type="submit">
        Crear y abrir
      </button>
      <button className="boton-texto" type="button" onClick={alCancelar}>
        Cancelar
      </button>
    </form>
  );
}
