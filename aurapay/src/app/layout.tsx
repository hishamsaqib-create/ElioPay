import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ElioPay™ | Dental Payslip Portal",
  description: "Professional payslip management for dental practices",
  metadataBase: new URL("https://eliopay.co.uk"),
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  openGraph: {
    title: "ElioPay™",
    description: "Professional payslip management for dental practices",
    siteName: "ElioPay",
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
