"use client";

import { apiKeyClient, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client: magic link + API keys + (optional) social/OIDC.
 * No stripeClient — Kr8Kan has no billing.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), apiKeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
