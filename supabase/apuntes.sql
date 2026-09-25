-- Apuntes: PDFs y cuadernos compartidos, anotaciones privadas de cada uno.
-- Ejecutar una vez en Supabase → SQL Editor. Se puede volver a ejecutar sin romper nada.

-- ¿Es una de las dos cuentas autorizadas?
create or replace function public.es_usuario_permitido()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios_permitidos
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- Documentos (los ven los dos)
create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null check (tipo in ('pdf', 'cuaderno')),
  ruta text,                      -- ruta en Storage (solo PDFs)
  paginas int not null default 1,
  asignatura text,                -- código del módulo: MP08, MP11…
  subido_por text not null default (auth.jwt() ->> 'email'),
  creado_en timestamptz not null default now(),
  editado_en timestamptz not null default now()
);

alter table public.documentos enable row level security;

drop policy if exists "documentos: leer" on public.documentos;
drop policy if exists "documentos: crear" on public.documentos;
drop policy if exists "documentos: cambiar" on public.documentos;
drop policy if exists "documentos: borrar" on public.documentos;

create policy "documentos: leer" on public.documentos
  for select using (public.es_usuario_permitido());
create policy "documentos: crear" on public.documentos
  for insert with check (public.es_usuario_permitido() and subido_por = auth.jwt() ->> 'email');
create policy "documentos: cambiar" on public.documentos
  for update using (public.es_usuario_permitido());
create policy "documentos: borrar" on public.documentos
  for delete using (subido_por = auth.jwt() ->> 'email');

-- Anotaciones: una fila por documento, persona y página. Cada uno solo ve las suyas.
create table if not exists public.anotaciones (
  documento_id uuid not null references public.documentos (id) on delete cascade,
  autor text not null default (auth.jwt() ->> 'email'),
  pagina int not null,
  trazos jsonb not null default '[]'::jsonb,
  textos jsonb not null default '[]'::jsonb,
  actualizado_en timestamptz not null default now(),
  primary key (documento_id, autor, pagina)
);

alter table public.anotaciones enable row level security;

drop policy if exists "anotaciones: propias" on public.anotaciones;
create policy "anotaciones: propias" on public.anotaciones
  for all
  using (public.es_usuario_permitido() and autor = auth.jwt() ->> 'email')
  with check (public.es_usuario_permitido() and autor = auth.jwt() ->> 'email');

-- Almacén privado para los PDFs (máx. 50 MB por archivo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('apuntes', 'apuntes', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "apuntes: leer" on storage.objects;
drop policy if exists "apuntes: subir" on storage.objects;
drop policy if exists "apuntes: borrar" on storage.objects;

create policy "apuntes: leer" on storage.objects
  for select using (bucket_id = 'apuntes' and public.es_usuario_permitido());
create policy "apuntes: subir" on storage.objects
  for insert with check (bucket_id = 'apuntes' and public.es_usuario_permitido());
create policy "apuntes: borrar" on storage.objects
  for delete using (bucket_id = 'apuntes' and public.es_usuario_permitido());

-- ---------------------------------------------------------------
-- v2: carpetas por asignatura, documentos activos, lienzo y bloc de notas por asignatura
-- ---------------------------------------------------------------

-- "Activo" = lo que se está dando ahora en clase. Lo comparten los dos.
alter table public.documentos add column if not exists activo boolean not null default false;

-- Un lienzo (cuaderno en blanco) por asignatura; los trazos de cada uno siguen siendo privados.
alter table public.documentos add column if not exists es_lienzo boolean not null default false;
create unique index if not exists documentos_un_lienzo_por_asignatura
  on public.documentos (asignatura) where es_lienzo;

-- Bloc de notas de texto por asignatura, privado de cada uno.
create table if not exists public.notas_asignatura (
  autor text not null default (auth.jwt() ->> 'email'),
  asignatura text not null,
  contenido text not null default '',
  editado_en timestamptz not null default now(),
  primary key (autor, asignatura)
);

alter table public.notas_asignatura enable row level security;

drop policy if exists "notas_asignatura: propias" on public.notas_asignatura;
create policy "notas_asignatura: propias" on public.notas_asignatura
  for all
  using (public.es_usuario_permitido() and autor = auth.jwt() ->> 'email')
  with check (public.es_usuario_permitido() and autor = auth.jwt() ->> 'email');
