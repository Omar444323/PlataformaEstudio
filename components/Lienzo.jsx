"use client";

import { useEffect, useRef, useState } from "react";

const COLORES = ["#12203a", "#b3261e", "#1f7a4d", "#1f4fd8", "#ffe066"];

export default function Lienzo() {
  const refLienzo = useRef(null);
  const dibujando = useRef(false);
  const [color, setColor] = useState(COLORES[0]);
  const [grosor, setGrosor] = useState(3);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    const lienzo = refLienzo.current;
    const ctx = lienzo.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const ancho = lienzo.parentElement.clientWidth;
    const alto = Math.max(420, Math.round(window.innerHeight * 0.55));

    lienzo.width = ancho * ratio;
    lienzo.height = alto * ratio;
    lienzo.style.width = `${ancho}px`;
    lienzo.style.height = `${alto}px`;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const guardado = localStorage.getItem("lienzo");
    if (guardado) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, ancho, alto);
      img.src = guardado;
    }
  }, []);

  const posicion = (e) => {
    const r = refLienzo.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const empezar = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const ctx = refLienzo.current.getContext("2d");
    const { x, y } = posicion(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const mover = (e) => {
    if (!dibujando.current) return;
    const ctx = refLienzo.current.getContext("2d");
    const { x, y } = posicion(e);
    ctx.strokeStyle = borrando ? "#ffffff" : color;
    ctx.lineWidth = borrando ? grosor * 6 : grosor;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const soltar = () => {
    if (!dibujando.current) return;
    dibujando.current = false;
    try {
      localStorage.setItem("lienzo", refLienzo.current.toDataURL("image/png"));
    } catch {
      // si el dibujo no cabe en el almacenamiento, simplemente no se guarda
    }
  };

  const limpiar = () => {
    if (!confirm("¿Borrar todo el lienzo?")) return;
    const lienzo = refLienzo.current;
    const ctx = lienzo.getContext("2d");
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    localStorage.removeItem("lienzo");
  };

  const descargar = () => {
    const enlace = document.createElement("a");
    enlace.download = `pizarra-${new Date().toISOString().slice(0, 10)}.png`;
    enlace.href = refLienzo.current.toDataURL("image/png");
    enlace.click();
  };

  return (
    <section className="panel">
      <div className="herramientas">
        {COLORES.map((c) => (
          <button
            key={c}
            className={`color${c === color && !borrando ? " activo" : ""}`}
            style={{ background: c }}
            onClick={() => {
              setColor(c);
              setBorrando(false);
            }}
            aria-label={`Color ${c}`}
          />
        ))}
        <button
          className={`boton secundario${borrando ? " pulsado" : ""}`}
          onClick={() => setBorrando(!borrando)}
        >
          Borrador
        </button>
        <label className="aviso">
          Grosor
          <input
            type="range"
            min="1"
            max="12"
            value={grosor}
            onChange={(e) => setGrosor(Number(e.target.value))}
          />
        </label>
        <button className="boton secundario" onClick={descargar}>
          Descargar PNG
        </button>
        <button className="boton secundario" onClick={limpiar}>
          Limpiar
        </button>
      </div>

      <canvas
        ref={refLienzo}
        className="lienzo"
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerLeave={soltar}
      />

      <p className="aviso">
        Se guarda en este navegador, no se comparte. Descarga el PNG si quieres conservarlo.
      </p>
    </section>
  );
}
