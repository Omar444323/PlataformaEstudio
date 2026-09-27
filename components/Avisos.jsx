"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const CLAVE_PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function base64ABytes(base64) {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(normal);
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)));
}

function bytesABase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export default function Avisos() {
  const [estado, setEstado] = useState("comprobando");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setEstado("no-soportado");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEstado(sub ? "activado" : "desactivado"))
      .catch(() => setEstado("no-soportado"));
  }, []);

  const activar = async () => {
    setMensaje("");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setMensaje("Has denegado el permiso. Cámbialo en los ajustes del navegador.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ABytes(CLAVE_PUBLICA),
      });

      const json = sub.toJSON();
      const { error } = await supabase.from("push_subs").upsert({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      });

      if (error) throw new Error(error.message);
      setEstado("activado");
      setMensaje("Listo. Recibirás un aviso cada mañana si hay entregas cerca.");
    } catch (e) {
      setMensaje(e.message || "No se pudo activar.");
    }
  };

  const desactivar = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subs").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    setEstado("desactivado");
    setMensaje("Avisos desactivados en este dispositivo.");
  };

  const instalada =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone);
  const esIOS =
    typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="avisos">
      <h2>Avisos de entregas</h2>

      {estado === "no-soportado" && (
        <p className="aviso">Este navegador no admite notificaciones.</p>
      )}

      {esIOS && !instalada && (
        <p className="aviso">
          En iPhone hay que añadir la web a la pantalla de inicio desde Safari antes de poder
          activar los avisos.
        </p>
      )}

      {estado === "desactivado" && (
        <p>
          <button className="boton" onClick={activar}>
            Activar avisos en este dispositivo
          </button>
        </p>
      )}

      {estado === "activado" && (
        <p>
          <button className="boton secundario" onClick={desactivar}>
            Desactivar avisos aquí
          </button>
        </p>
      )}

      {mensaje && <p className="aviso">{mensaje}</p>}

      <p className="aviso">
        Cada mañana a las 8:00, si hay entregas en las próximas 48 horas. Hay que activarlo en
        cada dispositivo por separado.
      </p>
    </div>
  );
}
