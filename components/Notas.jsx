"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Notas({ correo }) {
  const [notas, setNotas] = useState(null);
  const [activa, setActiva] = useState(null);
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");
  const temporizador = useRef(null);

  const cargar = useCallback(async (seleccionar) => {
    const { data, error } = await supabase
      .from("notas")
      .select("id, titulo, contenido, autor, editada_en")
      .order("editada_en", { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }
    setError("");
    setNotas(data);

    const elegida = seleccionar
      ? data.find((n) => n.id === seleccionar)
      : data[0];
    if (elegida) {
      setActiva(elegida.id);
      setTitulo(elegida.titulo);
      setContenido(elegida.contenido);
    } else {
      setActiva(null);
      setTitulo("");
      setContenido("");
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrir = (nota) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    setActiva(nota.id);
    setTitulo(nota.titulo);
    setContenido(nota.contenido);
    setEstado("");
  };

  const guardar = useCallback(
    async (id, t, c) => {
      setEstado("Guardando…");
      const { error } = await supabase
        .from("notas")
        .update({ titulo: t || "Sin título", contenido: c, editada_en: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        setEstado("");
        setError(error.message);
        return;
      }
      setEstado("Guardado");
      setNotas((ns) =>
        ns.map((n) => (n.id === id ? { ...n, titulo: t || "Sin título", contenido: c } : n))
      );
    },
    []
  );

  // guardado automático 1,2 s después de dejar de escribir
  const alEscribir = (t, c) => {
    setTitulo(t);
    setContenido(c);
    setEstado("Sin guardar");
    if (!activa) return;
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => guardar(activa, t, c), 1200);
  };

  const nueva = async () => {
    const { data, error } = await supabase
      .from("notas")
      .insert({ titulo: "Sin título", contenido: "", autor: correo })
      .select()
      .single();

    if (error) {
      setError(error.message);
      return;
    }
    setNotas((ns) => [data, ...(ns ?? [])]);
    abrir(data);
  };

  const borrar = async () => {
    if (!activa) return;
    if (!confirm("¿Borrar esta nota? No se puede deshacer.")) return;
    const { error } = await supabase.from("notas").delete().eq("id", activa);
    if (error) {
      setError(error.message);
      return;
    }
    cargar();
  };

  if (error)
    return (
      <section className="panel">
        <p className="fallo">{error}</p>
        <p className="aviso">
          Si el error habla de permisos, falta ejecutar notas.sql o tu correo no está en
          usuarios_permitidos.
        </p>
      </section>
    );

  if (!notas) return <section className="panel"><p>Cargando…</p></section>;

  return (
    <section className="panel notas">
      <aside className="lista-notas">
        <button className="boton" onClick={nueva}>
          Nota nueva
        </button>
        {notas.length === 0 && <p className="aviso">Todavía no hay notas.</p>}
        <ul>
          {notas.map((n) => (
            <li key={n.id}>
              <button
                className={`item-nota${n.id === activa ? " activa" : ""}`}
                onClick={() => abrir(n)}
              >
                <strong>{n.titulo || "Sin título"}</strong>
                <span className="aviso">
                  {n.autor === correo ? "tuya" : n.autor?.split("@")[0]} ·{" "}
                  {new Date(n.editada_en).toLocaleDateString("es-ES")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="editor">
        {activa ? (
          <>
            <input
              className="entrada titulo-nota"
              value={titulo}
              onChange={(e) => alEscribir(e.target.value, contenido)}
              placeholder="Título"
              aria-label="Título de la nota"
            />
            <textarea
              className="entrada cuerpo-nota"
              value={contenido}
              onChange={(e) => alEscribir(titulo, e.target.value)}
              placeholder="Escribe aquí…"
              aria-label="Contenido de la nota"
            />
            <p className="aviso pie-editor">
              <span>{estado}</span>
              <button className="boton secundario" onClick={borrar}>
                Borrar nota
              </button>
            </p>
          </>
        ) : (
          <p className="aviso">Crea una nota para empezar.</p>
        )}
      </div>
    </section>
  );
}
