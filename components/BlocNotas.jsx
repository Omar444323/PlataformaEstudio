"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { MODULOS } from "../lib/horario";

// Bloc de notas de texto de una asignatura. Privado: cada uno ve solo el suyo.
export default function BlocNotas({ asignatura, correo }) {
  const [texto, setTexto] = useState(null);
  const [estado, setEstado] = useState("guardado");
  const [error, setError] = useState("");
  const pendiente = useRef(null);
  const temporizador = useRef(null);
  const clave = `blocPendiente:${asignatura}`;

  const guardar = useCallback(async () => {
    if (pendiente.current === null) return;
    const contenido = pendiente.current;
    pendiente.current = null;
    setEstado("guardando");
    const { error } = await supabase.from("notas_asignatura").upsert(
      { autor: correo, asignatura, contenido, editado_en: new Date().toISOString() },
      { onConflict: "autor,asignatura" }
    );
    if (error) {
      if (pendiente.current === null) pendiente.current = contenido;
      setEstado("error");
      setError(error.message);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(guardar, 5000);
      return;
    }
    setError("");
    if (pendiente.current === null) {
      try {
        localStorage.removeItem(clave);
      } catch {}
      setEstado("guardado");
    }
  }, [asignatura, correo, clave]);

  useEffect(() => {
    let cancelado = false;
    setTexto(null);
    (async () => {
      const { data, error } = await supabase
        .from("notas_asignatura")
        .select("contenido")
        .eq("asignatura", asignatura)
        .eq("autor", correo)
        .maybeSingle();
      if (cancelado) return;
      if (error) setError(error.message);
      let t = data?.contenido ?? "";
      // si quedó algo sin subir en este dispositivo, manda eso
      try {
        const local = localStorage.getItem(clave);
        if (local !== null && local !== t) {
          t = local;
          pendiente.current = local;
          guardar();
        }
      } catch {}
      setTexto(t);
    })();
    return () => {
      cancelado = true;
    };
  }, [asignatura, correo, clave, guardar]);

  useEffect(() => {
    const alOcultar = () => document.visibilityState === "hidden" && guardar();
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      document.removeEventListener("visibilitychange", alOcultar);
      clearTimeout(temporizador.current);
      guardar();
    };
  }, [guardar]);

  const escribir = (v) => {
    setTexto(v);
    pendiente.current = v;
    try {
      localStorage.setItem(clave, v);
    } catch {}
    setEstado("pendiente");
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(guardar, 800);
  };

  const m = MODULOS[asignatura];

  return (
    <section className="bloc" style={{ "--modulo": m?.color || "var(--linea)" }}>
      <header className="bloc-cabecera">
        <span>
          Bloc de notas · <strong>{m?.corto || m?.nombre || "Sin carpeta"}</strong>
        </span>
        <span className="aviso">
          {error
            ? "Sin conexión, reintentando"
            : { guardado: "Guardado · solo lo ves tú", pendiente: "Sin guardar…", guardando: "Guardando…", error: "Reintentando…" }[estado]}
        </span>
      </header>
      {texto === null ? (
        <p className="aviso bloc-cargando">Cargando…</p>
      ) : (
        <textarea
          className="bloc-texto"
          value={texto}
          onChange={(e) => escribir(e.target.value)}
          placeholder="Apuntes rápidos, dudas para el profe, fechas…"
          aria-label={`Bloc de notas de ${m?.nombre || asignatura}`}
          spellCheck
        />
      )}
    </section>
  );
}
