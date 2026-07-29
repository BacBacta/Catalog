import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import type { ReactNode } from "react";
import { cx } from "../cx.ts";

/**
 * Primitives a portail et a etat. Tout le comportement — piege de focus,
 * restitution du focus, `aria-modal`, echappement, defilement bloque — vient de
 * Base UI. On n'en reimplemente aucun morceau : c'est precisement ce qu'on
 * achete en prenant une bibliotheque sans style.
 *
 * Les animations sont en CSS et disparaissent sous `prefers-reduced-motion`.
 * Aucun composant n'importe Motion.
 */

/* ────────────────────────── Tabs ────────────────────────── */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cx(
        "inline-flex items-center gap-1 rounded-field bg-plane p-1 font-sans",
        className as string,
      )}
      {...props}
    />
  );
}

export function Tab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tab"
      className={cx(
        "min-h-[var(--size-touch)] rounded-[10px] px-3.5 text-body font-semibold text-ink-2",
        "transition-colors duration-fast ease-out",
        "data-selected:bg-surface data-selected:text-ink",
        className as string,
      )}
      {...props}
    />
  );
}

export function TabPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tab-panel"
      className={cx("pt-3 font-sans text-ink", className as string)}
      {...props}
    />
  );
}

/* ────────────────────────── Dialog ────────────────────────── */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  title,
  description,
  children,
  ...props
}: DialogPrimitive.Popup.Props & { title: string; description?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className={cx(
          "fixed inset-0 z-40 bg-backdrop",
          "transition-opacity duration-base ease-out data-closed:opacity-0 data-open:opacity-100",
        )}
      />
      <DialogPrimitive.Popup
        data-slot="dialog"
        className={cx(
          "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50",
          "flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3",
          "rounded-card border border-line bg-raised p-4 font-sans text-ink",
          "transition-opacity duration-base ease-out data-closed:opacity-0 data-open:opacity-100",
          className as string,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="text-title font-bold">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-caption text-ink-2">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/* ────────────────────────── Sheet (Drawer) ────────────────────────── */

export const Sheet = DrawerPrimitive.Root;
export const SheetTrigger = DrawerPrimitive.Trigger;
export const SheetClose = DrawerPrimitive.Close;

/**
 * Panneau glissant par le bas. C'est la bonne geometrie sur telephone tenu a
 * une main : le contenu arrive la ou le pouce se trouve deja.
 */
export function SheetContent({
  className,
  title,
  children,
  ...props
}: DrawerPrimitive.Popup.Props & { title: string }) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop
        className={cx(
          "fixed inset-0 z-40 bg-backdrop",
          "transition-opacity duration-base ease-out data-closed:opacity-0 data-open:opacity-100",
        )}
      />
      <DrawerPrimitive.Popup
        data-slot="sheet"
        className={cx(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-3 overflow-y-auto",
          "rounded-t-card border-line border-t bg-raised p-4 font-sans text-ink",
          "transition-transform duration-base ease-out data-closed:translate-y-full",
          className as string,
        )}
        {...props}
      >
        <DrawerPrimitive.Title className="text-title font-bold">{title}</DrawerPrimitive.Title>
        {children}
      </DrawerPrimitive.Popup>
    </DrawerPrimitive.Portal>
  );
}

/* ────────────────────────── Select ────────────────────────── */

export const Select = SelectPrimitive.Root;

export function SelectTrigger({ className, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cx(
        "flex min-h-[var(--size-touch)] w-full items-center justify-between gap-2 rounded-field",
        "border border-control-line bg-surface px-3.5 font-sans text-body text-ink",
        className as string,
      )}
      {...props}
    />
  );
}

export const SelectValue = SelectPrimitive.Value;

export function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={6} className="z-50">
        <SelectPrimitive.Popup
          data-slot="select-popup"
          className={cx(
            "max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-card",
            "border border-line bg-raised p-1 font-sans text-ink",
            className as string,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cx(
        "flex min-h-[var(--size-touch)] cursor-default items-center gap-2 rounded-[10px] px-3 text-body",
        "data-highlighted:bg-plane data-selected:font-semibold",
        className as string,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

/* ────────────────────────── Toast ────────────────────────── */

export const toastManager = ToastPrimitive.createToastManager();

const TOAST_TONE: Record<string, string> = {
  good: "border-good bg-good-soft text-good",
  warn: "border-warn bg-warn-soft text-warn",
  danger: "border-danger bg-danger-soft text-danger",
};

/**
 * Un avis passager. `Viewport` porte le role live de Base UI : le message est
 * annonce aux lecteurs d'ecran sans voler le focus.
 */
export function ToastHost({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      data-slot="toast"
      className={cx(
        "flex flex-col gap-0.5 rounded-card border bg-raised p-3 font-sans",
        "transition-opacity duration-base ease-out data-closed:opacity-0",
        TOAST_TONE[String(toast.type ?? "")] ?? "border-line text-ink",
      )}
    >
      <ToastPrimitive.Title className="text-body font-semibold" />
      <ToastPrimitive.Description className="text-caption" />
    </ToastPrimitive.Root>
  ));
}
