import clsx from "clsx";

import { initials } from "~/utils/format";

export interface AvatarProps {
  name: string;
  image?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const sizes = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-[13px]",
};

export function Avatar({ name, image, size = "sm", className }: AvatarProps) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt={name}
      title={name}
      className={clsx("rounded-full object-cover", sizes[size], className)}
    />
  ) : (
    <span
      title={name}
      className={clsx(
        "inline-flex items-center justify-center rounded-full bg-kr8-accent/20 font-semibold text-kr8-accent",
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 3,
  size = "xs",
}: {
  people: { name: string; image?: string | null }[];
  max?: number;
  size?: AvatarProps["size"];
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  if (people.length === 0) return null;
  return (
    <span className="flex -space-x-1.5">
      {shown.map((p, i) => (
        <Avatar
          key={`${p.name}-${i}`}
          name={p.name}
          image={p.image}
          size={size}
          className="ring-2 ring-kr8-bg-elevated"
        />
      ))}
      {extra > 0 && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-kr8-bg-muted text-[9px] font-semibold text-kr8-fg-muted ring-2 ring-kr8-bg-elevated">
          +{extra}
        </span>
      )}
    </span>
  );
}
