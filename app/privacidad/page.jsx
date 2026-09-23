export const metadata = { title: "Privacidad" };

export default function Privacidad() {
  return (
    <main className="marco texto-legal">
      <h1>Política de privacidad</h1>
      <p>Última actualización: septiembre de 2026.</p>

      <p>
        Esta aplicación es un proyecto personal de uso privado. La utilizan únicamente sus dos
        usuarios autorizados para consultar sus fechas de entrega y sus apuntes de clase. No está
        abierta al público ni tiene ninguna finalidad comercial.
      </p>

      <h2>Quién trata los datos</h2>
      <p>
        Omar Ennaji Edaoudi, Madrid (España). Para cualquier cuestión sobre estos datos:
        oennajie@gmail.com.
      </p>

      <h2>Qué datos se tratan</h2>
      <ul>
        <li>Dirección de correo y nombre de la cuenta de Google con la que se inicia sesión.</li>
        <li>
          Eventos del calendario de Google que la aplicación crea, modifica o borra en un
          calendario creado para este fin.
        </li>
        <li>Archivos de apuntes que los propios usuarios suben a la aplicación.</li>
        <li>Un registro técnico de cada sincronización, con fechas y número de eventos.</li>
      </ul>

      <h2>Para qué se usan</h2>
      <p>
        Los datos se usan solo para que la aplicación funcione: identificar a los dos usuarios
        autorizados, mantener actualizado el calendario de clase con las fechas publicadas por el
        centro educativo y guardar los apuntes compartidos. No se usan para publicidad, no se
        elaboran perfiles y no se toman decisiones automatizadas sobre las personas.
      </p>

      <h2>Datos de Google</h2>
      <p>
        La aplicación accede al calendario de Google del usuario que la autoriza, con permiso para
        leer y escribir eventos. Ese acceso se emplea exclusivamente para reflejar las fechas de
        entrega del centro educativo en un calendario propio. La información obtenida de las API de
        Google no se vende, no se comparte con terceros y no se usa para ninguna otra finalidad.
      </p>

      <h2>Dónde se guardan</h2>
      <p>
        La aplicación se aloja en Vercel y sus datos en Supabase, con servidores en la Unión
        Europea. Los archivos de apuntes se guardan en Google Drive. Las credenciales de acceso se
        almacenan cifradas y no son accesibles desde el navegador.
      </p>

      <h2>Cuánto tiempo</h2>
      <p>
        Los datos se conservan mientras la aplicación siga en uso. Cualquiera de los dos usuarios
        puede pedir que se borren sus datos escribiendo al correo indicado arriba, y se eliminarán
        junto con su cuenta.
      </p>

      <h2>Retirar el acceso</h2>
      <p>
        El permiso concedido a la aplicación puede retirarse en cualquier momento desde la página
        de permisos de la cuenta de Google, en myaccount.google.com/permissions.
      </p>

      <h2>Derechos</h2>
      <p>
        Los usuarios pueden solicitar el acceso, la rectificación o la supresión de sus datos, así
        como la limitación u oposición a su tratamiento, escribiendo al correo indicado. También
        pueden presentar una reclamación ante la Agencia Española de Protección de Datos.
      </p>

      <p>
        <a href="/">Volver</a>
      </p>
    </main>
  );
}
