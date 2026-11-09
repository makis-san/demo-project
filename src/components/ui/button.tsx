import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "default" | "outline" | "ghost" | "destructive" | "secondary" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// One shape for every button: a pill. Ember fill for the one main action on a screen, glass for the rest.
const variantStyles: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-ink font-semibold hover:bg-primary-strong shadow-[0_10px_30px_-12px_var(--color-primary)] " +
    "disabled:bg-white/[0.07] disabled:text-faint disabled:shadow-none disabled:opacity-100",
  outline: "border border-line-strong bg-white/[0.04] text-chalk hover:bg-white/[0.09] hover:border-white/25",
  ghost: "text-muted hover:bg-white/[0.07] hover:text-chalk",
  destructive: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/60",
  secondary: "bg-white/[0.08] text-chalk hover:bg-white/[0.13]",
  link: "text-accent underline-offset-4 hover:underline",
};

const sizeStyles: Record<ButtonSize, string> = {
  default: "h-11 px-5 text-sm",
  sm: "h-9 px-4 text-sm",
  lg: "h-14 px-8 text-base",
  icon: "h-10 w-10",
};

/** The classes of a button, for a link that should look like one. */
function buttonClasses({
  variant = "default",
  size = "default",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&>svg]:pointer-events-none [&>svg]:shrink-0",
    variantStyles[variant],
    sizeStyles[size],
    className,
  );
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", disabled, ...props }, ref) => (
    <button ref={ref} disabled={disabled} className={buttonClasses({ variant, size, className })} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonClasses };
export type { ButtonVariant, ButtonSize, ButtonProps };
