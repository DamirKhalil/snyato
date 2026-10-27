import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "СНЯТО — авторская студия курсов",
  description: "От первой идеи до последнего урока. Программа, график записи, материалы и работа команды в одной авторской студии.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
