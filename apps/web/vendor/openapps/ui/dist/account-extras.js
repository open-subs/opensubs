/**
 * The parts of `<openapps-account>` that most accounts never see: what a
 * member's balance is made of, the step before a Nostr link, what
 * disconnecting a member's OnWallet ID costs, and a refused link said in
 * parts.
 *
 * A module of its own, fetched on demand. `openapps-ui.js` is downloaded by
 * every page that uses any element, and its size is budgeted
 * (`build-bundle.mjs`); a few thousand members' credits and a refusal that
 * happens once in an account's life should not be paid for by every visitor
 * to every product. The element imports this when the account it is showing
 * could need it, or at the click that does.
 *
 * Functions, not a class: they draw from what they are handed and call back
 * through the handlers they are given. The element keeps all the state.
 */
import { css, html, nothing } from "lit";
import { OpenAppsError } from "@openapps/sdk";
import { day, middle, moment, num, percent, utc } from "./account-format.js";
import { formatNumber, t } from "./catalogue.js";
/*
 * Build shape, not behaviour. esbuild groups shared code by the set of
 * entry points that reach it. Every element reaches `base.ts`; if this
 * chunk did not, the runtime every page downloads would be cut in two —
 * what this chunk shares with the elements, and what it does not — and the
 * two halves together gzip about 500 bytes larger than the whole. Reaching
 * `base.ts` from here keeps it one chunk, so the cheapest element
 * (`<openapps-credits>`) costs what it did before this module existed.
 */
export { describe as describeError } from "./base.js";
/**
 * What the balance is made of, for an account that holds member credits
 * or is a member who could.
 *
 * Drawn only when the server says (`purchased` is in the answer); a server
 * with member credits off answers the one number and this is nothing.
 */
export function renderCredits(me, credits, again) {
    return html `${renderNotShared(me, again)}${renderTickReminder(me)}${creditsSection(me, credits)}`;
}
/**
 * Beside "Confirm": the confirmation is a connect, and the wallet's connect
 * window has a membership line that can be off: on a first connect it
 * starts off, afterwards it starts from the member's last choice. A member
 * who confirms with it off has confirmed nothing, so it is said here,
 * without saying where the line starts.
 */
function renderTickReminder(me) {
    if (!me.membership?.needs_confirmation)
        return nothing;
    return html `<p class="small oa-tick" role="note">
    ${t("When you confirm, check that the Genesis member line is on in OnWallet. Confirming with it off keeps things as they are.")}
  </p>`;
}
/**
 * An OnWallet ID is connected and the account has no membership. What the
 * server says the latest approval said decides which of two notices:
 *
 * - `not_shared`: nothing was said. The wallet's membership line starts
 *   off on a first connect, so a member who approves without looking gets exactly this; it has
 *   to be said, with the way to put it right, or it looks like a fault. It
 *   is also what someone who is not a member and said nothing sees, so it
 *   does not say they are one.
 * - `not_member`: OnWallet answered that this ID is not a member. Said
 *   plainly and quietly, with no urging to connect again. The same answer
 *   comes from someone who never was a member and from someone who no
 *   longer is, so nothing here speaks of a membership ending. One small
 *   link stays, for the person who becomes a member later: without it the
 *   page would have no way to ask again.
 *
 * The wallet's line is not quoted word for word: its wording is the
 * wallet's, and changes with it.
 */
