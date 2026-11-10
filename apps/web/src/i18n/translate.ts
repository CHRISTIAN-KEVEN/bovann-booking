import type { Locale } from './config';

/** A text, or its singular/plural forms chosen with the `count` variable. */
export type Plural = { one: string; other: string };
export type MessageTree = { [key: string]: string | Plural | MessageTree };

/** Every dotted key of a message tree that leads to a text ("details.title"). */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string | Plural
    ? K
    : T[K] extends MessageTree
      ? `${K}.${MessageKey<T[K]>}`
      : never;
}[keyof T & string];

/** The same shape with every text left free, for the other languages. */
export type Translation<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? Plural : Translation<T[K]>;
};

export type Vars = Record<string, string | number>;

const isPlural = (v: unknown): v is Plural =>
  typeof v === 'object' && v !== null && 'other' in v && 'one' in v;

/**
 * Looks up `key` and fills `{name}` placeholders. A missing key returns the key itself, so a
 * mistake shows on screen instead of crashing (the types make it rare).
 */
export function translate(messages: MessageTree, locale: Locale, key: string, vars?: Vars): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as MessageTree)[part] : undefined;
  }
  let text: string;
  if (typeof node === 'string') text = node;
  else if (isPlural(node)) {
    const count = Number(vars?.count ?? 0);
    text = new Intl.PluralRules(locale).select(count) === 'one' ? node.one : node.other;
  } else return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    vars[name] === undefined ? all : String(vars[name]),
  );
}
