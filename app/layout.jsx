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
  description: "Calendario de clase, apuntes y herramientas de estudio",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Apuntes",
    statusBarStyle: "default",
  },
};

export const viewport = {
  themeColor: "#f7f8fa",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${titulo.variable} ${texto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