function renderNotShared(me, again) {
    const hint = me.membership_hint;
    if (hint !== "not_shared" && hint !== "not_member")
        return nothing;
    const tag = me.openwallet_connect_tag;
    const tagLine = again && typeof tag === "string" && /^[0-9A-HJKMNP-TV-Z]{6}$/.test(tag)
        ? html `<p class="small oa-tag">
          ${t("Connect in OnWallet only if it shows this tag:")}<code>${tag}</code>
        </p>`
        : nothing;
    if (hint === "not_member") {
        return html `
      <div class="oa-callout oa-notmember" role="status">
        <p>
          ${t("Connected. OnWallet answered that this OnWallet ID is not a Genesis member, so there are no member perks on this account.")}
        </p>
        ${again
            ? html `<p class="small">
                ${t("If that changes, you can ask again from here.")}
                <button class="link" @click=${again}>${t("Ask again")}</button>
              </p>
              ${tagLine}`
            : nothing}
      </div>
    `;
    }
    return html `
    <div class="oa-callout oa-callout--warning oa-notshared" role="status">
      <p>
        <strong
          >${t("Connected. No Genesis membership was shared, so member perks are off.")}</strong
        >
      </p>
      <p class="small">
        ${t("If you are a Genesis member, connect again with the Genesis member line turned on in OnWallet.")}
      </p>
      ${again
        ? html `<div class="row"><button @click=${again}>${t("Connect again")}</button></div>`
        : nothing}
      ${tagLine}
    </div>
  `;
}
function creditsSection(me, credits) {
    if (!credits || typeof credits.purchased !== "number")
        return nothing;
    const granted = credits.granted ?? 0;
    const grant = credits.member_grant ?? null;
    const member = !!me.membership;
    if (!member && granted === 0 && !grant)
        return nothing;
    const lapses = credits.expiring?.length
        ? credits.expiring
        : credits.granted_expires_at && granted > 0
            ? [{ amount: granted, expires_at: credits.granted_expires_at }]
            : [];
    const reason = grant ? null : (credits.no_grant_reason ?? null);
    const why = member && reason ? noGrantSentence(me, reason) : null;
    return html `
    <div class="oa-section oa-credits">
      <h3>${t("Credits this month")}</h3>
      <dl class="oa-split">
        <div>
          <dt>${t("Bought or earned")}</dt>
          <dd class="mono">${num(credits.purchased)}</dd>
          <dd class="oa-note">${t("These do not lapse.")}</dd>
        </div>
        <div>
          <dt>${t("Member credits")}</dt>
          <dd class="mono">${num(granted)}</dd>
          <dd class="oa-note">
            ${lapses.length
        ? lapses.map((lapse) => html `<span class="oa-lapse"
                      >${lapses.length > 1 ? html `${num(lapse.amount)} · ` : nothing}${t("lapse on")}
                      <time
                        datetime=${new Date(lapse.expires_at * 1000).toISOString()}
                        title=${utc(lapse.expires_at)}
                        >${moment(lapse.expires_at)}</time
                      ></span
                    >`)
        : t("None at the moment.")}
          </dd>
        </div>
      </dl>
      ${grant
        ? html `<p class="small oa-grant">
              ${t("Granted this month at level “{level}”: {granted}. Left: {remaining}.", {
            level: grant.level,
            granted: num(grant.granted),
            remaining: num(grant.remaining),
        })}
            </p>
            ${grant.scaled
            ? html `<p class="small oa-scaled">
                  ${t("This month’s grant is {percent} of the usual {nominal} credits, because the month’s budget for member credits was reached.", { percent: percent(grant.scale_ppm), nominal: num(grant.nominal) })}
                </p>`
            : nothing}`
        : nothing}
      ${why ? html `<p class="small oa-no-grant">${why}</p>` : nothing}
      ${granted > 0
        ? html `<p class="muted small">
            ${t("Member credits are spent first. What is left when the month ends is not carried over.")}
          </p>`
        : nothing}
    </div>
  `;
}
/**
 * Why a member has no credits this month, in a sentence.
 *
 * Each is about this account and the OnWallet ID on it. In particular
 * `waiting_after_move` says when credits start here and nothing about
 * where the ID was before.
 */
function noGrantSentence(me, reason) {
    const membership = me.membership;
    switch (reason) {
        case "not_member":
            return membership?.needs_confirmation
                ? t("No member credits yet: sign in with OnWallet again to confirm your membership.")
                : t("No member credits: this account’s membership is not confirmed.");
        case "disabled":
            return t("Member credits are not being issued at the moment.");
        case "waiting_after_move":
            return membership && !membership.benefits_active && !membership.needs_confirmation
                ? t("No member credits yet: your OnWallet ID was connected to this account recently. They start here after {date}.", { date: day(membership.benefits_from) })
                : t("No member credits here this month: your OnWallet ID was connected to this account recently. They start with next month’s.");
        case "budget_exhausted":
            return t("No member credits this month: the month’s budget for member credits was used up before yours were issued.");
        case "month_not_run":
            return t("This month’s member credits have not been issued yet.");
        case "inactive":
            return t("No member credits this month: they go to accounts that were in use when the month’s credits were issued. Using any of our apps with this account counts.");
        default:
            return t("No member credits this month.");
    }
}
/**
 * An account with no Nostr key whose OnWallet ID shares one: offer to
 * use it. The shared npub is only what is displayed — the link itself is
 * made by signing with the key.
 */
