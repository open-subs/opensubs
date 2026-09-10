/**
 * Shared base for every OpenApps element: client resolution, session
 * subscription, and one visual language.
 *
 * Styles live in shadow DOM, so a host page's CSS cannot break them and
 * they cannot leak out. Everything themable is a custom property, which
 * *does* pierce the shadow boundary — that is the intended seam for hosts.
 */
import { LitElement } from "lit";
import type { OpenApps } from "@openapps/sdk";
export declare class OpenAppsElement extends LitElement {
    #private;
    /** Server URL, if the page did not call `configure()`. */
    baseUrl?: string;
    /** Assign a client directly when a page runs more than one server. */
    client?: OpenApps;
    protected error: string | null;
    protected busy: boolean;
    connectedCallback(): void;
    disconnectedCallback(): void;
    /** Overridden by elements that display session-dependent data. */
    protected onSessionChange(): void;
    protected get sdk(): OpenApps;
    /**
     * The client, or null if the host has not configured one yet.
     *
     * Rendering must never throw for this reason. A plain HTML page has the
     * elements in its markup and calls `configure()` from a module script
     * afterwards, so there is a window where no client exists — and
     * `configure()` calls `notify()`, which re-renders everything, so the
     * right move is to draw nothing and wait.
     */
    protected get sdkOrNull(): OpenApps | null;
    /**
     * Run an action with the busy flag set and errors turned into a message.
     * Elements never surface a raw exception: a user staring at a buy button
     * needs a sentence, not a stack trace.
     */
    protected run<T>(action: () => Promise<T>): Promise<T | undefined>;
    protected emit(type: string, detail: unknown): void;
    /**
     * Shared styles, expressed in OpenApps design tokens.
     *
     * Every value reads a semantic token with a literal fallback. The token
     * wins whenever the host has linked `@openapps/tokens`, which is what
     * keeps a themed application in control of the palette; the fallback is
     * what stops an element that was dropped into a page with no stylesheet
     * from rendering unstyled.
     *
     * Tokens are referenced at the semantic layer only — `--surface-card`,
     * never `--gray-50`. Naming a ramp entry inside a component is what makes
     * a design system un-reskinnable.
     */
    static baseStyles: import("lit").CSSResult;
}
/** Turn anything thrown into a sentence a user can act on. */
export declare function describe(cause: unknown): string;
//# sourceMappingURL=base.d.ts.map