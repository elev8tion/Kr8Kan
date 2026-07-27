import type { ReactNode } from "react";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import clsx from "clsx";

export interface DropdownItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: ReactNode;
}

/** Overflow `⋯` / action menu — keyboard + touch friendly (44px rows). */
export function Dropdown({
  button,
  items,
  align = "right",
  buttonLabel,
}: {
  button: ReactNode;
  items: DropdownItem[];
  align?: "left" | "right";
  buttonLabel?: string;
}) {
  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label={buttonLabel}
        className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
        onClick={(e) => e.stopPropagation()}
      >
        {button}
      </MenuButton>
      <MenuItems
        className={clsx(
          "absolute z-40 mt-1 max-h-[60dvh] min-w-44 overflow-y-auto overscroll-contain rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-1 shadow-kr8-md focus:outline-none",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {items.map((item) => (
          <MenuItem key={item.label}>
            {({ focus }) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                }}
                className={clsx(
                  "flex w-full min-h-[44px] items-center gap-2 rounded-kr8-sm px-3 text-left text-sm md:min-h-[36px]",
                  focus && "bg-kr8-bg-muted",
                  item.danger ? "text-kr8-danger" : "text-kr8-fg",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
