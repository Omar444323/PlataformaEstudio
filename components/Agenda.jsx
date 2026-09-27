"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const URL_FUNCION = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/eventos`;

function claveDia(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function etiquetaDia(iso) {
  const d = new Date(iso);
  const hoy = new Date();
  const manana = new Date();
  manana.setDate(hoy.getDate() + 1);

  if (claveDia(iso) === claveDia(hoy.toISOString())) return "Hoy";
  if (claveDia(iso) === claveDia(manana.toISOString())) return "Mañana";

  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

function hora(iso, diaCompleto) {
  if (diaCompleto) return "Todo el día";
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso)
  );
}

function cuantoFalta(iso) {
  const horas = (new Date(iso) - Date.now()) / 36e5;
  if (horas < 0) return { texto: "ya pasó", urgente: false };
  if (horas < 1) return { texto: "en menos de 1 h", urgente: true };
  if (horas < 24) return { texto: `en ${Math.round(horas)} h`, urgente: true };
  const dias = Math.round(horas / 24);
  return { texto: `en ${dias} ${dias === 1 ? "día" : "días"}`, urgente: dias <= 2 };
}

export default function Agenda({ fuente = "entregas", dias = 60 }) {
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sin sesión");

      const res = await fetch(`${URL_FUNCION}?fuente=${fuente}&dias=${dias}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "No se pudo cargar");
      setEventos(json.eventos);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [fuente, dias]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error)
    return (
      <div className="agenda">
        <p className="fallo">{error}</p>
        <button className="boton secundario" onClick={cargar}>
          Reintentar
        </button>
      </div>
    );

  if (!eventos) return <p className="aviso">Cargando…</p>;

  if (eventos.length === 0)
    return (
      <div className="agenda">
        <p className="aviso">
          Nada en los próximos {dias} días.{" "}
          <button className="boton-texto" onClick={cargar}>
            actualizar
          </button>
        </p>
      </div>
    );

  // Agrupar por día
  const grupos = [];
  for (const ev of eventos) {
    const clave = claveDia(ev.inicio);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.eventos.push(ev);
    else grupos.push({ clave, fecha: ev.inicio, eventos: [ev] });
  }

  return (
    <div className="agenda">
      <p className="agenda-cabecera">
        <span className="aviso">
          {eventos.length} {eventos.length === 1 ? "evento" : "eventos"} en {dias} días
        </span>
        <button className="boton secundario" onClick={cargar} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </p>

      {grupos.map((g) => (
        <section key={g.clave} className="dia">
          <h3>{etiquetaDia(g.fecha)}</h3>
          <ul>
            {g.eventos.map((ev) => {
              const falta = cuantoFalta(ev.inicio);
              return (
                <li key={ev.id} className={falta.urgente ? "evento urgente" : "evento"}>
                  <span className="hora">{hora(ev.inicio, ev.diaCompleto)}</span>
                  <span className="cuerpo">
                    <strong>{ev.titulo}</strong>
                    {ev.ubicacion && <span className="aviso"> · {ev.ubicacion}</span>}
                    <span className="falta">{falta.texto}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
