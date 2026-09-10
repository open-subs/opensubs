/**
 * Provider marks for the sign-in buttons.
 *
 * The design system says never to inline hand-drawn SVG and always to use
 * the Lucide `Icon` component. These are the documented exception, for two
 * reasons: Lucide carries no third-party brand marks, and Google's sign-in
 * branding requires its own G rather than a lookalike. A brand mark is not
 * an icon — it is somebody else's trademark, and redrawing it in a house
 * style is both wrong and, for Google, non-compliant.
 *
 * Inlining is also the only delivery that works everywhere the SDK has to
 * run: Manifest V3 blocks remote images, so an extension could not fetch
 * these from a CDN.
 *
 * Marks keep their own colours and are never re-tinted — the system already
 * carves out that exception for app marks and status glyphs. They render at
 * 16px, the button icon size.
 */
import { type SVGTemplateResult } from "lit";
/**
 * Google's official four-colour G, at its published geometry.
 *
 * Reproduced exactly rather than approximated: the identity guidelines
 * require the real mark, and a hand-drawn G is the kind of detail that makes
 * a sign-in page look like a phishing page.
 */
export declare const googleMark: SVGTemplateResult;
/**
 * The Ethereum diamond.
 *
 * Pure geometry — two stacked octahedron projections — so it reproduces
 * exactly rather than approximately. The facet shading is opacity on one
 * mark colour, which is how the official asset is built, and it means the
 * mark reads correctly on both light and dark surfaces.
 */
export declare const ethereumMark: SVGTemplateResult;
/**
 * The Nostr nostrich, from SovrynMatt/Nostr-Website-Button-Design.
 *
 * That repository publishes the mark as raster only — PNG and JPEG, no SVG
 * in the tree — so this is a vector trace of the published purple nostrich,
 * verified at 0.976 IoU against the source silhouette. The colour is the
 * asset's own #9C59FF, sampled rather than guessed.
 *
 * Licence: the repository states "Nostr is Freedom Open Source Software
 * (FOSS). And so is everything in this repository. Feel free to use whatever
 * you like ... use them on your websites."
 */
export declare const nostrMark: SVGTemplateResult;
//# sourceMappingURL=provider-marks.d.ts.map