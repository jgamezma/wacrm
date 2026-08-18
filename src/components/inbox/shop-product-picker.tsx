"use client";

// ============================================================
// Inbox product picker + draft suggestions (SGC & IdeasLab fork).
//
// Two ways an agent puts a product from the connected shop into a thread:
//   - `ShopProductPicker` — search the synced catalog and send one.
//   - `ShopProductSuggestions` — the products the AI draft retrieved, offered
//     inline so the agent doesn't have to search for what the model already found.
//
// Both hand the caller the same two choices, "send as text" and "send with
// image", and the image action is simply unavailable when a product has no
// photo. Neither component sends anything itself: the caller reuses the
// composer's existing text / media send paths, so a product message is stored
// and rendered like any other outbound.
//
// The caption is built server-side and used verbatim, so price and availability
// wording never diverges between the AI's cards and an agent's manual send.
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.6, US-6
// ============================================================

import { useEffect, useState } from "react";
import { Image as ImageIcon, Loader2, Package, Type, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Client-safe product shape returned by the shop endpoints. */
export interface ShopProductSuggestion {
  id: string;
  title: string;
  image_url: string | null;
  /** Exactly what will be sent as text, or used as the image caption. */
  caption: string;
}

interface ProductActionsProps {
  product: ShopProductSuggestion;
  onSendText: (product: ShopProductSuggestion) => void;
  onSendImage: (product: ShopProductSuggestion) => void;
}

/** The two send affordances, shared by the dialog and the suggestion row. */
function ProductActions({ product, onSendText, onSendImage }: ProductActionsProps) {
  const t = useTranslations("Inbox.products");
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onSendText(product)}
        title={t("sendAsText")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
      >
        <Type className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onSendImage(product)}
        disabled={!product.image_url}
        title={product.image_url ? t("sendWithImage") : t("noImage")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

interface ShopProductPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendText: (product: ShopProductSuggestion) => void;
  onSendImage: (product: ShopProductSuggestion) => void;
}

/** Search the account's synced catalog and send a product into the thread. */
export function ShopProductPicker({
  open,
  onOpenChange,
  onSendText,
  onSendImage,
}: ShopProductPickerProps) {
  const t = useTranslations("Inbox.products");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ShopProductSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced so typing doesn't fire a request per keystroke. An empty query is
  // a valid search — it lists the first page of the catalog.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/extensions/shop/products?q=${encodeURIComponent(query)}`,
            { cache: "no-store" },
          );
          const data = await res.json().catch(() => ({}));
          if (!cancelled && res.ok) {
            setItems((data.products as ShopProductSuggestion[]) ?? []);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          autoFocus
        />
        <div className="max-h-[55vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((product) => (
                <li
                  key={product.id}
                  className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5"
                >
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {product.title}
                    </span>
                    <span className="block whitespace-pre-line text-xs text-muted-foreground">
                      {product.caption}
                    </span>
                  </span>
                  <ProductActions
                    product={product}
                    onSendText={onSendText}
                    onSendImage={onSendImage}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ShopProductSuggestionsProps {
  products: ShopProductSuggestion[];
  onSendText: (product: ShopProductSuggestion) => void;
  onSendImage: (product: ShopProductSuggestion) => void;
  onDismiss: () => void;
}

/**
 * Products the AI draft was grounded in, offered above the composer. Sending is
 * always the human's call here — the draft path never auto-sends an image.
 */
export function ShopProductSuggestions({
  products,
  onSendText,
  onSendImage,
  onDismiss,
}: ShopProductSuggestionsProps) {
  const t = useTranslations("Inbox.products");
  if (products.length === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/40 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t("suggested")}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          title={t("dismiss")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {products.map((product) => (
          <li key={product.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {product.title}
            </span>
            <ProductActions
              product={product}
              onSendText={onSendText}
              onSendImage={onSendImage}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
