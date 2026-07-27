import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head>
        {/* Declaring an icon stops the browser probing /favicon.ico, which
            404s on every page. That 404 is a console error, so it would
            fail any checkUrl workflow step and show up in every dev-task
            browser verification. */}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </Head>
      <body className="bg-kr8-bg text-kr8-fg antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