export function renderOpenwalletNostrOffer(claim, busy, use) {
    return html `
    <div class="oa-section oa-nostr-offer">
      <h3>${t("Nostr key")}</h3>
      <p class="small">
        ${t("This account has no Nostr key, so apps that sync under one have nothing to use yet. Your OnWallet ID has this one:")}
      </p>
      <code class="oa-key" title=${claim}>${claim}</code>
      <div class="row">
        <button ?disabled=${busy} @click=${use}>${t("Use my OnWallet Nostr key")}</button>
      </div>
      <p class="muted small">
        ${t("You will be asked to sign once with it, to prove it is yours. Nothing is linked until you have seen which key signs.")}
      </p>
    </div>
  `;
}
/** The step before any Nostr link: this key will sign. */
export function renderNostrPreview(preview, busy, error, on) {
    const other = preview.claim !== null && preview.claim !== preview.key.npub;
    const stop = other && preview.purpose === "openwallet";
    return html `
    <div class="oa-card card" role="group" aria-label=${t("Link a Nostr key")}>
      <h3>${stop ? t("A different Nostr key answered") : t("Link this Nostr key?")}</h3>
      <p class="small">${t("This key will sign, and it is the key that would be linked:")}</p>
      <code class="oa-key" title=${preview.key.npub}>${preview.key.npub}</code>
      ${other
        ? html `<div class="oa-callout oa-callout--warning" role="alert">
            <p>
              <strong>${t("This is not your OnWallet ID’s key.")}</strong>
              ${t("Another Nostr extension in this browser answered instead of OnWallet.")}
            </p>
            <p class="small">${t("Your OnWallet ID’s key is:")}</p>
            <code class="oa-key" title=${preview.claim ?? ""}>${preview.claim}</code>
            <p class="small">
              ${stop
            ? t("Nothing was linked. To use your OnWallet key, switch the other Nostr extension off for this site, reload, and try again.")
            : t("If you go on, apps will use the key at the top for this account, not your OnWallet one.")}
            </p>
          </div>`
        : preview.claim !== null
            ? html `<p class="small oa-match">${t("It is your OnWallet ID’s Nostr key.")}</p>`
            : html `<p class="muted small">
              ${t("If this is not the key you expected, another Nostr extension answered. Cancel, switch it off for this site, and try again.")}
            </p>`}
      <p class="muted small">
        ${t("An account has one Nostr key. Apps keep data under it, and it is not replaced later.")}
      </p>
      <div class="row">
        ${stop
        ? html `<button ?disabled=${busy} @click=${on.retry}>${t("Try again")}</button>`
        : html `<button class="primary" ?disabled=${busy} @click=${on.link}>
              ${other ? t("Link this key anyway") : t("Link this key")}
            </button>`}
        <button ?disabled=${busy} @click=${on.cancel}>${t("Cancel")}</button>
      </div>
      ${error ? html `<p class="error" role="alert">${error}</p>` : nothing}
    </div>
  `;
}
/**
 * Merges that are waiting. The account that would be absorbed is shown it
 * as what it is — someone has asked to take this account into theirs — with
 * the one button that matters. Nothing has moved while this is on screen.
 */
