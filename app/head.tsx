export default function Head() {
  // Force favicon using PNG variants and cache-busting
  const favicon32 = "/favicon-32x32.png?v=2";
  const favicon16 = "/favicon-16x16.png?v=2";
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" type="image/png" sizes="32x32" href={favicon32} />
      <link rel="icon" type="image/png" sizes="16x16" href={favicon16} />
      <link rel="shortcut icon" href={favicon32} />
      <link rel="apple-touch-icon" href={favicon32} />
      <link rel="manifest" href="/site.webmanifest" />
      {/* Prevent old icon caching */}
      <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
      <meta httpEquiv="Pragma" content="no-cache" />
      <meta httpEquiv="Expires" content="0" />
    </>
  );
}
