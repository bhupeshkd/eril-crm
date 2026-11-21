import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'ERIL — Business Operating System',
  description: 'CRM, sales pipeline, automation and unified inbox in one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* Apply the saved light/dark choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('eril.theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
