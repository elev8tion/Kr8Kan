import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Force-clear auth cookies. better-auth's own /sign-out 403s when the
 * session row no longer exists (wiped DB, rotated secret), and the
 * cookies are httpOnly so the client can't clear them — leaving a ghost
 * session the middleware keeps treating as signed-in. This route expires
 * the cookies unconditionally; it needs no auth because its only effect
 * is signing the caller out.
 */
const COOKIES = [
  "kr8kan.session_token",
  "kr8kan.session_data",
  "__Secure-kr8kan.session_token",
  "__Secure-kr8kan.session_data",
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  res.setHeader(
    "Set-Cookie",
    COOKIES.map(
      (name) =>
        `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
    ),
  );
  res.status(200).json({ cleared: true });
}
