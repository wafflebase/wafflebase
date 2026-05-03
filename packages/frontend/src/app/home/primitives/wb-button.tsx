import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const wbButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-body font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--wb-syrup)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--wb-bg)] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-[color:var(--wb-syrup)] text-[#FFFAF0] border border-[color:var(--wb-syrup-deep)] shadow-[0_1px_0_var(--wb-syrup-deep),inset_0_1px_0_color-mix(in_srgb,white_25%,transparent)] hover:bg-[color:var(--wb-syrup-deep)] hover:-translate-y-px",
        ghost:
          "bg-transparent text-[color:var(--wb-ink)] border border-[color:var(--wb-rule)] hover:bg-[color:var(--wb-rule)]/40",
      },
      size: {
        default: "px-4 py-[9px] text-[14px]",
        lg: "px-[22px] py-[13px] text-[15px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type WbButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof wbButtonVariants> & {
    asChild?: boolean;
  };

export function WbButton({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: WbButtonProps) {
  const Comp = asChild ? Slot : "button";
  // Default native <button> to type="button" so it never submits a parent
  // form by accident. asChild mode delegates the underlying element so we
  // leave the type attribute alone in that path.
  const buttonType = asChild ? type : (type ?? "button");
  return (
    <Comp
      data-slot="wb-button"
      className={cn(wbButtonVariants({ variant, size, className }))}
      type={buttonType}
      {...props}
    />
  );
}
