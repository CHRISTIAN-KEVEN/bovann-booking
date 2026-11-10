import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGES_EN } from './messages-en';

/**
 * Every French sentence the API can send (error messages, validation messages) needs an English
 * version, or English pages would show French. Messages built with values are written in both
 * languages where they are thrown, so this check covers plain texts.
 */
const SKIP = /\.spec\.ts$|messages-en\.ts$|templates\.ts$|receipt\.ts$|seed\.ts$|migrations/;
const FRENCH = /[éèàùçêâîôœ’]|\b(le|la|les|un|une|des|du|est|pas|vous|votre)\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('English API messages', () => {
  it('has an English version of every French message', () => {
    const missing = new Set<string>();
    for (const file of files(join(__dirname, '..')).filter((f) => !SKIP.test(f))) {
      const source = readFileSync(file, 'utf8');
      for (const [, text] of source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
        const sentence = /[a-zà-ÿ]{2,} [a-zà-ÿ]/.test(text!) && /[.?!)]$/.test(text!);
        if (sentence && FRENCH.test(text!) && !MESSAGES_EN[text!]) missing.add(text!);
      }
    }
    // Simulated payment instructions are chosen by language in the mock provider itself.
    missing.delete('Paiement par carte simulé.');
    expect([...missing]).toEqual([]);
  });
});
