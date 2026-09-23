import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const titulo = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--fuente-titulo",
});

const texto = Inter({
  subsets: ["latin"],
  variable: "--fuente-texto",
});

export const metadata = {
  title: "Apuntes y entregas",
  description: "Calendario de clase y apuntes compartidos",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${titulo.variable} ${texto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
