-- Transporte: aviso cuando faltan unos minutos para el bus o el tren que esperas.
-- Ejecutar después de supabase/transporte.sql. No toca ninguna tabla existente.

-- 1. Avisos pedidos desde la app (botón «Avísame»). Cada uno es un bus o un tren concreto.
create table if not exists public.transporte_avisos (
  id          uuid primary key default gen_random_uuid(),
  correo      text not null default (auth.jwt() ->> 'email'),
  tipo        text not null check (tipo in ('emt','cercanias')),
  etiqueta    text not null,
  parada      text not null,   -- EMT: número de parada. Cercanías: código de la estación de origen
  linea       text,
  viaje       text,            -- EMT: número de autobús. Cercanías: trip_id del GTFS
  sale        timestamptz not null,  -- hora prevista al pedirlo (el tren, programada)
  minutos     int not null default 5 check (minutos between 1 and 30),
  creado_en   timestamptz not null default now(),
  enviado_en  timestamptz
);
create index if not exists transporte_avisos_pendientes on public.transporte_avisos (enviado_en, sale);

alter table public.transporte_avisos enable row level security;
drop policy if exists "propios_avisos_transporte" on public.transporte_avisos;
create policy "propios_avisos_transporte"
  on public.transporte_avisos for all to authenticated
  using (public.es_usuario_permitido() and correo = auth.jwt() ->> 'email')
  with check (public.es_usuario_permitido() and correo = auth.jwt() ->> 'email');

-- 2. Cada minuto, solo si hay algún aviso pendiente, se llama a la Edge Function
--    transporte-avisos. Mismo patrón que sync-blackboard y avisos-entregas (secretos en Vault).
select cron.schedule(
  'transporte-avisos',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/transporte-avisos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (select 1 from public.transporte_avisos where enviado_en is null);
  $$
);
