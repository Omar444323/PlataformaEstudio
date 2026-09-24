// Horario de 2º GAD_T · Aula 102 (curso 2026-27), copiado del PDF del centro.
// Si cambia el horario, solo hay que tocar este archivo.

export const AULA = "Aula 102";

// Franjas del día. "recreo" no es una clase.
export const FRANJAS = [
  { inicio: "15:00", fin: "15:55" },
  { inicio: "15:55", fin: "16:50" },
  { inicio: "16:50", fin: "17:45" },
  { inicio: "17:45", fin: "18:15", recreo: true },
  { inicio: "18:15", fin: "19:10" },
  { inicio: "19:10", fin: "20:05" },
  { inicio: "20:05", fin: "21:00" },
];

export const MODULOS = {
  MP08: { nombre: "Empresa en el aula", color: "#1faa6b" },
  MP09: { nombre: "Operaciones auxiliares de gestión de tesorería", corto: "Op. aux. gestión tesorería", color: "#6fcf6f" },
  MP10: { nombre: "Operaciones administrativas de RRHH", corto: "Op. adm. RRHH", color: "#5e9e8c" },
  MP11: { nombre: "Tratamiento de la documentación contable", corto: "Trat. doc. contable", color: "#2f7df6" },
  MP12: { nombre: "Digitalización aplicada", color: "#f28a1a" },
  MP13: { nombre: "Sostenibilidad aplicada", color: "#7f7fc4" },
  MP14: { nombre: "Itinerario personal para la empleabilidad II", corto: "IPE II", color: "#3cc9d6" },
  MPOP: { nombre: "Prácticas en entorno de simulación", corto: "Simulación empresarial", color: "#f07a7a" },
};

// Índice de franja (0-6, el 3 es el recreo) y cuántas franjas seguidas dura.
// Día: 1 = lunes … 5 = viernes, como Date.getDay().
const C = (modulo, profe, franja, dura = 1) => ({ modulo, profe, franja, dura });

export const SEMANA = {
  1: [
    C("MP08", "Mónica Martínez", 0),
    C("MP09", "Carmen Montero", 1),
    C("MP11", "Carmen Montero", 2),
    C("MP11", "Carmen Montero", 4),
    C("MP10", "Javier Plasencia García", 5, 2),
  ],
  2: [
    C("MP11", "Carmen Montero", 0),
    C("MP10", "Javier Plasencia García", 1, 2),
    C("MP14", "Javier Plasencia García", 4, 2),
    C("MP08", "Mónica Martínez", 6),
  ],
  3: [
    C("MP10", "Javier Plasencia García", 0),
    C("MPOP", "Javier Plasencia García", 1),
    C("MP11", "Carmen Montero", 2),
    C("MP09", "Carmen Montero", 4),
    C("MPOP", "Javier Plasencia García", 5),
    C("MP13", "Manuel Jesús Martín Serrano", 6),
  ],
  4: [
    C("MP12", "Mónica Martínez", 0),
    C("MP11", "Carmen Montero", 1),
    C("MP13", "Javier Plasencia García", 2),
    C("MPOP", "Javier Plasencia García", 4),
    C("MP08", "Mónica Martínez", 5),
    C("MP09", "Carmen Montero", 6),
  ],
  5: [
    C("MP11", "Carmen Montero", 0),
    C("MP12", "Mónica Martínez", 1),
    C("MP08", "Mónica Martínez", 2),
    C("MP09", "Carmen Montero", 4, 3),
  ],
};

export const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

export function aMinutos(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Clases de un día con su hora real de inicio y fin.
export function clasesDelDia(dia) {
  return (SEMANA[dia] || []).map((c) => ({
    ...c,
    inicio: FRANJAS[c.franja].inicio,
    fin: FRANJAS[c.franja + c.dura - 1].fin,
    ...MODULOS[c.modulo],
  }));
}

// Qué toca ahora y qué viene después, según la hora del navegador.
export function momento(fecha = new Date()) {
  const dia = fecha.getDay();
  const min = fecha.getHours() * 60 + fecha.getMinutes();
  const clases = clasesDelDia(dia);
  const ahora = clases.find((c) => min >= aMinutos(c.inicio) && min < aMinutos(c.fin)) || null;
  const siguiente = clases.find((c) => aMinutos(c.inicio) > min) || null;
  const r = FRANJAS[3];
  const enRecreo = clases.length > 0 && min >= aMinutos(r.inicio) && min < aMinutos(r.fin);
  return { dia, min, clases, ahora, siguiente, enRecreo };
}
