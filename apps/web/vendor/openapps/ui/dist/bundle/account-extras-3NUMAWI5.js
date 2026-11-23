import{B as d,C as $,D as h,E as b,F as w,G as g,a as f,n as y,o as e,p as v,r as o,t as r,y as x}from"./chunk-BGLZNXAK.js";import"./chunk-LCQWCHVU.js";function R(n,t,a){return o`${N(n,a)}${T(n)}${I(n,t)}`}function T(n){return n.membership?.needs_confirmation?o`<p class="small oa-tick" role="note">
    ${e("When you confirm, check that the Genesis member line is on in OnWallet. Confirming with it off keeps things as they are.")}
  </p>`:r}function N(n,t){let a=n.membership_hint;if(a!=="not_shared"&&a!=="not_member")return r;let s=n.openwallet_connect_tag,l=t&&typeof s=="string"&&/^[0-9A-HJKMNP-TV-Z]{6}$/.test(s)?o`<p class="small oa-tag">
          ${e("Connect in OnWallet only if it shows this tag:")}<code>${s}</code>
        </p>`:r;return a==="not_member"?o`
      <div class="oa-callout oa-notmember" role="status">
        <p>
          ${e("Connected. OnWallet answered that this OnWallet ID is not a Genesis member, so there are no member perks on this account.")}
        </p>
        ${t?o`<p class="small">
                ${e("If that changes, you can ask again from here.")}
                <button class="link" @click=${t}>${e("Ask again")}</button>
              </p>
              ${l}`:r}
      </div>
    `:o`
    <div class="oa-callout oa-callout--warning oa-notshared" role="status">
      <p>
        <strong
          >${e("Connected. No Genesis membership was shared, so member perks are off.")}</strong
        >
      </p>
      <p class="small">
        ${e("If you are a Genesis member, connect again with the Genesis member line turned on in OnWallet.")}
      </p>
      ${t?o`<div class="row"><button @click=${t}>${e("Connect again")}</button></div>`:r}
      ${l}
    </div>
  `}function I(n,t){if(!t||typeof t.purchased!="number")return r;let a=t.granted??0,s=t.member_grant??null,l=!!n.membership;if(!l&&a===0&&!s)return r;let i=t.expiring?.length?t.expiring:t.granted_expires_at&&a>0?[{amount:a,expires_at:t.granted_expires_at}]:[],p=s?null:t.no_grant_reason??null,u=l&&p?O(n,p):null;return o`
    <div class="oa-section oa-credits">
      <h3>${e("Credits this month")}</h3>
      <dl class="oa-split">
        <div>
          <dt>${e("Bought or earned")}</dt>
          <dd class="mono">${d(t.purchased)}</dd>
          <dd class="oa-note">${e("These do not lapse.")}</dd>
        </div>
        <div>
          <dt>${e("Member credits")}</dt>
          <dd class="mono">${d(a)}</dd>
          <dd class="oa-note">
            ${i.length?i.map(c=>o`<span class="oa-lapse"
                      >${i.length>1?o`${d(c.amount)} · `:r}${e("lapse on")}
                      <time
                        datetime=${new Date(c.expires_at*1e3).toISOString()}
                        title=${w(c.expires_at)}
                        >${b(c.expires_at)}</time
                      ></span
                    >`):e("None at the moment.")}
          </dd>
        </div>
      </dl>
      ${s?o`<p class="small oa-grant">
              ${e("Granted this month at level \u201C{level}\u201D: {granted}. Left: {remaining}.",{level:s.level,granted:d(s.granted),remaining:d(s.remaining)})}
            </p>
            ${s.scaled?o`<p class="small oa-scaled">
                  ${e("This month\u2019s grant is {percent} of the usual {nominal} credits, because the month\u2019s budget for member credits was reached.",{percent:$(s.scale_ppm),nominal:d(s.nominal)})}
                </p>`:r}`:r}
      ${u?o`<p class="small oa-no-grant">${u}</p>`:r}
      ${a>0?o`<p class="muted small">
            ${e("Member credits are spent first. What is left when the month ends is not carried over.")}
          </p>`:r}
    </div>
  `}function O(n,t){let a=n.membership;switch(t){case"not_member":return a?.needs_confirmation?e("No member credits yet: sign in with OnWallet again to confirm your membership."):e("No member credits: this account\u2019s membership is not confirmed.");case"disabled":return e("Member credits are not being issued at the moment.");case"waiting_after_move":return a&&!a.benefits_active&&!a.needs_confirmation?e("No member credits yet: your OnWallet ID was connected to this account recently. They start here after {date}.",{date:h(a.benefits_from)}):e("No member credits here this month: your OnWallet ID was connected to this account recently. They start with next month\u2019s.");case"budget_exhausted":return e("No member credits this month: the month\u2019s budget for member credits was used up before yours were issued.");case"month_not_run":return e("This month\u2019s member credits have not been issued yet.");case"inactive":return e("No member credits this month: they go to accounts that were in use when the month\u2019s credits were issued. Using any of our apps with this account counts.");default:return e("No member credits this month.")}}function M(n,t,a){return o`
    <div class="oa-section oa-nostr-offer">
      <h3>${e("Nostr key")}</h3>
      <p class="small">
        ${e("This account has no Nostr key, so apps that sync under one have nothing to use yet. Your OnWallet ID has this one:")}
      </p>
      <code class="oa-key" title=${n}>${n}</code>
      <div class="row">
        <button ?disabled=${t} @click=${a}>${e("Use my OnWallet Nostr key")}</button>
      </div>
      <p class="muted small">
        ${e("You will be asked to sign once with it, to prove it is yours. Nothing is linked until you have seen which key signs.")}
      </p>
    </div>
  `}function L(n,t,a,s){let l=n.claim!==null&&n.claim!==n.key.npub,i=l&&n.purpose==="openwallet";return o`
    <div class="oa-card card" role="group" aria-label=${e("Link a Nostr key")}>
      <h3>${i?e("A different Nostr key answered"):e("Link this Nostr key?")}</h3>
      <p class="small">${e("This key will sign, and it is the key that would be linked:")}</p>
      <code class="oa-key" title=${n.key.npub}>${n.key.npub}</code>
      ${l?o`<div class="oa-callout oa-callout--warning" role="alert">
            <p>
              <strong>${e("This is not your OnWallet ID\u2019s key.")}</strong>
              ${e("Another Nostr extension in this browser answered instead of OnWallet.")}
            </p>
            <p class="small">${e("Your OnWallet ID\u2019s key is:")}</p>
            <code class="oa-key" title=${n.claim??""}>${n.claim}</code>
            <p class="small">
              ${i?e("Nothing was linked. To use your OnWallet key, switch the other Nostr extension off for this site, reload, and try again."):e("If you go on, apps will use the key at the top for this account, not your OnWallet one.")}
            </p>
          </div>`:n.claim!==null?o`<p class="small oa-match">${e("It is your OnWallet ID\u2019s Nostr key.")}</p>`:o`<p class="muted small">
              ${e("If this is not the key you expected, another Nostr extension answered. Cancel, switch it off for this site, and try again.")}
            </p>`}
      <p class="muted small">
        ${e("An account has one Nostr key. Apps keep data under it, and it is not replaced later.")}
      </p>
      <div class="row">
        ${i?o`<button ?disabled=${t} @click=${s.retry}>${e("Try again")}</button>`:o`<button class="primary" ?disabled=${t} @click=${s.link}>
              ${l?e("Link this key anyway"):e("Link this key")}
            </button>`}
        <button ?disabled=${t} @click=${s.cancel}>${e("Cancel")}</button>
      </div>
      ${a?o`<p class="error" role="alert">${a}</p>`:r}
    </div>
  `}function S(n,t,a){return o`${n.map(s=>s.role==="absorbed"?o`<div class="oa-callout oa-callout--warning oa-pending-merge" role="alert">
          <p>
            <strong>${e("Another account has asked to combine with this one.")}</strong>
            ${s.via?e("It was asked for with your {name} sign-in ({label}).",{name:s.via.name,label:g(s.via.label)}):r}
          </p>
          <p class="small">
            ${e("Nothing has moved. Unless it is cancelled, on {date} this account is folded into that one: its credits and membership move there, and it can then be opened with that account\u2019s sign-in methods as well as yours.",{date:b(s.effective_at)})}
          </p>
          <p class="small">
            ${e("If you did not ask for this, cancel it, and change the password of the sign-in it was asked with.")}
          </p>
          <div class="row">
            <button ?disabled=${t} @click=${()=>a(s.id)}>${e("Cancel it")}</button>
          </div>
        </div>`:o`<div class="oa-section oa-pending-merge">
          <p class="small">
            ${e("You asked to combine another account with this one. It happens on {date}; until then nothing moves, and either account can cancel.",{date:b(s.effective_at)})}
          </p>
          <button class="link" ?disabled=${t} @click=${()=>a(s.id)}>
            ${e("Cancel combining")}
          </button>
        </div>`)}`}function G(n,t,a,s){return o`
    <div class="oa-card card" role="alertdialog" aria-label=${e("Disconnect OnWallet")}>
      <h3>${e("Disconnect OnWallet from this account?")}</h3>
      <p class="small">
        ${e("Genesis member benefits come with your OnWallet ID, so they end on this account.")}
      </p>
      ${t>0?o`<p class="small">
            ${e("What is left of this month\u2019s member credits \u2014 {credits} \u2014 lapses now.",{credits:d(t)})}
          </p>`:r}
      <p class="muted small">
        ${e("Connected to a different account afterwards, your OnWallet ID waits before benefits start there. Your OnWallet ID itself is not changed.")}
      </p>
      <div class="row">
        <button ?disabled=${a} @click=${s.cancel}>${e("Cancel")}</button>
        <button class="danger" ?disabled=${a} @click=${s.confirm}>
          ${e("Disconnect OnWallet")}
        </button>
      </div>
    </div>
  `}function P(n){if(n.kind==="taken"){let t=n.namespace==="nostr";return o`
      <div class="oa-callout oa-callout--warning warn" role="alert">
        <p>
          <strong
            >${e("This account already has a {name} sign-in.",{name:n.name})}</strong
          >
          ${e("An account has one of each kind.")}
        </p>
        ${k([[e("On this account"),n.linked],[e("The one you tried to connect"),n.offered]])}
        <p class="small">
          ${t?e("A Nostr key is not replaced: apps keep data under it, and that data can be read only with that key. To keep using your current key, do nothing. To use the other one here, disconnect the current key first \u2014 what is stored under it stays readable only by signing in with it."):e("To connect the other one, disconnect the {name} sign-in that is here first.",{name:n.name})}
        </p>
      </div>
    `}return o`
    <div class="oa-callout oa-callout--warning warn" role="alert">
      <p>
        <strong>${e("These two accounts cannot be combined yet.")}</strong>
        ${e("Both have the same kind of sign-in, and an account has one of each kind.")}
      </p>
      ${n.blocking.map(t=>o`
          <div class="oa-clash">
            <p class="small"><strong>${t.name}</strong></p>
            ${k([[e("On this account"),t.this_account],[e("On the other account"),t.other_account]])}
            <p class="small">
              ${t.data_depends_on_it?e("Apps keep data under a {name} key, and it can be read only with that key. Keep the key your data is under and disconnect the other one. Nothing is deleted: data under the disconnected key stays where it is, readable by signing in with that key.",{name:t.name}):e("Disconnect {name} on one side: here, with Disconnect beside it in the list below (an account's only sign-in method cannot be removed, so connect another one first if it is the only one here), or sign in to the other account and disconnect it there.",{name:t.name})}
            </p>
          </div>
        `)}
      <p class="small">${e("Then connect again, and the two accounts can be combined.")}</p>
    </div>
  `}function k(n){return o`<dl class="oa-sides">
    ${n.map(([t,a])=>a?o`<div>
            <dt>${t}</dt>
            <dd>
              <code title=${a.caip10}>${g(a.label??a.caip10)}</code>
            </dd>
          </div>`:r)}
  </dl>`}function U(n){if(!(n instanceof f))return n;let t=n.detail??{};switch(t.code){case"last_sign_in_method":return new Error(e("This is the only way into this account, so it cannot be removed. Connect another sign-in method first."));case"recently_connected_method":{let a=typeof t.removable_at=="number"?t.removable_at:null;return new Error(a?e("A sign-in method was connected to this account recently. Until {date} the older methods cannot be removed; the new one can.",{date:h(a)}):e("A sign-in method was connected to this account recently, so the older methods cannot be removed yet. The new one can."))}case"reauth_required":return new Error(e("For this change, sign in again first \u2014 with any method already on this account."));case"signed_by_a_different_key":return new Error(W());case"merge_via_new_method":{let a=typeof t.retry_at=="number"?t.retry_at:null;return new Error(a?e("That sign-in was connected to its account too recently to combine accounts with. Try again after {date}, or connect one of that account\u2019s older sign-in methods instead.",{date:h(a)}):e("That sign-in was connected to its account too recently to combine accounts with. Connect one of that account\u2019s older sign-in methods instead."))}default:return n}}var F=()=>e("A different wallet or address answered than the one you were asked about. Nothing was combined."),B=()=>e("Cancelled. The two accounts stay separate."),H=n=>e("Not combined yet. The other account has been in use for a while, so its owner is given until {date} to cancel; both accounts have been told. Nothing moves until then.",{date:h(n)}),Y=n=>e("It will not happen at once. That account has been in use for a while, so its owner is told and has {days} days to cancel; nothing moves until then.",{days:Math.max(1,Math.round(n/86400))}),W=()=>e("A different Nostr key signed than the one you were shown. Nothing was linked.");async function K(n,t){if(!t.linked_accounts.some(a=>a.namespace==="openwallet"))return null;try{return await n.delegation()}catch{return null}}function _(n){let t=n/200;return y(t,{style:"currency",currency:"USD",minimumFractionDigits:Number.isInteger(t)?0:2})}function z(n){let t=n,a=t.deleg;if(!a?.onwallet_linked)return r;let s=t.busy,l=async(u,c)=>{if(u==="edit"||u==="cancel")t.deleg={...a,editing:u==="edit"};else{let m=await t.run(()=>t.sdk.delegation(u==="revoke"?"DELETE":"PUT",c??{}));m&&(t.deleg=m)}t.requestUpdate()},i=a.delegation;if(a.editing&&i){let u=(c,m)=>Number.parseInt(c.elements.namedItem(m).value,10);return o`<section class="oa-deleg" aria-label=${e("What agents may spend")}>
      <h3>${e("What agents may spend")}</h3>
      <form
        @submit=${c=>{c.preventDefault();let m=c.currentTarget;l("save",{per_day_credits:u(m,"per_day"),per_run_credits:u(m,"per_run")})}}
      >
        <label class="oa-field"
          >${e("Credits a day (200 credits is $1)")}
          <input
            name="per_day"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            .value=${String(i.per_day_credits)}
          />
        </label>
        <label class="oa-field"
          >${e("Credits on one run")}
          <input
            name="per_run"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            .value=${String(i.per_run_credits)}
          />
        </label>
        <div class="row">
          <button type="submit" ?disabled=${s}>${e("Save")}</button>
          <button type="button" ?disabled=${s} @click=${()=>l("cancel")}>
            ${e("Cancel")}
          </button>
        </div>
      </form>
    </section>`}let p;return i?i.revoked_at?p=o`<p>${e("Agents can't spend your credits: you turned this off.")}</p>
      <div class="row">
        <button ?disabled=${s} @click=${()=>l("allow")}>${e("Turn on again")}</button>
      </div>`:p=o`<p>
        ${e("Agents you approve in OnWallet can spend up to {credits} credits ({usd}) a day from your credits.",{credits:d(i.per_day_credits),usd:_(i.per_day_credits)})}
        <button class="link" ?disabled=${s} @click=${()=>l("edit")}>${e("Change")}</button>
      </p>
      <p class="muted small">
        ${e("Up to {run} credits on one run. Used in the last 24 hours: {used}.",{run:d(i.per_run_credits),used:d(i.used_today)})}
        <button class="link" ?disabled=${s} @click=${()=>l("revoke")}>
          ${e("Turn off")}
        </button>
      </p>`:p=o`<p>
        ${e("Let agents you approve in OnWallet spend up to {credits} credits ({usd}) a day from your credits?",{credits:d(a.defaults.per_day_credits),usd:_(a.defaults.per_day_credits)})}
      </p>
      <div class="row">
        <button ?disabled=${s} @click=${()=>l("allow")}>${e("Allow")}</button>
      </div>`,o`<section class="oa-deleg" aria-label=${e("What agents may spend")}>
    <h3>${e("Agents")}</h3>
    ${p}
  </section>`}var V=v`
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
`;export{W as DIFFERENT_KEY,F as DIFFERENT_WALLET,B as MERGE_CANCELLED,x as describeError,U as explained,V as extrasStyles,K as loadDelegation,H as mergeHeld,Y as mergeWillWait,R as renderCredits,z as renderDelegation,L as renderNostrPreview,M as renderOpenwalletNostrOffer,S as renderPendingMerges,P as renderRefusal,G as renderUnlinkConfirm};
//# sourceMappingURL=account-extras-3NUMAWI5.js.map
