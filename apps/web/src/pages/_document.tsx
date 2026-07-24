import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head />
      <body className="bg-kr8-bg text-kr8-fg antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
