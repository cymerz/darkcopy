import type { Metadata } from 'next';
import { JetBrains_Mono, Anybody } from 'next/font/google';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { NavigationProgress } from '@/components/NavigationProgress';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '700'],
});

const anybody = Anybody({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['700', '800', '900'],
});

export const metadata: Metadata = {
  title: 'DarkCopy',
  description: 'Platform berbagi teks dan file dengan tema gelap',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={`${jetbrainsMono.variable} ${anybody.variable} dark overflow-x-hidden`} suppressHydrationWarning>
      <head>
        {/* Prevent FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark')}else if(t==='dark'||!t){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-background text-on-background min-h-screen flex flex-col font-mono antialiased relative overflow-x-hidden">
        <NavigationProgress />
        <Header />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 lg:px-8 lg:py-10 relative z-10">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
