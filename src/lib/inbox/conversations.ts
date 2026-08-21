import type { Conversation, Contact, ConversationLabel, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags and the
 * conversation's labels, so the Inbox can filter by contact tag or label
 * without a second round-trip. `contact_tags(tags(*))` and
 * `conversation_labels(label:conversation_labels_def(*))` return the join
 * rows; {@link normalizeConversation} flattens them onto
 * `contact.tags` / `labels`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*))), conversation_labels(label:conversation_labels_def(*))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact" | "labels"> & {
  contact?: RawContact | null;
  conversation_labels?: { label: ConversationLabel | null }[];
};

/**
 * Flatten the embedded joins into `contact.tags` and `labels`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const { conversation_labels, ...rest } = raw;
  const labels = (conversation_labels ?? [])
    .map((cl) => cl.label)
    .filter((l): l is ConversationLabel => l != null && !l.deleted);

  const rawContact = rest.contact;
  if (!rawContact) {
    return { ...rest, labels } as Conversation;
  }

  const { contact_tags, ...contact } = rawContact;
  return {
    ...rest,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
    labels,
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
  /** Label ids; a conversation matches if it carries ANY of them (OR).
   *  Optional so existing callers without label filtering keep working. */
  labelIds?: string[];
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds`, empty `labelIds` and null `company` are no-ops, so the
 * default (no filters) always matches. Tags use OR logic, consistent with
 * Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company, labelIds }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (labelIds && labelIds.length > 0) {
    const conversationLabels = conversation.labels ?? [];
    if (!conversationLabels.some((l) => labelIds.includes(l.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
