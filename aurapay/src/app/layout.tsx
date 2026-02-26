import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraPay™ | Dental Payslip Portal",
  description: "Professional payslip management for dental practices",
  metadataBase: new URL("https://aurapay.co.uk"),
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  openGraph: {
    title: "AuraPay™",
    description: "Professional payslip management for dental practices",
    siteName: "AuraPay",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
