"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POR_DEFECTO = { trabajo: 25, corto: 5, largo: 15, cadaCuantos: 4 };

function pitido() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.frequency.value = 660;
    vol.gain.setValueAtTime(0.0001, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.start();
    osc.stop(ctx.currentTime + 0.95);
  } catch {
    // si el navegador no deja sonar, no pasa nada
  }
}

function formato(segundos) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Pomodoro() {
  const [ajustes, setAjustes] = useState(POR_DEFECTO);
  const [fase, setFase] = useState("trabajo"); // trabajo | corto | largo
  const [restante, setRestante] = useState(POR_DEFECTO.trabajo * 60);
  const [corriendo, setCorriendo] = useState(false);
  const [completados, setCompletados] = useState(0);
  const finRef = useRef(null);

  useEffect(() => {
    const guardado = localStorage.getItem("pomodoroAjustes");
    if (guardado) {
      try {
        const a = { ...POR_DEFECTO, ...JSON.parse(guardado) };
        setAjustes(a);
        setRestante(a.trabajo * 60);
      } catch {
        // ajustes corruptos: se usan los de por defecto
      }
    }
  }, []);

  const duracion = useCallback((f, a = ajustes) => a[f] * 60, [ajustes]);

  const siguienteFase = useCallback(() => {
    pitido();
    if (fase === "trabajo") {
      const hechos = completados + 1;
      setCompletados(hechos);
      const toca = hechos % ajustes.cadaCuantos === 0 ? "largo" : "corto";
      setFase(toca);
      setRestante(duracion(toca));
    } else {
      setFase("trabajo");
      setRestante(duracion("trabajo"));
    }
    setCorriendo(false);
    finRef.current = null;
  }, [fase, completados, ajustes.cadaCuantos, duracion]);

  useEffect(() => {
    if (!corriendo) return;
    // se guarda la hora de fin para que no se desvíe si la pestaña queda en segundo plano
    if (!finRef.current) finRef.current = Date.now() + restante * 1000;

    const id = setInterval(() => {
      const quedan = Math.max(0, Math.round((finRef.current - Date.now()) / 1000));
      setRestante(quedan);
      if (quedan === 0) siguienteFase();
    }, 250);

    return () => clearInterval(id);
  }, [corriendo, restante, siguienteFase]);

  useEffect(() => {
    const nombre = { trabajo: "Trabajo", corto: "Descanso", largo: "Descanso largo" }[fase];
    document.title = corriendo ? `${formato(restante)} · ${nombre}` : "Apuntes y entregas";
  }, [restante, corriendo, fase]);

  const alternar = () => {
    if (corriendo) {
      finRef.current = null;
      setCorriendo(false);
    } else {
      finRef.current = Date.now() + restante * 1000;
      setCorriendo(true);
    }
  };

  const reiniciar = () => {
    finRef.current = null;
    setCorriendo(false);
    setRestante(duracion(fase));
  };

  const cambiarAjuste = (clave, valor) => {
    const n = Math.max(1, Math.min(180, Number(valor) || 1));
    const nuevos = { ...ajustes, [clave]: n };
    setAjustes(nuevos);
    localStorage.setItem("pomodoroAjustes", JSON.stringify(nuevos));
    if (!corriendo && clave === fase) setRestante(n * 60);
  };

  const total = duracion(fase);
  const progreso = total > 0 ? 1 - restante / total : 0;

  return (
    <section className="panel pomodoro">
      <p className="fase">
        {{ trabajo: "A trabajar", corto: "Descanso", largo: "Descanso largo" }[fase]}
      </p>

      <p className="reloj" aria-live="polite">{formato(restante)}</p>

      <div className="barra" role="presentation">
        <span style={{ width: `${progreso * 100}%` }} />
      </div>

      <p className="acciones">
        <button className="boton" onClick={alternar}>
          {corriendo ? "Pausar" : "Empezar"}
        </button>{" "}
        <button className="boton secundario" onClick={reiniciar}>
          Reiniciar
        </button>{" "}
        <button className="boton secundario" onClick={siguienteFase}>
          Saltar
        </button>
      </p>

      <p className="aviso">
        Pomodoros completados hoy: <strong>{completados}</strong>. El descanso largo llega cada{" "}
        {ajustes.cadaCuantos}.
      </p>

      <details>
        <summary className="aviso">Ajustar duraciones</summary>
        <p className="ajustes">
          <label>
            Trabajo
            <input
              type="number"
              className="entrada corta"
              value={ajustes.trabajo}
              onChange={(e) => cambiarAjuste("trabajo", e.target.value)}
            />
          </label>
          <label>
            Descanso
            <input
              type="number"
              className="entrada corta"
              value={ajustes.corto}
              onChange={(e) => cambiarAjuste("corto", e.target.value)}
            />
          </label>
          <label>
            Descanso largo
            <input
              type="number"
              className="entrada corta"
              value={ajustes.largo}
              onChange={(e) => cambiarAjuste("largo", e.target.value)}
            />
          </label>
        </p>
      </details>
    </section>
  );
}