export function renderPendingMerges(merges, busy, cancel) {
    return html `${merges.map((merge) => merge.role === "absorbed"
        ? html `<div class="oa-callout oa-callout--warning oa-pending-merge" role="alert">
          <p>
            <strong>${t("Another account has asked to combine with this one.")}</strong>
            ${merge.via
            ? t("It was asked for with your {name} sign-in ({label}).", {
                name: merge.via.name,
                label: middle(merge.via.label),
            })
            : nothing}
          </p>
          <p class="small">
            ${t("Nothing has moved. Unless it is cancelled, on {date} this account is folded into that one: its credits and membership move there, and it can then be opened with that account’s sign-in methods as well as yours.", { date: moment(merge.effective_at) })}
          </p>
          <p class="small">
            ${t("If you did not ask for this, cancel it, and change the password of the sign-in it was asked with.")}
          </p>
          <div class="row">
            <button ?disabled=${busy} @click=${() => cancel(merge.id)}>${t("Cancel it")}</button>
          </div>
        </div>`
        : html `<div class="oa-section oa-pending-merge">
          <p class="small">
            ${t("You asked to combine another account with this one. It happens on {date}; until then nothing moves, and either account can cancel.", { date: moment(merge.effective_at) })}
          </p>
          <button class="link" ?disabled=${busy} @click=${() => cancel(merge.id)}>
            ${t("Cancel combining")}
          </button>
        </div>`)}`;
}
/** What disconnecting a member's OnWallet ID costs, before it is done. */
export function renderUnlinkConfirm(_account, granted, busy, on) {
    return html `
    <div class="oa-card card" role="alertdialog" aria-label=${t("Disconnect OnWallet")}>
      <h3>${t("Disconnect OnWallet from this account?")}</h3>
      <p class="small">
        ${t("Genesis member benefits come with your OnWallet ID, so they end on this account.")}
      </p>
      ${granted > 0
        ? html `<p class="small">
            ${t("What is left of this month’s member credits — {credits} — lapses now.", {
            credits: num(granted),
        })}
          </p>`
        : nothing}
      <p class="muted small">
        ${t("Connected to a different account afterwards, your OnWallet ID waits before benefits start there. Your OnWallet ID itself is not changed.")}
      </p>
      <div class="row">
        <button ?disabled=${busy} @click=${on.cancel}>${t("Cancel")}</button>
        <button class="danger" ?disabled=${busy} @click=${on.confirm}>
          ${t("Disconnect OnWallet")}
        </button>
      </div>
    </div>
  `;
}
/**
 * A link that cannot go through, said so that the person knows what is in
 * the way, on which side, and what giving it up costs.
 */
export function renderRefusal(refusal) {
    if (refusal.kind === "taken") {
        const nostr = refusal.namespace === "nostr";
        return html `
      <div class="oa-callout oa-callout--warning warn" role="alert">
        <p>
          <strong
            >${t("This account already has a {name} sign-in.", { name: refusal.name })}</strong
          >
          ${t("An account has one of each kind.")}
        </p>
        ${sides([
            [t("On this account"), refusal.linked],
            [t("The one you tried to connect"), refusal.offered],
        ])}
        <p class="small">
          ${nostr
            ? t("A Nostr key is not replaced: apps keep data under it, and that data can be read only with that key. To keep using your current key, do nothing. To use the other one here, disconnect the current key first — what is stored under it stays readable only by signing in with it.")
            : t("To connect the other one, disconnect the {name} sign-in that is here first.", {
                name: refusal.name,
            })}
        </p>
      </div>
    `;
    }
    return html `
    <div class="oa-callout oa-callout--warning warn" role="alert">
      <p>
        <strong>${t("These two accounts cannot be combined yet.")}</strong>
        ${t("Both have the same kind of sign-in, and an account has one of each kind.")}
      </p>
      ${refusal.blocking.map((clash) => html `
          <div class="oa-clash">
            <p class="small"><strong>${clash.name}</strong></p>
            ${sides([
        [t("On this account"), clash.this_account],
        [t("On the other account"), clash.other_account],
    ])}
            <p class="small">
              ${clash.data_depends_on_it
        ? t("Apps keep data under a {name} key, and it can be read only with that key. Keep the key your data is under and disconnect the other one. Nothing is deleted: data under the disconnected key stays where it is, readable by signing in with that key.", { name: clash.name })
        : t("Disconnect {name} on one side: here, with Disconnect beside it in the list below (an account's only sign-in method cannot be removed, so connect another one first if it is the only one here), or sign in to the other account and disconnect it there.", { name: clash.name })}
            </p>
          </div>
        `)}
      <p class="small">${t("Then connect again, and the two accounts can be combined.")}</p>
    </div>
  `;
}
function sides(list) {
    return html `<dl class="oa-sides">
    ${list.map(([where, identity]) => identity
        ? html `<div>
            <dt>${where}</dt>
            <dd>
              <code title=${identity.caip10}>${middle(identity.label ?? identity.caip10)}</code>
            </dd>
          </div>`
        : nothing)}
  </dl>`;
}
/**
 * A refusal the server words for developers, reworded for the person.
 * Anything not known here is passed through as it came.
 */
