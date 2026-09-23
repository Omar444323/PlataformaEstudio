"use client";

import { createClient } from "@supabase/supabase-js";

let cliente = null;

// El cliente se crea en el primer uso, no al importar el módulo. Durante el build
// Next prerenderiza la portada en el servidor, y si createClient se ejecutaba ahí
// arriba el build se caía con "supabaseUrl is required" antes de leer nada.
function obtenerCliente() {
  if (!cliente) {
    cliente = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } }
    );
  }
  return cliente;
}

export const supabase = new Proxy(
  {},
  {
    get(_destino, propiedad) {
      const real = obtenerCliente();
      const valor = real[propiedad];
      return typeof valor === "function" ? valor.bind(real) : valor;
    },
  }
);

export function estaPermitido(email) {
  const lista = (process.env.NEXT_PUBLIC_ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!email && lista.includes(email.toLowerCase());
}
