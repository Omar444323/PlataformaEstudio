"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, estaPermitido } from "../lib/supabaseClient";
import Pomodoro from "../components/Pomodoro";
import Notas from "../components/Notas";
import Lienzo from "../components/Lienzo";

const CAL_SYNC = process.env.NEXT_PUBLIC_CALENDAR_SYNC_ID;

function urlCalendario(id, modo = "AGENDA") {
  const u = new URL("https://calendar.google.com/calendar/embed");
  u.searchParams.set("src", id);
  u.searchParams.set("ctz", "Europe/Madrid");
  u.searchParams.set("mode", modo);
  u.searchParams.set("wkst", "2");
  u.searchParams.set("showTitle", "0");
  u.searchParams.set("showPrint", "0");
  u.searchParams.set("showCalendars", "0");
  u.searchParams.set("showTabs", "0");
  return u.toString();
}

// Iconos propios, trazo fino, heredan el color del texto.
const I = {
  inicio: "M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z",
  sync: "M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M8 13h3M8 16h6",
  personal: "M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M12 12.5a1.8 1.8 0 1 0 0 .01M9 17.5c.6-1.4 1.7-2 3-2s2.4.6 3 2",
  notas: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 16.5h6",
  pomodoro: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2.5h4",
  lienzo: "M4 20c3 0 4-1.5 4-3.5S9.5 13 11 13s3 1 3 3M14.5 12.5 20 5l-1-1-7.5 5.5",
  estado: "M3 12h4l2.5-6 5 12 2.5-6h4",
  menu: "M4 7h16M4 12h16M4 17h16",
};

