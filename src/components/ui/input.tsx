import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const fieldClass = cn(
  "flex h-12 w-full rounded-field border border-line bg-black/25 px-4 text-[15px] text-chalk",
  "transition-[border-color,box-shadow,background-color] duration-150",
  "placeholder:text-faint hover:border-line-strong",
  "focus-visible:outline-none focus-visible:border-primary focus-visible:bg-black/35 focus-visible:shadow-[0_0_0_3px_oklch(68%_0.19_40/0.22)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(fieldClass, type === "number" && "num", className)} {...props} />
));
Input.displayName = "Input";

export { Input };
export type { InputProps };
