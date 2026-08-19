import "./globals.css";
import { AuthProvider } from "@/components/AuthContext";
import { ToastProvider } from "@/components/ToastContext";
import { IntegrationModeProvider } from "@/components/IntegrationModeContext";
import Navbar from "@/components/Navbar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Vertex Dynamics: Scan-to-Path Hub",
  description: "Next-Generation 3D Vision & Industrial Robot Integration. RMIT University Capstone 2026.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Load Material Symbols directly in the head */}
        <link 
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" 
          rel="stylesheet"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link 
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" 
          rel="stylesheet" 
          />
      </head>
      <body className="bg-background text-on-background antialiased overflow-hidden h-screen w-screen flex flex-col" suppressHydrationWarning>
        <AuthProvider>
          <IntegrationModeProvider>
            <ToastProvider>
              {/* Global Navbar appears on authenticated views */}
              <Navbar />
              <div className="flex-1 flex overflow-hidden w-full h-full relative">
                {children}
              </div>
            </ToastProvider>
          </IntegrationModeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
