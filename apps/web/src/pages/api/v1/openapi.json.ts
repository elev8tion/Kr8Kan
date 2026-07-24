import type { NextApiRequest, NextApiResponse } from "next";

import { openApiDocument } from "@kr8kan/api";

export default function openapiRoute(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json(openApiDocument);
}
