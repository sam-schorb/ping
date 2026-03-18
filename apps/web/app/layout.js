import './globals.css';

export const metadata = {
  title: 'Ping',
  description: 'Node-based music editor shell',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
