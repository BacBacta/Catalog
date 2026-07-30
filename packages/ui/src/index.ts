/**
 * Le design system de Catalog.
 *
 * Aucun composant n'importe Motion : les transitions sont en CSS, et elles
 * disparaissent sous `prefers-reduced-motion` grace a la regle de `tokens.css`.
 * Aucun n'embarque de bibliotheque d'icones ni de police — la boutique publique
 * a 30 Ko de JS pour tout son chemin critique.
 */
export { cx } from "./cx.ts";

export const TOKENS_HREF = "@catalog/ui/tokens.css";

/* Composants metier. */
export {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  StatTile,
  type StatTileProps,
  StatusBadge,
  type StatusBadgeProps,
} from "./blocks.tsx";
export { MoneyDisplay, type MoneyDisplayProps, type MoneySize } from "./money-display.tsx";
export { OtpField, type OtpFieldProps } from "./otp-field.tsx";
/* Primitives sur Base UI. */
export {
  Badge,
  type BadgeProps,
  type BadgeTone,
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonTone,
  Card,
  CardNote,
  CardTitle,
  Field,
  Input,
  Label,
  Separator,
  Skeleton,
} from "./primitives/basics.tsx";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  Tab,
  TabPanel,
  Tabs,
  TabsList,
  ToastHost,
  toastManager,
} from "./primitives/overlays.tsx";
/* Les deux composants propres a ce produit. */
export {
  type CheckState,
  type ProofCheckItem,
  ProofChecklist,
  type ProofChecklistProps,
} from "./proof-checklist.tsx";
export { SmsPasteField, type SmsPasteFieldProps } from "./sms-paste-field.tsx";
