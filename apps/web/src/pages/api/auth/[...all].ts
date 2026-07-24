import { toNodeHandler } from "better-auth/node";

import { getAuth } from "@kr8kan/api";
import { dbReady } from "@kr8kan/db";

// better-auth needs the raw body
export const config = { api: { bodyParser: false } };

const handler = toNodeHandler(getAuth().handler);

export default async function authRoute(
  req: Parameters<typeof handler>[0],
  res: Parameters<typeof handler>[1],
) {
  await dbReady();
  return handler(req, res);
}
