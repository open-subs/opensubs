/**
 * The account elements in Russian: <openapps-account> (and the part of it
 * loaded on demand), <openapps-buy>, <openapps-credits>, <openapps-history>,
 * <openapps-signout>, and the shared error wording in base.ts.
 *
 * These elements speak through the catalogue seam (`catalogue.ts`): the
 * English text is the key, and no catalogue is bundled, so a host that is in
 * Russian hands this one over:
 *
 * ```ts
 * import { addCatalogue, setLocale } from "@openapps/ui";
 * const { default: ru } = await import("@openapps/ui/catalogues/ru");
 * addCatalogue("ru", ru);
 * setLocale("ru");
 * ```
 *
 * The sign-in box is different: it carries its own Russian (locales/ru.ts)
 * and follows <html lang>.
 *
 * First written for OpenSubs and OpenPixels (18 Nov), which each
 * still carry a copy (apps/web/src/lib/i18n/account-ru.ts,
 * apps/web/src/lib/locales/account-ru.js); this is the one to change.
 *
 * «вы» lower-case, «аккаунт», «кредиты», as on the products' Russian pages.
 * A value with "|" holds the three Russian plural forms (1 кредит,
 * 2 кредита, 5 кредитов); t() picks one by the number it is given.
 * Elsewhere a count goes after a colon, so nothing has to agree with it.
 */
declare const catalogue: Record<string, string>;
export default catalogue;
//# sourceMappingURL=ru.d.ts.map