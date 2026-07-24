import type { AppProps } from "next/app";
import Head from "next/head";
import { ThemeProvider } from "next-themes";

import "@fontsource-variable/plus-jakarta-sans";
import "~/styles/globals.css";

import { ToastProvider } from "~/providers/toast";
import { TRPCProvider } from "~/providers/trpc";
import { WorkspaceProvider } from "~/providers/workspace";

/**
 * Kr8Kan — self-hosted kanban. No analytics by default; no billing,
 * ever. Theme via class on <html> (next-themes), data via tRPC.
 */
export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Kr8Kan</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0f6b5c" />
      </Head>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TRPCProvider>
          <ToastProvider>
            <WorkspaceProvider>
              <Component {...pageProps} />
            </WorkspaceProvider>
          </ToastProvider>
        </TRPCProvider>
      </ThemeProvider>
    </>
  );
}
