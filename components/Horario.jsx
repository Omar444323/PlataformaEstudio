"use client";

import { useEffect, useState } from "react";
import { AULA, DIAS, FRANJAS, aMinutos, clasesDelDia, momento } from "../lib/horario";

function useAhora() {
  const [ahora, setAhora] = useState(null); // null hasta montar: evita desajustes de hora en el render del servidor
  useEffect(() => {
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

export default function Horario() {
  const ahora = useAhora();
  const [dia, setDia] = useState(null);
  const [vista, setVista] = useState("dia");

  useEffect(() => {
    if (!ahora || dia !== null) return;
    const d = ahora.getDay();
    setDia(d >= 1 && d <= 5 ? d : 1); // fin de semana: enseña el lunes
    try {
      const v = localStorage.getItem("horarioVista");
      if (v === "dia" || v === "semana") setVista(v);
    } catch {}
  }, [ahora, dia]);

  if (!ahora || dia === null) return <section className="panel"><p>Cargando…</p></section>;

  const cambiarVista = (v) => {
    setVista(v);
    try {
      localStorage.setItem("horarioVista", v);
    } catch {}
  };

  const hoy = ahora.getDay();

  return (
    <section className="panel horario">
      <div className="horario-controles">
        <div className="selector" role="group" aria-label="Vista del horario">
          {[
            ["dia", "Día"],
            ["semana", "Semana"],
          ].map(([id, texto]) => (
            <button key={id} aria-pressed={vista === id} onClick={() => cambiarVista(id)}>
              {texto}
            </button>
          ))}
        </div>

        {vista === "dia" && (
          <div className="selector dias" role="group" aria-label="Día de la semana">
            {DIAS.map((nombre, i) => (
              <button
                key={nombre}
                aria-pressed={dia === i + 1}
                onClick={() => setDia(i + 1)}
                className={hoy === i + 1 ? "es-hoy" : undefined}
              >
                <span className="dia-largo">{nombre}</span>
                <span className="dia-corto">{nombre.slice(0, 3)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {vista === "dia" && (hoy === 0 || hoy === 6) && dia === 1 && (
        <p className="aviso resumen-dia">Es fin de semana. Esto es lo que tienes el lunes.</p>
      )}

      {vista === "dia" ? (
        <VistaDia dia={dia} ahora={ahora} esHoy={dia === hoy} />
      ) : (
        <VistaSemana ahora={ahora} />
      )}

      <p className="aviso nota-al-pie">2º GAD · {AULA} · de 15:00 a 21:00 con recreo de 17:45 a 18:15.</p>
    </section>
  );
}

function VistaDia({ dia, ahora, esHoy }) {
  const clases = clasesDelDia(dia);
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const { siguiente } = momento(ahora);
  const recreo = FRANJAS[3];
  const finDelDia = clases.length ? aMinutos(clases[clases.length - 1].fin) : 0;

  // Intercala el recreo en su sitio.
  const filas = [];
  clases.forEach((c) => {
    if (c.franja > 3 && !filas.some((f) => f.recreo)) filas.push({ recreo: true });
    filas.push(c);
  });

  return (
    <>
      {esHoy && min >= finDelDia && (
        <p className="aviso resumen-dia">Por hoy ya has terminado las clases.</p>
      )}
      <ol className="linea-dia">
        {filas.map((c, i) => {
          if (c.recreo) {
            const enCurso = esHoy && min >= aMinutos(recreo.inicio) && min < aMinutos(recreo.fin);
            return (
              <li key="recreo" className={`fila-recreo${enCurso ? " en-curso" : ""}`}>
                <span className="hora">{recreo.inicio}</span>
                <span>Recreo · 30 min{enCurso ? " · ahora" : ""}</span>
              </li>
            );
          }
          const ini = aMinutos(c.inicio);
          const fin = aMinutos(c.fin);
          const enCurso = esHoy && min >= ini && min < fin;
          const pasada = esHoy && min >= fin;
          const esSiguiente = esHoy && !enCurso && siguiente && siguiente.franja === c.franja;
          const progreso = enCurso ? (min - ini) / (fin - ini) : 0;
          return (
            <li
              key={i}
              className={`clase${enCurso ? " en-curso" : ""}${pasada ? " pasada" : ""}`}
              style={{ "--modulo": c.color }}
            >
              <span className="hora">
                {c.inicio}
                <small>{c.fin}</small>
              </span>
              <div className="clase-cuerpo">
                <p className="clase-etiquetas">
                  <span className="codigo">{c.modulo}</span>
                  {c.dura > 1 && <span className="etiqueta">{c.dura} horas seguidas</span>}
                  {enCurso && <span className="etiqueta ahora">Ahora · quedan {fin - min} min</span>}
                  {esSiguiente && (
                    <span className="etiqueta">Siguiente · en {ini - min} min</span>
                  )}
                </p>
                <h3>{c.nombre}</h3>
                <p className="aviso">{c.profe}</p>
                {enCurso && (
                  <span className="barra-clase" aria-hidden="true">
                    <span style={{ width: `${progreso * 100}%` }} />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function VistaSemana({ ahora }) {
  const hoy = ahora.getDay();
  const min = ahora.getHours() * 60 + ahora.getMinutes();

  return (
    <div className="tabla-scroll">
      <div className="rejilla-semana" role="table" aria-label="Horario semanal">
        <div className="celda-vacia" />
        {DIAS.map((d, i) => (
          <div
            key={d}
            className={`cabecera-dia${hoy === i + 1 ? " es-hoy" : ""}`}
            style={{ gridColumn: i + 2 }}
            role="columnheader"
          >
            {d}
          </div>
        ))}

        {FRANJAS.map((f, fi) => (
          <div key={f.inicio} className="celda-hora" style={{ gridRow: fi + 2 }}>
            {f.inicio}
          </div>
        ))}

        <div className="celda-recreo" style={{ gridRow: 5, gridColumn: "2 / 7" }}>
          recreo
        </div>

        {[1, 2, 3, 4, 5].flatMap((dia) =>
          clasesDelDia(dia).map((c) => {
            const enCurso =
              dia === hoy && min >= aMinutos(c.inicio) && min < aMinutos(c.fin);
            return (
              <div
                key={`${dia}-${c.franja}`}
                className={`bloque-clase${enCurso ? " en-curso" : ""}`}
                style={{
                  "--modulo": c.color,
                  gridColumn: dia + 1,
                  gridRow: `${c.franja + 2} / span ${c.dura}`,
                }}
                title={`${c.nombre} · ${c.profe} · ${c.inicio}–${c.fin}`}
              >
                <strong>{c.corto || c.nombre}</strong>
                <span>{c.profe.split(" ").slice(0, 2).join(" ")}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
