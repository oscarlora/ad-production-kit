import { Inter } from 'next/font/google';
import PageLink from '../components/chat/PageLink.js';
import { BrandsProvider } from '../components/Switcher.js';
import { listBrands } from '../lib/server/brands.js';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'Ad Production Kit',
  description: 'Ad Production Kit Studio: the ads board, media library and workflow for every brand.',
};

export default function RootLayout({ children }) {
  let brands = [], error = null;
  try { brands = listBrands(); } catch (e) { error = String(e?.message || e); }
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <BrandsProvider brands={brands} error={error}>
          <main className="page">{children}</main>
          <PageLink />
        </BrandsProvider>
      </body>
    </html>
  );
}
