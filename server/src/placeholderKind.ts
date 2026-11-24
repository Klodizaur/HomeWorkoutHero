/**
 * What a text-only plan day is: a placeholder (a video still to pick) or an
 * activity of its own (swimming, a walk) that isn't meant to be replaced.
 * Stored as 'activity' or NULL; NULL is a placeholder, which every older day is.
 */
export type PlaceholderKind = 'placeholder' | 'activity';

export const parsePlaceholderKind = (raw: unknown): 'activity' | null => (raw === 'activity' ? 'activity' : null);

export const kindOf = (stored: unknown): PlaceholderKind => (stored === 'activity' ? 'activity' : 'placeholder');
