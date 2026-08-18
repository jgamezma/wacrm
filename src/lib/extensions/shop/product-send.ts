// ============================================================
// Product cards on WhatsApp (SGC & IdeasLab fork).
//
// One product presented as either an IMAGE + caption or plain TEXT. Which one
// is not a preference so much as a chain of conditions: the account toggle, the
// model's request, whether the product even has a photo, and — last — whether
// Meta could actually fetch that photo. Every step degrades to text rather than
// dropping the product, and no single failed card may take down the reply that
// already landed (US-3).
//
// Provider-blind: it reads the cached product shape, never a provider API.
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.5, US-3
// ============================================================

import { engineSendMedia, engineSendText } from '@/lib/flows/meta-send';

import {
  buildProductCaption,
  PRODUCT_CARD_MAX,
  type CatalogProduct,
} from './catalog';

/** How one card actually went out. `failed` means neither image nor text landed. */
export type ProductCardOutcome = 'image' | 'text' | 'failed';

export interface ProductCardResult {
  productId: string;
  outcome: ProductCardOutcome;
}

export interface SendProductCardsArgs {
  accountId: string;
  /** WhatsApp config owner, for the outbound row's audit columns. */
  userId: string;
  conversationId: string;
  contactId: string;
  products: CatalogProduct[];
  /** Account toggle ANDed with the model's request. False → text only. */
  withImages: boolean;
}

/**
 * Send up to `PRODUCT_CARD_MAX` product cards, in order.
 *
 * Never throws: the reply text has already reached the customer by the time
 * this runs, so a card failure is logged and reported, not raised. An image
 * that Meta cannot fetch (private CDN, 404, timeout) falls back to the same
 * content as text.
 */
export async function sendProductCards(
  args: SendProductCardsArgs,
): Promise<ProductCardResult[]> {
  const { accountId, userId, conversationId, contactId, withImages } = args;
  const results: ProductCardResult[] = [];

  for (const product of args.products.slice(0, PRODUCT_CARD_MAX)) {
    const caption = buildProductCaption(product);
    const canSendImage = withImages && !!product.imageUrl;

    if (canSendImage) {
      try {
        await engineSendMedia({
          accountId,
          userId,
          conversationId,
          contactId,
          kind: 'image',
          link: product.imageUrl!,
          caption,
          aiGenerated: true,
        });
        results.push({ productId: product.id, outcome: 'image' });
        continue;
      } catch (err) {
        console.error(
          `[shop product-send] image send failed for product ${product.id}; falling back to text:`,
          err,
        );
      }
    }

    try {
      await engineSendText({
        accountId,
        userId,
        conversationId,
        contactId,
        text: caption,
        aiGenerated: true,
      });
      results.push({ productId: product.id, outcome: 'text' });
    } catch (err) {
      console.error(
        `[shop product-send] text send failed for product ${product.id}:`,
        err,
      );
      results.push({ productId: product.id, outcome: 'failed' });
    }
  }

  return results;
}
