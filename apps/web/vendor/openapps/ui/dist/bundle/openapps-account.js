import{a as F,b as g,c as f,e as z,h as $}from"./chunk-2U5ZASP5.js";import{b as k,c as _,e as E,f as M,i as I,k as O,l as W,m as S,n as U,o as K}from"./chunk-5CN5JSMR.js";import{a as L,b as T,c as a,e as o,f as D,h as d,i as m,m as v,p as t,q as P}from"./chunk-HLRRPXU7.js";import{a as l,b as x,c as C,d as N}from"./chunk-LCQWCHVU.js";var A=["apple","google","github","openwallet"];function G(c){let w=c.detail?.merge_held_for_secs;return typeof w=="number"&&w>0?w:void 0}function R(c){return A.includes(c)}var Y="openapps.openwallet_prompt_dismissed";function B(){try{let c=globalThis.openwallet;return!!c&&c.isOpenWallet===!0}catch{return!1}}function H(){try{let c=navigator;return typeof c.userAgentData?.mobile=="boolean"?c.userAgentData.mobile:/Android|iPhone|iPad|iPod|Mobile/i.test(c.userAgent)}catch{return!1}}function j(){try{return localStorage.getItem(Y)==="1"}catch{return!1}}var b,s=class extends P{constructor(){super(...arguments);this.me=null;this.enabled=null;this.pending=null;this.notice=null;this.signInAt=null;this.blocked=null;this.refusal=null;this.installUrl=null;this.owDismissed=j();this.credits=null;this.loadFailed=!1;this.nostrPreview=null;this.confirmingUnlink=null;this.wallets=null;this.extras=null;C(this,b,null);this.confirmingDelete=!1}needExtras(){return x(this,b)??N(this,b,import("./account-extras-3H2I3JCF.js").then(e=>{let n=this.constructor.elementStyles;return T(this.renderRoot,[...n,e.extrasStyles]),this.extras=e,e})),x(this,b)}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){await Promise.resolve(),await this.handleLinkRedirect();let e=this.error;try{await this.loadAccount()}finally{e&&!this.error&&(this.error=e)}}async loadAccount(){if(!this.enabled){let i=await this.run(()=>this.sdk.auth.serverInfo());this.enabled=i?.methods??null,this.installUrl=i?.openwallet_install_url??null}if(!this.sdk.isLoggedIn){this.me=null,this.credits=null,this.loadFailed=!1;return}let e=await this.run(()=>this.sdk.auth.me())??null;this.loadFailed=!e&&this.sdk.isLoggedIn,this.me=e,e?.pending_merges?.length&&await this.needExtras().catch(()=>{});let n=e?await this.loadCredits(e):null;this.deleg=e&&await this.extras?.loadDelegation(this.sdk,e),this.credits=n}async loadCredits(e){if(!(!!e.membership||e.linked_accounts.some(i=>i.namespace==="openwallet")))return null;try{return await this.needExtras(),await this.sdk.credits.breakdown()}catch{return null}}linked(e){return(this.me?.linked_accounts??[]).some(n=>n.namespace===e)}get connectable(){return["eip155","nostr"].filter(e=>this.enabled?.[e]&&!this.linked(e))}get redirectConnectable(){return A.filter(e=>this.enabled?.[e]&&!this.linked(e)&&!(e==="openwallet"&&_))}get openwalletOffered(){return!_&&!!this.enabled?.openwallet&&!this.linked("openwallet")}get showOpenwalletPrompt(){return this.openwalletOffered&&!this.owDismissed}get openwalletNostrOffered(){let e=this.me?.nostr;return!this.enabled?.nostr||!e||e.linked||!e.openwallet_claim?null:e.openwallet_claim}dismissOpenwalletPrompt(){this.owDismissed=!0;try{localStorage.setItem(Y,"1")}catch{}}clearMessages(){this.blocked=null,this.refusal=null,this.notice=null,this.signInAt=null}async connectRedirect(e){await this.run(async()=>{let n=`${location.origin}${location.pathname}${location.search}`;this.signInAt=null;try{await this.sdk.auth.redirectLink(e,n)}catch(i){let r=i instanceof m?i.detail?.sign_in_url:void 0;throw typeof r=="string"&&r.startsWith("https://")&&(this.signInAt=r),i}})}refused(e){if(!(e instanceof m))return!1;let n=e.detail??{};if(n.code==="merge_blocked_by_duplicate_namespace"){let i=Array.isArray(n.blocking)?n.blocking:[];return this.refusal=i.length?{kind:"merge",blocking:i}:null,this.blocked=e.message,this.refusal&&this.needExtras(),!0}if(n.code==="namespace_already_linked"){let i=typeof n.namespace=="string"?n.namespace:"";return this.refusal=i?{kind:"taken",namespace:i,name:typeof n.name=="string"?n.name:g(i),linked:n.linked??null,offered:n.offered??null}:null,this.blocked=e.message,this.refusal&&this.needExtras(),!0}return!1}async confirmRedirectLink(e,n){await this.run(async()=>{try{this.afterLink(await this.sdk.auth.confirmLink(n))}catch(i){if(!(i instanceof m))throw i;if(i.detail?.code==="identity_belongs_to_another_account"){if(!R(e))throw i;this.pending={namespace:e,other:i.detail.other_account,code:n,heldSecs:G(i)};return}if(this.refused(i))return;throw await this.explained(i)}})}async handleLinkRedirect(){let e;try{e=this.sdk.auth.completeLinkRedirect()}catch{return}if(e)switch(e.status){case"pending":await this.confirmRedirectLink(e.namespace,e.code);break;case"linked":this.notice=e.merged?t("Accounts combined \u2014 {credits} credits moved across.",{credits:f(e.credits)}):t("{method} connected.",{method:g(e.namespace)}),this.emit("openapps-identity-linked",e),v();break;case"conflict":if(!R(e.namespace))break;this.pending={namespace:e.namespace,other:{id:"",balance:e.balance}};break;case"blocked":this.blocked=e.message;break;case"error":this.error=e.message;break}}async beginEthereumConnect(){this.clearMessages();let e=await I();if(e.length>1){this.wallets=e;return}await this.connect("eip155",e[0])}async previewNostr(e){this.clearMessages(),this.wallets=null,await this.run(async()=>{let[n]=await Promise.all([U(),this.needExtras()]);this.nostrPreview={key:n,purpose:e,claim:this.me?.nostr?.openwallet_claim??null}})}async linkPreviewedNostr(){let e=this.nostrPreview;e&&(this.nostrPreview=null,await this.connect("nostr",void 0,e.key))}async sign(e,n,i,r){let h=e==="eip155"?await O(n?.provider):void 0;if(r&&h?.toLowerCase()!==r.toLowerCase())throw new Error((await this.needExtras()).DIFFERENT_WALLET());let p=await this.sdk.auth.linkChallenge(e,h),y=e==="eip155"?await W(p.message,h,n?.provider):await S(p.message);if(i&&K(y)!==i.hex)throw new Error((await this.needExtras()).DIFFERENT_KEY());return{challenge:p,proof:y,address:h,expect:i?`nostr:${i.npub}`:void 0}}async connect(e,n,i){this.clearMessages(),this.wallets=null,await this.run(async()=>{let{challenge:r,proof:h,address:p,expect:y}=await this.sign(e,n,i);try{let u=await this.sdk.auth.linkVerify(r.challenge_id,h,{expect:y});this.afterLink(u)}catch(u){if(this.refused(u))return;if(u instanceof m&&u.detail?.code==="identity_belongs_to_another_account"){this.pending={namespace:e,other:u.detail.other_account,key:i,wallet:n,address:p,heldSecs:G(u)};return}throw await this.explained(u)}})}async confirmMerge(){let e=this.pending;if(!e)return;if(R(e.namespace)){if(this.pending=null,e.code){let i=e.code;await this.run(async()=>{try{this.afterLink(await this.sdk.auth.confirmLink(i,{merge:!0}))}catch(r){if(this.refused(r))return;throw await this.explained(r)}})}else await this.connectRedirect(e.namespace);return}let n=e.namespace;await this.run(async()=>{let{challenge:i,proof:r,expect:h}=await this.sign(n,e.wallet,e.key,e.address);try{let p=await this.sdk.auth.linkVerify(i.challenge_id,r,{merge:!0,expect:h});this.pending=null,this.afterLink(p)}catch(p){if(this.refused(p)){this.pending=null;return}throw await this.explained(p)}})}afterLink(e){this.notice=e.merge_pending?this.extras?.mergeHeld(e.pending_merge?.effective_at??0)??null:e.merged?t("Accounts combined \u2014 {credits} credits moved across.",{credits:f(e.credits_transferred??0)}):t("Connected."),this.emit("openapps-identity-linked",e),v(),this.load()}async explained(e){return e instanceof m?(await this.needExtras()).explained(e):e}requestUnlink(e){if(this.clearMessages(),e.namespace==="openwallet"&&this.me?.membership?.identity===e.caip10){this.confirmingUnlink=e,this.needExtras();return}this.unlink(e.caip10)}async unlink(e){this.confirmingUnlink=null,await this.run(async()=>{try{await this.sdk.auth.unlink(e)}catch(n){throw await this.explained(n)}this.notice=t("Disconnected."),this.emit("openapps-identity-unlinked",{caip10:e}),v(),await this.load()})}async cancelMerge(e){await this.run(async()=>{await this.sdk.auth.cancelMerge(e),this.notice=(await this.needExtras()).MERGE_CANCELLED(),await this.load()})}async deleteAccount(){await this.run(async()=>{try{await this.sdk.auth.deleteAccount()}catch(e){throw await this.explained(e)}this.confirmingDelete=!1,this.me=null,this.credits=null,this.emit("openapps-account-deleted",null),v()})}renderDelete(){if(!this.confirmingDelete)return a`<button class="link danger-link" ?disabled=${this.busy}
        @click=${()=>this.confirmingDelete=!0}>${t("Delete account\u2026")}</button>`;let e=this.me?.balance??0;return a`
      <div class="oa-callout oa-callout--danger confirm-delete" role="alertdialog"
        aria-label=${t("Delete account")}>
        <p><strong>${t("Delete this account?")}</strong> ${t("This cannot be undone.")}</p>
        <p class="muted small">
          ${e>0?a`${t("Your sign-in methods are removed from it, and your")}
                <strong>${t("{credits} credits",{credits:f(e)})}</strong>
                ${t("are lost.")}`:t("Your sign-in methods are removed from it.")}
          ${t("Signing in again later starts a new, empty account. It is the same account in every one of our apps, so it is deleted from all of them.")}
        </p>
        ${this.linked("openwallet")?a`<p class="muted small oa-keeps">
              ${t("Your OnWallet ID is not deleted. It lives in your OnWallet extension, not in this account, and it keeps working there.")}
            </p>`:o}
        <div class="row">
          <button ?disabled=${this.busy} @click=${()=>this.confirmingDelete=!1}>
            ${t("Cancel")}
          </button>
          <button class="danger" ?disabled=${this.busy} @click=${this.deleteAccount}>
            ${t("Delete my account")}
          </button>
        </div>
      </div>
    `}renderOpenwalletPrompt(){let e=B(),n=!e&&H();return a`
      <div class="oa-section ow-prompt" role="group" aria-label="OnWallet">
        <h3>${k}</h3>
        ${n?a`<p class="small">
              ${t("OnWallet is a browser extension for a computer. To connect your OnWallet ID, open this page there.")}
            </p>`:a`<p class="small">
                ${e?t("OnWallet is in this browser."):t("OnWallet is a browser extension.")}
                ${t("Connect your OnWallet ID to sign in with it here. It joins the sign-in methods above, on this one account.")}
              </p>
              <div class="row">
                <button
                  ?disabled=${this.busy}
                  aria-describedby="ow-hint"
                  @click=${()=>this.connectRedirect("openwallet")}
                >
                  ${t("Connect")} ${k}
                </button>
                ${!e&&this.installUrl?a`<a
                      class="get"
                      href=${this.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      >${t("Get OnWallet")}</a
                    >`:o}
              </div>
              <p class="ow-hint" id="ow-hint">${t(E)}</p>
              ${this.renderConnectTag()}
              <p class="muted small">
                ${t("You choose in the extension what it shares. Once connected, this account can be opened with it or with any method above.")}
              </p>`}
        <button class="link" @click=${this.dismissOpenwalletPrompt}>${t("Not now")}</button>
      </div>
    `}renderConnectTag(){let e=this.me?.openwallet_connect_tag;return typeof e!="string"||!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(e)?o:a`<p class="small oa-tag">${t("Connect in OnWallet only if it shows this tag:")}<code>${e}</code></p>`}renderMembership(){let e=this.me?.membership;if(!e)return o;let n=(this.me?.linked_accounts.length??0)>1,i;return e.needs_confirmation?i=a`${t("Confirm in OnWallet to keep your member benefits.")}
        <button class="link" ?disabled=${this.busy} @click=${()=>this.connectRedirect("openwallet")}>
          ${t("Confirm")}
        </button>
        ${this.renderConnectTag()}`:e.benefits_active?i=a`${t("Member benefits are on for this account, however you sign in.")}`:i=a`${t("Member benefits start on {date}. This OnWallet ID was on another account before.",{date:z(e.benefits_from)})}`,a`
      <div class="oa-section member">
        <span class="tag oa-tag--strong">${t("Genesis member")}</span>
        <p class="small">${i}</p>
        ${n?a`<p class="muted small">
              ${t("Each sign-in method above opens this account. Disconnect any you do not use.")}
            </p>`:o}
      </div>
    `}renderNostrKeys(){let e=this.me?.nostr;return!e?.differs||!e.linked||!e.openwallet_claim?o:a`
      <div class="oa-section nostr-keys">
        <h3>${t("Two Nostr keys")}</h3>
        <ul class="identities">
          <li>
            <span class="tag oa-tag--strong">${t("In use")}</span>
            <code title=${e.linked}>${$(e.linked)}</code>
            <span class="muted small">${t("this account")}</span>
          </li>
          <li>
            <span class="tag">${t("Not used")}</span>
            <code title=${e.openwallet_claim}>${$(e.openwallet_claim)}</code>
            <span class="muted small">${t("your OnWallet ID")}</span>
          </li>
        </ul>
        <p class="muted small">
          ${t("Apps use the first key. Connecting OnWallet did not change it, and data kept under it stays there.")}
        </p>
        <p class="muted small">
          ${t("The account\u2019s key is not swapped for the other one: data apps keep under a Nostr key can be read only with that key. To use one key everywhere, import the first into OnWallet and choose it for websites.")}
        </p>
      </div>
    `}render(){if(!this.sdkOrNull)return a`<p class="muted">${t("Loading\u2026")}</p>`;if(!this.sdk.isLoggedIn)return a`<p class="muted">${t("Sign in to manage your account.")}</p>`;if(!this.me)return this.loadFailed&&!this.busy?a`<div class="oa-card card oa-failed">
          <p class="error" role="alert">
            ${this.error??t("Your account could not be loaded.")}
          </p>
          <div class="row">
            <button @click=${()=>this.load()}>${t("Try again")}</button>
          </div>
        </div>`:a`<p class="muted">${t("Loading\u2026")}</p>`;if(this.pending)return this.pending.heldSecs&&!this.extras&&this.needExtras(),this.renderMergePrompt(this.pending);let e=this.extras;if(e&&this.nostrPreview)return e.renderNostrPreview(this.nostrPreview,this.busy,this.error,{link:()=>{this.linkPreviewedNostr()},retry:()=>{this.previewNostr("openwallet")},cancel:()=>this.nostrPreview=null});if(e&&this.confirmingUnlink){let r=this.confirmingUnlink;return e.renderUnlinkConfirm(r,this.credits?.granted??0,this.busy,{confirm:()=>{this.unlink(r.caip10)},cancel:()=>this.confirmingUnlink=null})}let n=this.me.linked_accounts,i=this.redirectConnectable.filter(r=>r!=="openwallet"||!this.showOpenwalletPrompt);return a`
      <div class="oa-card card">
        <div class="head">
          <div>
            <div class="muted small">${t("Account")}</div>
            <code class="id">${this.me.id}</code>
          </div>
          <div class="right">
            <div class="balance">${f(this.me.balance)}</div>
            <div class="muted small">${t("credits")}</div>
          </div>
        </div>

        ${e&&this.me.pending_merges?.length?e.renderPendingMerges(this.me.pending_merges,this.busy,r=>{this.cancelMerge(r)}):o}
        ${e&&this.refusal?e.renderRefusal(this.refusal):this.blocked?a`<p class="oa-callout oa-callout--warning warn" role="alert">${this.blocked}</p>`:o}
        ${e?e.renderCredits(this.me,this.credits,()=>{this.connectRedirect("openwallet")}):o}
        ${e?.renderDelegation(this)}

        <h3>${t("Sign-in methods")}</h3>
        <ul class="identities">
          ${n.map(r=>a`
              <li>
                <span class="tag">${g(r.namespace)}</span>
                <code title=${r.caip10}
                  >${$(r.label??r.caip10)}</code
                >
                ${n.length>1?a`<button
                      class="link"
                      ?disabled=${this.busy}
                      @click=${()=>this.requestUnlink(r)}
                    >
                      ${t("Disconnect")}
                    </button>`:a`<span class="muted small">${t("only method")}</span>`}
              </li>
            `)}
        </ul>

        ${this.renderMembership()} ${this.renderNostrKeys()}
        ${e&&this.openwalletNostrOffered?e.renderOpenwalletNostrOffer(this.openwalletNostrOffered,this.busy,()=>{this.previewNostr("openwallet")}):o}
        ${this.showOpenwalletPrompt?this.renderOpenwalletPrompt():o}
        ${this.connectable.length||i.length?a`
              <h3>${t("Add another")}</h3>
              <div class="row">
                ${i.map(r=>a`<button
                    ?disabled=${this.busy}
                    aria-describedby=${r==="openwallet"?"ow-hint":o}
                    @click=${()=>this.connectRedirect(r)}
                  >
                    ${t("Connect")} ${r==="openwallet"?k:F[r]}
                  </button>`)}
                ${this.connectable.map(r=>r==="eip155"&&this.wallets?this.wallets.map(h=>a`
                          <button ?disabled=${this.busy} @click=${()=>this.connect(r,h)}>
                            ${t("Connect")} ${h.name}
                          </button>
                        `):a`
                        <button
                          ?disabled=${this.busy}
                          @click=${()=>r==="eip155"?this.beginEthereumConnect():this.previewNostr("connect")}
                        >
                          ${t("Connect")} ${g(r)}
                        </button>
                      `)}
              </div>
              ${i.includes("openwallet")?a`<p class="ow-hint" id="ow-hint">${t(E)}</p>
                    ${this.renderConnectTag()}`:o}
              <p class="muted small">
                ${t("Connecting a method that is already on another account will offer to combine them, so you keep one balance and one history.")}
              </p>
            `:this.showOpenwalletPrompt?o:a`<p class="muted small">${t("Every available method is connected.")}</p>`}

        ${this.notice?a`<p class="notice" role="status">${this.notice}</p>`:o}
        ${this.error?a`<p class="error" role="alert">${this.error}</p>`:o}
        ${this.signInAt?a`<p><a href=${this.signInAt} target="_blank" rel="noopener"
              >${t("Sign in on the Account page")}</a></p>`:o}

        <div class="oa-section delete">${this.renderDelete()}</div>
      </div>

    `}renderMergePrompt(e){return a`
      <div class="oa-card card">
        <h3>${t("Combine two accounts?")}</h3>
        <p>
          ${t("That {method} identity already belongs to another account holding",{method:g(e.namespace)})}
          <strong>${t("{credits} credits",{credits:f(e.other.balance)})}</strong>.
        </p>
        <p class="muted small">
          ${t("Combining moves its credits, payment history and referral earnings onto this account, and signs it out everywhere. It cannot be undone.")}
        </p>
        ${e.heldSecs&&this.extras?a`<p class="small oa-held">${this.extras.mergeWillWait(e.heldSecs)}</p>`:o}
        <div class="row">
          <button class="primary" ?disabled=${this.busy} @click=${this.confirmMerge}>
            ${t("Combine them")}
          </button>
          <button ?disabled=${this.busy} @click=${()=>this.pending=null}>
            ${t("Cancel")}
          </button>
        </div>
        ${this.error?a`<p class="error" role="alert">${this.error}</p>`:o}
      </div>
    `}};b=new WeakMap,s.styles=[P.baseStyles,M,L`
      .oa-card {
        box-sizing: border-box;
        width: 100%;
        max-width: var(--sdk-wide, 560px);
        border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: var(--space-4, 16px);
        background: var(--surface-card, var(--fb-card));
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--space-4, 16px);
        padding: 0 0 var(--space-3, 12px);
        border-bottom: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
      }
      .head > div:first-child {
        min-width: 0;
      }
      .head > :first-child {
        min-width: 0;
      }
      .right {
        text-align: right;
        /* The balance keeps its own width: the account id beside it gives way
           instead. A host that lets long words break anywhere (a dialog does,
           for file names) otherwise broke 4,000 into "4,00" over "0". */
        flex: none;
      }
      .balance {
        font: var(--weight-medium, 500) var(--text-xl, 24px) / 1.2
          var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: var(--text-strong, var(--fb-strong));
      }
      .id {
        font: var(--type-mono, 400 13px/1.5 ui-monospace, monospace);
        font-size: var(--text-xs, 12px);
        overflow-wrap: anywhere;
      }
      h3 {
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
        color: var(--text-strong, var(--fb-strong));
        margin: var(--space-4, 16px) 0 var(--space-2, 8px);
      }
      p {
        margin: var(--space-2, 8px) 0;
      }
      code {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-size: var(--text-sm, 13px);
        color: var(--text-strong, var(--fb-strong));
      }
      .oa-tag code{display:block;font-size:1.3rem;letter-spacing:.2em}
      .identities {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 8px);
      }
      .identities li {
        display: flex;
        align-items: center;
        gap: var(--space-2, 8px);
        min-width: 0;
      }
      .identities code {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .identities li > :last-child {
        flex: none;
      }
      .tag {
        flex: none;
        font: var(--type-eyebrow, 500 12px/1.2 "Geist", system-ui, sans-serif);
        font-size: var(--text-2xs, 11px);
        text-transform: uppercase;
        letter-spacing: var(--tracking-caps, 0.08em);
        color: var(--text-muted, var(--fb-muted));
        border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-full, 999px);
        padding: var(--space-1, 4px) var(--space-2, 8px);
      }
      /* "On" is black, not green: green means an action. */
      .oa-tag--strong {
        color: var(--text-strong, var(--fb-strong));
        border-color: var(--border-strong, var(--fb-strong));
      }
      button.link {
        border: none;
        background: none;
        min-height: 0;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        text-underline-offset: 3px;
        padding: 0;
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      }
      button.link:hover:not([disabled]) {
        background: none;
        color: var(--text-strong, var(--fb-strong));
      }
      /* A text button is still a touch target. */
      @media (pointer: coarse) {
        button.link {
          min-height: var(--touch-min, 44px);
        }
      }
      .row {
        display: flex;
        gap: var(--space-2, 8px);
        flex-wrap: wrap;
        align-items: center;
      }
      .small {
        font-size: var(--text-sm, 13px);
      }
      /* Set apart by a hairline, like everything else on the card: the
         accent stays in the wordmark's full stop and nowhere else. */
      .oa-section {
        margin-top: var(--space-4, 16px);
        padding-top: var(--space-3, 12px);
        border-top: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
      }
      .oa-section > h3:first-child {
        margin-top: 0;
      }
      /* The head already ends in a rule; a section straight after it does
         not draw a second one a few pixels below. */
      .head + .oa-section {
        border-top: none;
        padding-top: 0;
      }
      .oa-section > .row {
        margin: var(--space-3, 12px) 0 var(--space-2, 8px);
      }
      a.get {
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      /* ---- callouts ----
         Semantic tokens rather than a hardcoded pair with its own media
         query: that combination ignored the host entirely, so a page
         forcing dark kept a bright yellow warning. */
      .oa-callout {
        margin: var(--space-3, 12px) 0;
        padding: var(--space-3, 12px);
        border-radius: var(--radius-md, 8px);
        font-size: var(--text-sm, 13px);
      }
      .oa-callout > :first-child {
        margin-top: 0;
      }
      .oa-callout > :last-child {
        margin-bottom: 0;
      }
      .oa-callout--warning {
        background: var(--warning-bg, var(--fb-warning-bg));
        color: var(--warning-fg, var(--fb-warning-fg));
      }
      .oa-callout--danger {
        background: var(--danger-bg, var(--fb-danger-bg));
        color: var(--text-body, var(--fb-body));
      }
      .oa-callout code,
      .oa-callout strong {
        color: inherit;
      }
      .oa-card > h3:first-child {
        margin-top: 0;
      }
      .row + .ow-hint {
        margin-top: var(--space-2, 8px);
      }
      .notice {
        font-size: var(--text-sm, 13px);
        margin-top: var(--space-3, 12px);
        color: var(--text-strong, var(--fb-strong));
      }
      .error {
        font-size: var(--text-sm, 13px);
      }

      /* Deleting sits apart from everything else on the card, so it is not
         read as one more sign-in option. The same danger tokens the base
         styles use for errors, so a host's theme carries through. */
      button.danger-link {
        color: var(--danger-fg, var(--fb-danger));
      }
      button.danger-link:hover:not([disabled]) {
        color: var(--danger-fg, var(--fb-danger));
      }
      .confirm-delete {
        margin: 0;
      }
      button.danger {
        background: var(--danger-fg, var(--fb-danger));
        border-color: var(--danger-fg, var(--fb-danger));
        color: var(--surface-card, var(--fb-card));
      }
      button.danger:hover:not([disabled]) {
        background: var(--danger-fg, var(--fb-danger));
        opacity: 0.9;
      }

      /* Fallbacks for the callout grounds, which the base palette lacks. */
      :host {
        --fb-warning-bg: #fef3c7;
        --fb-warning-fg: #7a4a00;
        --fb-danger-bg: #fdecea;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --fb-warning-bg: #3a2c05;
          --fb-warning-fg: #f5d58a;
          --fb-danger-bg: #3a1614;
        }
      }
    `],l([d()],s.prototype,"me",2),l([d()],s.prototype,"enabled",2),l([d()],s.prototype,"pending",2),l([d()],s.prototype,"notice",2),l([d()],s.prototype,"signInAt",2),l([d()],s.prototype,"blocked",2),l([d()],s.prototype,"refusal",2),l([d()],s.prototype,"installUrl",2),l([d()],s.prototype,"owDismissed",2),l([d()],s.prototype,"credits",2),l([d()],s.prototype,"loadFailed",2),l([d()],s.prototype,"nostrPreview",2),l([d()],s.prototype,"confirmingUnlink",2),l([d()],s.prototype,"wallets",2),l([d()],s.prototype,"extras",2),l([d()],s.prototype,"confirmingDelete",2),s=l([D("openapps-account")],s);export{s as OpenAppsAccount};
//# sourceMappingURL=openapps-account.js.map
