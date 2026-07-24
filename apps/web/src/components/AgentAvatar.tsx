import clsx from "clsx";

/**
 * Avatar chip for agent identities: emoji glyph on a deterministic tint
 * derived from the identity's publicId. Pairs with the "agent" badge so
 * agents are always visually distinct from humans.
 */

const TINTS = [
  "bg-violet-500/15 text-violet-500",
  "bg-sky-500/15 text-sky-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-600",
  "bg-rose-500/15 text-rose-500",
  "bg-cyan-500/15 text-cyan-600",
];

function tintFor(publicId: string): string {
  let hash = 0;
  for (const ch of publicId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

export interface AgentInfo {
  publicId: string;
  displayName: string;
  avatar: string;
}

export function AgentAvatar({
  agent,
  size = "md",
}: {
  agent: AgentInfo;
  size?: "sm" | "md";
}) {
  return (
    <span
      title={agent.displayName}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "md" ? "h-8 w-8 text-[15px]" : "h-5 w-5 text-[11px]",
        tintFor(agent.publicId),
      )}
    >
      {agent.avatar}
    </span>
  );
}

export function AgentChip() {
  return (
    <span className="rounded-full bg-kr8-accent/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kr8-accent">
      agent
    </span>
  );
}
