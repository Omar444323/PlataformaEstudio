# Plataforma de estudio

Next.js en Vercel + Supabase. Login con Google restringido a dos correos, calendarios de clase y
estado de la sincronización con Blackboard.

## Puesta en marcha

1. Crea un repo nuevo en GitHub y sube estos archivos.
2. En Vercel: **Add New → Project** → importa el repo. No hace falta cambiar nada del build.
3. Antes de desplegar, añade las variables de entorno de `.env.example` (todas, en Production y
   Preview).
4. Despliega. Anota la URL, por ejemplo `https://estudio.vercel.app`.

## Conectar el login de Google

1. **Google Cloud → Credenciales → tu cliente OAuth**, añade en "URIs de redireccionamiento
   autorizados": `https://TU_REF.supabase.co/auth/v1/callback`
2. **Supabase → Authentication → Providers → Google**: actívalo y pega el Client ID y el Client
   Secret.
3. **Supabase → Authentication → URL Configuration**: pon tu dominio de Vercel como *Site URL* y
   añádelo también en *Redirect URLs*.

## Publicar la app en Google

Con el proyecto desplegado ya tienes las dos URL que Google pide:

- `https://TU-DOMINIO/privacidad`
- `https://TU-DOMINIO/terminos`

Pégalas en **Google Auth Platform → Información de marca** y vuelve a **Público → Publicar app**.
Al pasar a producción, el refresh token deja de caducar a los 7 días.

## Pestañas

- **Clases Sync**: el calendario que mantiene la Edge Function. Solo lectura.
- **Clase · Google**: el calendario suscrito por URL de cada uno. El ID se guarda en el navegador.
- **Estado**: últimas sincronizaciones leídas de `sync_log`, para detectar si algo dejó de ir.
