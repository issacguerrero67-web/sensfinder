// Copy-in primitives in the shadcn/ui style: Radix behaviour, token-driven Tailwind classes.
import * as React from "react";
import { Dialog as RDialog, Switch as RSwitch } from "radix-ui";
import { clsx, type ClassValue } from "clsx";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ToastKind } from "../lib/types";

export const cx = (...a: ClassValue[]) => clsx(a);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "hero";
  icon?: React.ReactNode;
};
export function Button({ variant = "secondary", size = "md", icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        size === "hero" && "h-14 rounded-md px-8 text-lg font-semibold",
        variant === "primary" && "bg-accent-strong text-white hover:brightness-110 active:brightness-95",
        variant === "secondary" && "border border-line bg-s2 text-text hover:border-[#343a42] hover:bg-[#1c2025]",
        variant === "ghost" && "text-muted hover:bg-s2 hover:text-text",
        variant === "danger" && "border border-danger/40 text-danger hover:bg-danger/10",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-s2 hover:text-text disabled:opacity-45", className)} {...rest}>
      {children}
    </button>
  );
}

const TONE: Record<string, string> = {
  good: "border-good/30 bg-good/10 text-good",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  accent: "border-accent/40 bg-accent/10 text-accent-soft",
  muted: "border-line bg-s2 text-muted",
};
export function Chip({ tone = "muted", icon, children, className }: { tone?: keyof typeof TONE; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium", TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export const TONE_ICON: Record<ToastKind, React.ReactNode> = {
  info: <Info size={16} aria-hidden />, good: <CheckCircle2 size={16} aria-hidden />,
  warn: <AlertTriangle size={16} aria-hidden />, danger: <XCircle size={16} aria-hidden />,
};

/** Full-width status line. Tone is carried by icon + words, not color alone. */
export function Banner({ tone = "info", dot, children, action, className }: {
  tone?: ToastKind; dot?: boolean; children: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-muted";
  return (
    <div role={tone === "danger" || tone === "warn" ? "alert" : "status"}
      className={cx("flex min-h-10 items-center gap-3 border-b border-line bg-s1 px-6 py-2 text-sm", className)}>
      <span className={cx("flex shrink-0 items-center", color)}>
        {dot ? <span className="pulse block size-2.5 rounded-full bg-danger" aria-hidden /> : TONE_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1 text-text">{children}</div>
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-2", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className, mono, ...rest }, ref) {
    return (
      <input ref={ref}
        className={cx(!/(^|\s)w-/.test(className ?? "") && "w-full", "h-10 rounded-sm border border-line bg-s1 px-3 text-base text-text placeholder:text-faint hover:border-[#343a42] focus:border-accent",
          mono && "num", className)} {...rest} />
    );
  },
);

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <RSwitch.Root id={id} checked={checked} onCheckedChange={onChange} aria-label={label}
      className={cx("relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-200", checked ? "border-accent-strong bg-accent-strong" : "border-line bg-s2")}>
      <RSwitch.Thumb className={cx("block size-4 rounded-full bg-white transition-transform duration-200", checked ? "translate-x-[19px]" : "translate-x-[3px] bg-muted")} />
    </RSwitch.Root>
  );
}

/** Segmented control: a real tablist with arrow-key movement. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; disabled?: boolean }[]; label: string; className?: string;
}) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const live = options.filter((o) => !o.disabled), i = live.findIndex((o) => o.value === value);
    const next = live[(i + (e.key === "ArrowRight" ? 1 : live.length - 1)) % live.length];
    if (next) onChange(next.value);
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className={cx("inline-flex gap-1 rounded-md border border-line bg-s1 p-1", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} tabIndex={o.value === value ? 0 : -1} disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx("h-8 rounded-sm px-3 text-sm font-medium first-letter:uppercase disabled:opacity-45", o.value === value ? "bg-s2 text-text shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, width = 480, side }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; width?: number; side?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fade-in fixed inset-0 z-40 bg-black/60" />
        <RDialog.Content aria-describedby={undefined} style={{ width }}
          className={cx("fixed z-50 flex max-w-[calc(100vw-32px)] flex-col border border-line bg-s1 shadow-2xl shadow-black/60",
            side ? "screen-in inset-y-0 right-0 max-h-screen border-y-0 border-r-0" : "pop-in left-1/2 top-1/2 max-h-[calc(100vh-64px)] -translate-x-1/2 -translate-y-1/2 rounded-lg")}>
          <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
            <div>
              <RDialog.Title className="text-lg font-semibold text-text">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description>}
            </div>
            <RDialog.Close asChild><IconButton label="Close"><X size={16} aria-hidden /></IconButton></RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="mb-8 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-text">{title}</h1>
        {sub && <p className="mt-1 max-w-[640px] text-base text-muted">{sub}</p>}
      </div>
      {right && <div className="flex min-h-8 shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}

/** A titled group separated by a hairline. Used instead of nesting cards. */
export function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("border-t border-line py-6", className)}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="label">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
