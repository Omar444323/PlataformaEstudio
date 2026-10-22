-- Transporte: configuración por usuario (EMT y Cercanías) y horarios programados de Cercanías.
-- Todo es idempotente: se puede volver a ejecutar sin romper nada.

-- 1. Configuración (lo que cada uno sigue). Las filas las escribe la app.
create table if not exists public.transporte_config (
  id          uuid primary key default gen_random_uuid(),
  correo      text not null default (auth.jwt() ->> 'email'),
  tipo        text not null check (tipo in ('emt','cercanias')),
  etiqueta    text not null,
  parada      text,
  linea       text,
  origen      text,
  destino     text,
  orden       int not null default 0,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

alter table public.transporte_config enable row level security;

drop policy if exists "propio_transporte" on public.transporte_config;
create policy "propio_transporte"
  on public.transporte_config for all to authenticated
  using (public.es_usuario_permitido() and correo = auth.jwt() ->> 'email')
  with check (public.es_usuario_permitido() and correo = auth.jwt() ->> 'email');

-- 2. Horarios de Cercanías (GTFS de Renfe). Los rellena cada noche /api/cercanias-carga
--    con el service_role. Solo se guardan los pasos por las estaciones que alguien tiene
--    configuradas y los próximos días, no el GTFS entero (son 1,5 millones de filas).

-- Estaciones: todas, para buscar por nombre al guardar un trayecto.
create table if not exists public.cercanias_estaciones (
  stop_id          text primary key,
  nombre           text not null,
  nombre_busqueda  text not null,  -- minúsculas, sin tildes ni guiones
  lat              double precision,
  lon              double precision
);
alter table public.cercanias_estaciones enable row level security;
drop policy if exists "leer_estaciones" on public.cercanias_estaciones;
create policy "leer_estaciones"
  on public.cercanias_estaciones for select to authenticated
  using (public.es_usuario_permitido());

-- Qué servicio (service_id) circula cada día.
create table if not exists public.cercanias_servicios (
  service_id  text not null,
  fecha       date not null,
  primary key (service_id, fecha)
);
create index if not exists cercanias_servicios_fecha on public.cercanias_servicios (fecha);
alter table public.cercanias_servicios enable row level security;
-- Sin políticas: solo el service_role (Edge Function y carga) la lee.

-- Paso de cada tren por cada estación configurada. Las horas van como texto HH:MM:SS
-- porque en GTFS pueden pasar de 24:00 (trenes de madrugada del día de servicio anterior).
create table if not exists public.cercanias_pasos (
  trip_id     text not null,
  service_id  text not null,
  route_id    text not null,
  linea       text not null,   -- C5, C8a…
  stop_id     text not null,
  llegada     text not null,
  salida      text not null,
  secuencia   int  not null,
  primary key (trip_id, stop_id, secuencia)
);
create index if not exists cercanias_pasos_parada on public.cercanias_pasos (stop_id, service_id);
alter table public.cercanias_pasos enable row level security;
-- Sin políticas: solo el service_role.

-- Registro de cargas, para ver en la app cuándo se cargó el horario por última vez.
create table if not exists public.cercanias_cargas (
  id          bigint generated always as identity primary key,
  cargado_en  timestamptz not null default now(),
  ok          boolean not null,
  estaciones  text[],
  pasos       int,
  servicios   int,
  error       text
);
alter table public.cercanias_cargas enable row level security;
drop policy if exists "leer_cargas" on public.cercanias_cargas;
create policy "leer_cargas"
  on public.cercanias_cargas for select to authenticated
  using (public.es_usuario_permitido());

-- Sustituye de golpe estaciones, servicios y pasos (en una transacción, así la Edge
-- Function nunca ve las tablas a medio cargar). Solo la puede llamar el service_role.
-- Los delete afectan únicamente a estas tres tablas nuevas de horarios.
create or replace function public.cercanias_reemplazar(
  p_estaciones jsonb,
  p_servicios  jsonb,
  p_pasos      jsonb,
  p_codigos    text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cercanias_estaciones where true;
  insert into public.cercanias_estaciones (stop_id, nombre, nombre_busqueda, lat, lon)
  select stop_id, nombre, nombre_busqueda, lat, lon
  from jsonb_to_recordset(p_estaciones)
    as x(stop_id text, nombre text, nombre_busqueda text, lat double precision, lon double precision);

  delete from public.cercanias_servicios where true;
  insert into public.cercanias_servicios (service_id, fecha)
  select distinct service_id, fecha
  from jsonb_to_recordset(p_servicios) as x(service_id text, fecha date);

  delete from public.cercanias_pasos where true;
  insert into public.cercanias_pasos (trip_id, service_id, route_id, linea, stop_id, llegada, salida, secuencia)
  select trip_id, service_id, route_id, linea, stop_id, llegada, salida, secuencia
  from jsonb_to_recordset(p_pasos)
    as x(trip_id text, service_id text, route_id text, linea text, stop_id text,
         llegada text, salida text, secuencia int)
  on conflict do nothing;

  insert into public.cercanias_cargas (ok, estaciones, pasos, servicios)
  values (true, p_codigos, jsonb_array_length(p_pasos), jsonb_array_length(p_servicios));
end;
$$;

revoke all on function public.cercanias_reemplazar(jsonb, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.cercanias_reemplazar(jsonb, jsonb, jsonb, text[]) to service_role;
