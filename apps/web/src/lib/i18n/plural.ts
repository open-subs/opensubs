/**
 * Plural forms for the catalogues that need more than English's two.
 *
 * The English keys come in pairs ("{n} cue" / "{n} cues") and the call site
 * picks one by `n === 1`. That serves every language with no grammatical
 * number, or one that splits at one. Russian has three forms and does not
 * split at one: 1 and 21 take one form ("кредит"), 2-4 and 22-24 another
 * ("кредита"), 5-20 and 25-30 a third ("кредитов"). So a Russian value
 * holds its forms separated by "|", and this picks one by the count.
 *
 * A file of its own, with no imports, so the i18n test can load it in Node.
 */

/**
 * The CLDR categories a value's "|"-separated forms stand for, in order.
 * Russian's fourth category, `other`, is only fractions ("1,5"), which take
 * the genitive singular -- the `few` form.
 */
const PLURAL_FORMS: Record<string, readonly string[]> = {
  ru: ["one", "few", "many"],
};
const PLURAL_FALLBACK: Record<string, string> = { other: "few" };

/**
 * One of `forms` ("a|b|c") for the count in `vars`: `n` if there is one,
 * else the only numeric var. With no count, or a locale with no forms
 * declared, the last form.
 */
export function pluralForm(
  forms: string,
  locale: string,
  vars?: Record<string, string | number>,
): string {
  const list = forms.split("|");
  const order = PLURAL_FORMS[locale];
  const numbers = vars ? Object.values(vars).filter((v): v is number => typeof v === "number") : [];
  const n = typeof vars?.n === "number" ? vars.n : numbers.length === 1 ? numbers[0] : undefined;
  if (!order || n === undefined) return list[list.length - 1];
  const category = new Intl.PluralRules(locale).select(n);
  let i = order.indexOf(category);
  if (i < 0) i = order.indexOf(PLURAL_FALLBACK[category] ?? "");
  return list[i] ?? list[list.length - 1];
}
