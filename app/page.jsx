"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, estaPermitido } from "../lib/supabaseClient";

const CAL_SYNC = process.env.NEXT_PUBLIC_CALENDAR_SYNC_ID;

function urlCalendario(id) {
  const u = new URL("https://calendar.google.com/calendar/embed");
  u.searchParams.set("src", id);
  u.searchParams.set("ctz", "Europe/Madrid");
  u.searchParams.set("mode", "AGENDA");
  u.searchParams.set("wkst", "2");
  u.searchParams.set("showTitle", "0");
  u.searchParams.set("showPrint", "0");
  u.searchParams.set("showCalendars", "0");
  return u.toString();
}

export default function Inicio() {
  const [sesion, setSesion] = useState(undefined); // undefined = cargando
  const [pestana, setPestana] = useState("sync");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const entrar = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });

  if (sesion === undefined) return null;

  if (!sesion) {
    return (
      <main className="marco portada">
        <h1>Apuntes y entregas</h1>
        <p>Las fechas de Blackboard y los apuntes de los dos, en un sitio.</p>
        <p>
          <button className="boton" onClick={entrar}>
            Entrar con Google
          </button>
        </p>
        <Pie />
      </main>
    );
  }

  const correo = sesion.user?.email ?? "";

  if (!estaPermitido(correo)) {
    return (
      <main className="marco portada">
        <h1>Esta cuenta no tiene acceso</h1>
        <p>Has entrado como {correo}. Prueba con la cuenta de siempre.</p>
        <p>
          <button className="boton secundario" onClick={() => supabase.auth.signOut()}>
            Cambiar de cuenta
          </button>
        </p>
      </main>
    );
  }

  return (
    <main className="marco">
      <header className="cabecera">
        <h1>Apuntes y entregas</h1>
        <span className="quien">
          {correo}{" "}
          <button className="pestana" onClick={() => supabase.auth.signOut()}>
            salir
          </button>
        </span>
      </header>

      <div className="pestanas" role="tablist">
        {[
          ["sync", "Clases Sync"],
          ["personal", "Personal"],
          ["estado", "Estado"],
        ].map(([id, nombre]) => (
          <button
            key={id}
            role="tab"
            aria-selected={pestana === id}
            className="pestana"
            onClick={() => setPestana(id)}
          >
            {nombre}
          </button>
        ))}
      </div>

      {pestana === "sync" && <CalendarioSync />}
      {pestana === "personal" && <CalendarioPersonal correo={correo} />}
      {pestana === "estado" && <Estado sesion={sesion} />}

      <Pie />
    </main>
  );
}

function CalendarioSync() {
  if (!CAL_SYNC) {
    return (
      <section className="panel">
        <p>Falta la variable NEXT_PUBLIC_CALENDAR_SYNC_ID en Vercel.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <iframe
        className="marco-calendario"
        src={urlCalendario(CAL_SYNC)}
        title="Calendario Clases Sync"
      />
      <p className="aviso">
        Copia de Blackboard que se actualiza sola cada 6 horas. No añadas eventos aquí: se borran
        en la siguiente sincronización.
      </p>
    </section>
  );
}

function CalendarioPersonal({ correo }) {
  const [otro, setOtro] = useState("");
  const [guardado, setGuardado] = useState(null); // null = aún sin leer localStorage

  useEffect(() => {
    const v = localStorage.getItem("calendarioPersonal") || "";
    setOtro(v);
    setGuardado(v);
  }, []);

  if (guardado === null) return <section className="panel"><p>Cargando…</p></section>;

  const idMostrado = guardado || correo;

  const guardar = () => {
    const v = otro.trim();
    localStorage.setItem("calendarioPersonal", v);
    setGuardado(v);
  };

  return (
    <section className="panel">
      <iframe
        className="marco-calendario"
        src={urlCalendario(idMostrado)}
        title="Calendario personal"
      />
      <p className="aviso">
        Tu calendario de Google ({idMostrado}). Solo se ve si en este navegador tienes la sesión
        de esa cuenta iniciada.
      </p>
      <details>
        <summary className="aviso">Mostrar otro calendario</summary>
        <p>
          <input
            className="entrada"
            value={otro}
            onChange={(e) => setOtro(e.target.value)}
            placeholder="ID de otro calendario (vacío = el tuyo)"
            aria-label="ID de otro calendario"
          />{" "}
          <button className="boton secundario" onClick={guardar}>
            Guardar
          </button>
        </p>
      </details>
    </section>
  );
}

function Estado({ sesion }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/estado", {
        headers: { Authorization: `Bearer ${sesion.access_token}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo leer el estado");
      setFilas(j.filas);
    } catch (e) {
      setError(e.message);
    }
  }, [sesion]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <section className="panel"><p className="fallo">{error}</p></section>;
  if (!filas) return <section className="panel"><p>Cargando…</p></section>;
  if (filas.length === 0)
    return (
      <section className="panel">
        <p>Todavía no hay sincronizaciones registradas.</p>
      </section>
    );

  const ultima = filas[0];
  const horas = (Date.now() - new Date(ultima.ran_at)) / 36e5;

  return (
    <section className="panel">
      <h2>
        {ultima.ok
          ? `Al día. Última sincronización hace ${horas < 1 ? "menos de una hora" : `${Math.round(horas)} h`}.`
          : "La última sincronización falló."}
      </h2>
      {horas > 12 && ultima.ok && (
        <p className="aviso">Hace más de 12 horas que no se sincroniza. Revisa el cron.</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Cuándo</th>
            <th>Entregas</th>
            <th>Nuevas</th>
            <th>Cambiadas</th>
            <th>Borradas</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>{new Date(f.ran_at).toLocaleString("es-ES")}</td>
              <td>{f.feed_count}</td>
              <td>{f.created}</td>
              <td>{f.updated}</td>
              <td>{f.deleted}</td>
              <td className={f.ok ? "ok" : "fallo"}>{f.ok ? "Correcta" : f.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <button className="boton secundario" onClick={cargar}>
          Actualizar
        </button>
      </p>
    </section>
  );
}

function Pie() {
  return (
    <footer className="pie">
      <a href="/privacidad">Privacidad</a>
      <a href="/terminos">Términos</a>
    </footer>
  );
}
