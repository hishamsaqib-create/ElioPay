import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraPay | Aura Dental Payslip Portal",
  description: "Payslip management for Aura Dental Clinic",
  metadataBase: new URL("https://aurapay.cloud"),
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  openGraph: {
    title: "AuraPay",
    description: "Payslip management for Aura Dental Clinic",
    siteName: "AuraPay",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