function Icono({ d }) {
  return (
    <svg className="icono" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const SECCIONES = [
  { grupo: null, items: [["inicio", "Inicio"]] },
  { grupo: "Calendario", items: [["sync", "Clases"], ["personal", "Personal"]] },
  { grupo: "Estudio", items: [["notas", "Notas"], ["pomodoro", "Pomodoro"], ["lienzo", "Lienzo"]] },
  { grupo: "Mantenimiento", items: [["estado", "Sincronización"]] },
];

const PAGINAS = {
  inicio: { titulo: "Hoy", entradilla: null },
  sync: {
    titulo: "Clases",
    entradilla: "Copia de Blackboard. Se actualiza sola cada 6 horas.",
  },
  personal: { titulo: "Personal", entradilla: "Tu calendario de Google, solo lo ves tú." },
  notas: { titulo: "Notas", entradilla: "Compartidas entre los dos. Se guardan solas." },
  pomodoro: { titulo: "Pomodoro", entradilla: null },
  lienzo: { titulo: "Lienzo", entradilla: "Pizarra rápida. Se queda en este navegador." },
  estado: {
    titulo: "Sincronización",
    entradilla: "Las últimas pasadas del sincronizador de Blackboard.",
  },
};

const VALIDAS = Object.keys(PAGINAS);

export default function Inicio() {
  const [sesion, setSesion] = useState(undefined); // undefined = cargando
  const [pestana, setPestana] = useState("inicio");
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // La sección va en la URL (#notas) para que recargar o guardar el enlace lleve al mismo sitio.
  useEffect(() => {
    const leer = () => {
      const h = window.location.hash.slice(1);
      if (VALIDAS.includes(h)) setPestana(h);
    };
    leer();
    window.addEventListener("hashchange", leer);
    return () => window.removeEventListener("hashchange", leer);
  }, []);

  const ir = (id) => {
    setPestana(id);
    setMenuAbierto(false);
    history.replaceState(null, "", `#${id}`);
  };

  const entrar = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });

  if (sesion === undefined) return null;

  if (!sesion) {
    return (
      <main className="portada">
        <div className="tarjeta-portada">
          <p className="marca-portada">
            <span className="marca-cuadro" aria-hidden="true" />
            Apuntes y entregas
          </p>
          <h1>
            Las fechas de Blackboard y los apuntes de los dos, <mark>en un sitio</mark>.
          </h1>
          <button className="boton boton-google" onClick={entrar}>
            Entrar con Google
          </button>
          <p className="aviso">Solo pueden entrar las dos cuentas autorizadas.</p>
        </div>
        <Pie />
      </main>
    );
  }

  const correo = sesion.user?.email ?? "";

  if (!estaPermitido(correo)) {
    return (
      <main className="portada">
        <div className="tarjeta-portada">
          <h1>Esta cuenta no tiene acceso</h1>
          <p className="aviso">
            Has entrado como {correo}. Sal y vuelve a entrar con una de las dos cuentas
            autorizadas.
          </p>
          <button className="boton secundario" onClick={() => supabase.auth.signOut()}>
            Cambiar de cuenta
          </button>
        </div>
      </main>
    );
  }

  const nombre = sesion.user?.user_metadata?.full_name?.split(" ")[0] || correo.split("@")[0];
  const pagina = PAGINAS[pestana];

  return (
    <div className={`app${menuAbierto ? " menu-abierto" : ""}`}>
      <aside className="lateral" aria-label="Secciones">
        <div className="lateral-cabecera">
          <span className="marca-cuadro" aria-hidden="true" />
          <span className="lateral-titulo">Apuntes y entregas</span>
        </div>

        <nav>
          {SECCIONES.map(({ grupo, items }) => (
            <div className="grupo" key={grupo ?? "raiz"}>
              {grupo && <p className="grupo-nombre">{grupo}</p>}
              <ul>
                {items.map(([id, texto]) => (
                  <li key={id}>
                    <button
                      className="enlace-lateral"
                      aria-current={pestana === id ? "page" : undefined}
                      onClick={() => ir(id)}
                    >
                      <Icono d={I[id]} />
                      <span>{texto}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="lateral-pie">
          <span className="avatar" aria-hidden="true">
            {nombre.charAt(0).toUpperCase()}
          </span>
          <span className="lateral-correo" title={correo}>
            {correo}
          </span>
          <button className="boton-texto" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </aside>

      <button
        className="velo"
        aria-label="Cerrar menú"
        tabIndex={menuAbierto ? 0 : -1}
        onClick={() => setMenuAbierto(false)}
      />

      <div className="principal">
        <header className="barra-superior">
          <button
            className="boton-menu"
            aria-label="Abrir menú"
            aria-expanded={menuAbierto}
            onClick={() => setMenuAbierto(true)}
          >
            <Icono d={I.menu} />
          </button>
          <span className="miga">
            {SECCIONES.find((s) => s.items.some(([id]) => id === pestana))?.grupo ?? "Inicio"}
            {pestana !== "inicio" && (
              <>
                <span className="miga-sep">/</span>
                <strong>{pagina.titulo}</strong>
              </>
            )}
          </span>
        </header>

        <main className={`pagina pagina-${pestana}`}>
          <header className="pagina-cabecera">
            <h1>{pestana === "inicio" ? `Hola, ${nombre}` : pagina.titulo}</h1>
            {pestana === "inicio" ? (
              <p className="entradilla">{hoyLargo()}</p>
            ) : (
              pagina.entradilla && <p className="entradilla">{pagina.entradilla}</p>
            )}
          </header>

          {pestana === "inicio" && <Resumen sesion={sesion} correo={correo} ir={ir} />}
          {pestana === "sync" && <CalendarioSync />}
          {pestana === "personal" && <CalendarioPersonal correo={correo} />}
          {pestana === "notas" && <Notas correo={correo} />}
          {pestana === "pomodoro" && <Pomodoro />}
          {pestana === "lienzo" && <Lienzo />}
          {pestana === "estado" && <Estado sesion={sesion} />}

          <Pie />
        </main>
      </div>
    </div>
  );
}

function hoyLargo() {
  const t = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function haceCuanto(fecha) {
  const horas = (Date.now() - new Date(fecha)) / 36e5;
  if (horas < 1) return "hace menos de una hora";
  if (horas < 24) return `hace ${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

/* ---------- Inicio: agenda + notas recientes + estado ---------- */

function Resumen({ sesion, correo, ir }) {
  const [notas, setNotas] = useState(null);
  const [sync, setSync] = useState(null);

  useEffect(() => {
    supabase
      .from("notas")
      .select("id, titulo, autor, editada_en")
      .order("editada_en", { ascending: false })
      .limit(5)
      .then(({ data }) => setNotas(data ?? []));

    fetch("/api/estado", { headers: { Authorization: `Bearer ${sesion.access_token}` } })
      .then((r) => (r.ok ? r.json() : { filas: [] }))
      .then((j) => setSync(j.filas?.[0] ?? false))
      .catch(() => setSync(false));
  }, [sesion]);

  const syncMal = sync && (!sync.ok || (Date.now() - new Date(sync.ran_at)) / 36e5 > 12);

  return (
    <div className="resumen">
      <section className="bloque bloque-agenda">
        <div className="bloque-cabecera">
          <h2>Próximas clases y entregas</h2>
          <button className="boton-texto" onClick={() => ir("sync")}>
            Ver calendario
          </button>
        </div>
        {CAL_SYNC ? (
          <iframe
            className="marco-calendario compacto"
            src={urlCalendario(CAL_SYNC)}
            title="Agenda de clases"
          />
        ) : (
          <p className="aviso">Falta la variable NEXT_PUBLIC_CALENDAR_SYNC_ID en Vercel.</p>
        )}
      </section>

      <div className="columna-derecha">
        <section className="bloque">
          <div className="bloque-cabecera">
            <h2>Notas recientes</h2>
            <button className="boton-texto" onClick={() => ir("notas")}>
              Todas
            </button>
          </div>
          {notas === null && <p className="aviso">Cargando…</p>}
          {notas?.length === 0 && (
            <p className="aviso">
              Aún no hay notas.{" "}
              <button className="boton-texto" onClick={() => ir("notas")}>
                Escribir la primera
              </button>
            </p>
          )}
          {notas?.length > 0 && (
            <ul className="lista-simple">
              {notas.map((n) => (
                <li key={n.id}>
                  <button className="fila-nota" onClick={() => ir("notas")}>
                    <span className="fila-titulo">{n.titulo || "Sin título"}</span>
                    <span className="etiqueta">
                      {n.autor === correo ? "tuya" : n.autor?.split("@")[0]}
                    </span>
                    <span className="fila-fecha">{haceCuanto(n.editada_en)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bloque">
          <div className="bloque-cabecera">
            <h2>Blackboard</h2>
            <button className="boton-texto" onClick={() => ir("estado")}>
              Detalles
            </button>
          </div>
          {sync === null && <p className="aviso">Cargando…</p>}
          {sync === false && <p className="aviso">Todavía no hay sincronizaciones registradas.</p>}
          {sync && (
            <p className={`estado-linea${syncMal ? " mal" : ""}`}>
              <span className="punto" aria-hidden="true" />
              {!sync.ok
                ? "La última sincronización falló"
                : syncMal
                  ? `Sin sincronizar desde ${haceCuanto(sync.ran_at)}`
                  : `Al día, ${haceCuanto(sync.ran_at)}`}
            </p>
          )}
        </section>

        <section className="bloque bloque-accion">
          <h2>¿Sesión de estudio?</h2>
          <p className="aviso">25 minutos de trabajo, 5 de descanso.</p>
          <button className="boton" onClick={() => ir("pomodoro")}>
            Abrir Pomodoro
          </button>
        </section>
      </div>
    </div>
  );
}

/* ---------- Calendarios ---------- */

function CalendarioSync() {
  const [modo, setModo] = useState("AGENDA");
  if (!CAL_SYNC) {
    return (
      <section className="panel">
        <p>Falta la variable NEXT_PUBLIC_CALENDAR_SYNC_ID en Vercel.</p>
      </section>
    );
  }
  return (
    <section className="panel panel-calendario">
      <SelectorVista modo={modo} setModo={setModo} />
      <iframe
        className="marco-calendario"
        src={urlCalendario(CAL_SYNC, modo)}
        title="Calendario Clases Sync"
      />
      <p className="aviso nota-al-pie">
        No añadas eventos aquí: se borran en la siguiente sincronización.
      </p>
    </section>
  );
}

function SelectorVista({ modo, setModo }) {
  return (
    <div className="selector" role="group" aria-label="Vista del calendario">
      {[
        ["AGENDA", "Agenda"],
        ["WEEK", "Semana"],
        ["MONTH", "Mes"],
      ].map(([id, texto]) => (
        <button key={id} aria-pressed={modo === id} onClick={() => setModo(id)}>
          {texto}
        </button>
      ))}
    </div>
  );
}

function CalendarioPersonal({ correo }) {
  const [otro, setOtro] = useState("");
  const [guardado, setGuardado] = useState(null); // null = aún sin leer localStorage
  const [modo, setModo] = useState("AGENDA");

  useEffect(() => {
    let v = "";
    try {
      v = localStorage.getItem("calendarioPersonal") || "";
    } catch {}
    setOtro(v);
    setGuardado(v);
  }, []);

  if (guardado === null) return <section className="panel"><p>Cargando…</p></section>;

  const idMostrado = guardado || correo;

  const guardar = () => {
    const v = otro.trim();
    try {
      localStorage.setItem("calendarioPersonal", v);
    } catch {}
    setGuardado(v);
  };

  return (
    <section className="panel panel-calendario">
      <SelectorVista modo={modo} setModo={setModo} />
      <iframe
        className="marco-calendario"
        src={urlCalendario(idMostrado, modo)}
        title="Calendario personal"
      />
      <p className="aviso nota-al-pie">
        Mostrando {idMostrado}. Solo se ve si en este navegador tienes iniciada la sesión de esa
        cuenta de Google.
      </p>
      <details className="desplegable">
        <summary>Mostrar otro calendario</summary>
        <div className="fila-formulario">
          <input
            className="entrada"
            value={otro}
            onChange={(e) => setOtro(e.target.value)}
            placeholder="ID de otro calendario (vacío = el tuyo)"
            aria-label="ID de otro calendario"
          />
          <button className="boton secundario" onClick={guardar}>
            Guardar
          </button>
        </div>
      </details>
    </section>
  );
}

/* ---------- Estado de la sincronización ---------- */

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
  const mal = !ultima.ok || horas > 12;

  return (
    <section className="panel">
      <div className="cabecera-estado">
        <p className={`estado-linea grande${mal ? " mal" : ""}`}>
          <span className="punto" aria-hidden="true" />
          {!ultima.ok
            ? "La última sincronización falló"
            : `Al día. Última sincronización ${haceCuanto(ultima.ran_at)}`}
        </p>
        <button className="boton secundario" onClick={cargar}>
          Actualizar
        </button>
      </div>
      {horas > 12 && ultima.ok && (
        <p className="aviso">Hace más de 12 horas que no se sincroniza. Revisa el cron.</p>
      )}
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Cuándo</th>
              <th className="num">Entregas</th>
              <th className="num">Nuevas</th>
              <th className="num">Cambiadas</th>
              <th className="num">Borradas</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td>
                  {new Date(f.ran_at).toLocaleString("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="num">{f.feed_count}</td>
                <td className="num">{f.created}</td>
                <td className="num">{f.updated}</td>
                <td className="num">{f.deleted}</td>
                <td className={f.ok ? "ok" : "fallo"}>{f.ok ? "Correcta" : f.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
