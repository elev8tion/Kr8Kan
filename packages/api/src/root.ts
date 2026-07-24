import { agentRouter } from "./routers/agent";
import { boardRouter } from "./routers/board";
import { cardRouter } from "./routers/card";
import { checklistRouter } from "./routers/checklist";
import { labelRouter } from "./routers/label";
import { listRouter } from "./routers/list";
import { memberRouter } from "./routers/member";
import {
  attachmentRouter,
  feedbackRouter,
  healthRouter,
  importRouter,
  integrationRouter,
  permissionRouter,
} from "./routers/misc";
import { userRouter } from "./routers/user";
import { webhookRouter } from "./routers/webhook";
import { workspaceRouter } from "./routers/workspace";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  attachment: attachmentRouter,
  board: boardRouter,
  card: cardRouter,
  checklist: checklistRouter,
  feedback: feedbackRouter,
  health: healthRouter,
  label: labelRouter,
  list: listRouter,
  member: memberRouter,
  import: importRouter,
  permission: permissionRouter,
  user: userRouter,
  webhook: webhookRouter,
  workspace: workspaceRouter,
  integration: integrationRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
