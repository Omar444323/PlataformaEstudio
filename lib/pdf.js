"use client";

// pdf.js se carga solo en el navegador y solo cuando hace falta (pesa bastante).
// El worker se sirve desde jsDelivr con la misma versión exacta que package.json.
const VERSION = "4.10.38";

let promesa = null;

export function cargarPdfjs() {
  if (!promesa) {
    promesa = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return promesa;
}

export async function abrirPdf(datos) {
  const pdfjs = await cargarPdfjs();
  return pdfjs.getDocument({ data: datos }).promise;
}