export function explained(error) {
    if (!(error instanceof OpenAppsError))
        return error;
    const detail = error.detail ?? {};
    switch (detail.code) {
        case "last_sign_in_method":
            return new Error(t("This is the only way into this account, so it cannot be removed. Connect another sign-in method first."));
        case "recently_connected_method": {
            const at = typeof detail.removable_at === "number" ? detail.removable_at : null;
            return new Error(at
                ? t("A sign-in method was connected to this account recently. Until {date} the older methods cannot be removed; the new one can.", { date: day(at) })
                : t("A sign-in method was connected to this account recently, so the older methods cannot be removed yet. The new one can."));
        }
        case "reauth_required":
            return new Error(t("For this change, sign in again first — with any method already on this account."));
        case "signed_by_a_different_key":
            return new Error(DIFFERENT_KEY());
        case "merge_via_new_method": {
            const at = typeof detail.retry_at === "number" ? detail.retry_at : null;
            return new Error(at
                ? t("That sign-in was connected to its account too recently to combine accounts with. Try again after {date}, or connect one of that account’s older sign-in methods instead.", { date: day(at) })
                : t("That sign-in was connected to its account too recently to combine accounts with. Connect one of that account’s older sign-in methods instead."));
        }
        default:
            return error;
    }
}
/** Said when the second signature of a merge comes from somewhere else. */
export const DIFFERENT_WALLET = () => t("A different wallet or address answered than the one you were asked about. Nothing was combined.");
export const MERGE_CANCELLED = () => t("Cancelled. The two accounts stay separate.");
/** After consenting to a merge that waits: it has not happened. */
export const mergeHeld = (effectiveAt) => t("Not combined yet. The other account has been in use for a while, so its owner is given until {date} to cancel; both accounts have been told. Nothing moves until then.", { date: day(effectiveAt) });
/** Before consenting to one: it will not happen at once. */
export const mergeWillWait = (secs) => t("It will not happen at once. That account has been in use for a while, so its owner is told and has {days} days to cancel; nothing moves until then.", { days: Math.max(1, Math.round(secs / 86400)) });
/** Said by the page and by the server's refusal alike. */
export const DIFFERENT_KEY = () => t("A different Nostr key signed than the one you were shown. Nothing was linked.");
/**
 * What agents may spend, for an account with an OnWallet ID — the only
 * accounts an agent can reach; nobody else makes the request. A failure
 * costs the section, never the panel.
 */
export async function loadDelegation(sdk, me) {
    if (!me.linked_accounts.some((a) => a.namespace === "openwallet"))
        return null;
    try {
        return await sdk.delegation();
    }
    catch {
        return null;
    }
}
/** One credit is half a cent: 200 credits is $1. */
function dollars(credits) {
    const usd = credits / 200;
    return formatNumber(usd, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: Number.isInteger(usd) ? 0 : 2,
    });
}
/**
 * What agents the person approves in OnWallet may spend from this account's
 * credits, through the /connect gateway. Connecting OnWallet sets 200
 * credits ($1) a day and 50 a run; the person changes or turns it off here
 * at any time.
 */
export function renderDelegation(element) {
    const host = element;
    const view = host.deleg;
    if (!view?.onwallet_linked)
        return nothing;
    const busy = host.busy;
    const act = async (kind, limits) => {
        if (kind === "edit" || kind === "cancel") {
            host.deleg = { ...view, editing: kind === "edit" };
        }
        else {
            const next = await host.run(() => host.sdk.delegation(kind === "revoke" ? "DELETE" : "PUT", limits ?? {}));
            if (next)
                host.deleg = next;
        }
        host.requestUpdate();
    };
    const d = view.delegation;
    if (view.editing && d) {
        const read = (form, name) => Number.parseInt(form.elements.namedItem(name).value, 10);
        return html `<section class="oa-deleg" aria-label=${t("What agents may spend")}>
      <h3>${t("What agents may spend")}</h3>
      <form
        @submit=${(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void act("save", {
                per_day_credits: read(form, "per_day"),
                per_run_credits: read(form, "per_run"),
            });
        }}
      >
        <label class="oa-field"
          >${t("Credits a day (200 credits is $1)")}
          <input
            name="per_day"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            .value=${String(d.per_day_credits)}
          />
        </label>
        <label class="oa-field"
          >${t("Credits on one run")}
          <input
            name="per_run"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            .value=${String(d.per_run_credits)}
          />
        </label>
        <div class="row">
          <button type="submit" ?disabled=${busy}>${t("Save")}</button>
          <button type="button" ?disabled=${busy} @click=${() => act("cancel")}>
            ${t("Cancel")}
          </button>
        </div>
      </form>
    </section>`;
    }
    let body;
    if (!d) {
        body = html `<p>
        ${t("Let agents you approve in OnWallet spend up to {credits} credits ({usd}) a day from your credits?", {
            credits: num(view.defaults.per_day_credits),
            usd: dollars(view.defaults.per_day_credits),
        })}
      </p>
      <div class="row">
        <button ?disabled=${busy} @click=${() => act("allow")}>${t("Allow")}</button>
      </div>`;
    }
    else if (d.revoked_at) {
        body = html `<p>${t("Agents can't spend your credits: you turned this off.")}</p>
      <div class="row">
        <button ?disabled=${busy} @click=${() => act("allow")}>${t("Turn on again")}</button>
      </div>`;
    }
    else {
        body = html `<p>
        ${t("Agents you approve in OnWallet can spend up to {credits} credits ({usd}) a day from your credits.", { credits: num(d.per_day_credits), usd: dollars(d.per_day_credits) })}
        <button class="link" ?disabled=${busy} @click=${() => act("edit")}>${t("Change")}</button>
      </p>
      <p class="muted small">
        ${t("Up to {run} credits on one run. Used in the last 24 hours: {used}.", {
            run: num(d.per_run_credits),
            used: num(d.used_today),
        })}
        <button class="link" ?disabled=${busy} @click=${() => act("revoke")}>
          ${t("Turn off")}
        </button>
      </p>`;
    }
    return html `<section class="oa-deleg" aria-label=${t("What agents may spend")}>
    <h3>${t("Agents")}</h3>
    ${body}
  </section>`;
}
export const extrasStyles = css `
  /* ---- what agents may spend ---- */
  .oa-field {
    display: block;
    margin: 0 0 var(--space-2, 8px);
    font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
    color: var(--text-muted, var(--fb-muted));
  }
  .oa-field input {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin-top: var(--space-1, 4px);
    padding: var(--space-2, 8px);
    font: inherit;
    font-size: var(--text-sm, 14px);
    color: var(--text-strong, var(--fb-strong));
    background: var(--bg-surface, var(--fb-surface, transparent));
    border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
    border-radius: var(--radius-md, 8px);
  }

  /* ---- what the balance is made of ---- */
  .oa-split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-2, 8px);
    margin: 0;
  }
  .oa-split > div {
    border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
    border-radius: var(--radius-md, 8px);
    background: var(--bg-subtle, var(--fb-subtle));
    padding: var(--space-3, 12px);
    min-width: 0;
  }
  .oa-split dt {
    font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
    color: var(--text-muted, var(--fb-muted));
  }
  .oa-split dd {
    margin: 0;
  }
  .oa-split dd.mono {
    font-size: var(--text-lg, 20px);
    line-height: 1.3;
    color: var(--text-strong, var(--fb-strong));
  }
  .oa-note {
    font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
    color: var(--text-muted, var(--fb-muted));
  }
  .oa-lapse {
    display: block;
  }

  /* ---- a key shown whole, because it is being agreed to ---- */
  .oa-key {
    display: block;
    overflow-wrap: anywhere;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
    border-radius: var(--radius-md, 8px);
    background: var(--bg-subtle, var(--fb-subtle));
    font-size: var(--text-xs, 12px);
    line-height: 1.5;
  }
  .oa-callout .oa-key {
    background: var(--surface-card, var(--fb-card));
    color: var(--text-strong, var(--fb-strong));
  }

  /* ---- the two sides of a refused link ---- */
  .oa-sides {
    display: grid;
    gap: var(--space-1, 4px);
    margin: var(--space-2, 8px) 0;
  }
  .oa-sides > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px) var(--space-2, 8px);
    align-items: baseline;
  }
  .oa-sides dt {
    font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
  }
  .oa-sides dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .oa-clash + .oa-clash {
    margin-top: var(--space-3, 12px);
  }

  /* ---- "not a member": a fact, not a warning ---- */
  .oa-notmember {
    border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
    background: var(--bg-subtle, var(--fb-subtle));
  }
`;
//# sourceMappingURL=account-extras.js.map