import{c as $,e as f,f as v,g as k}from"./chunk-KB6RX7FT.js";import{a as y,b as i,d as c,e as w,g as l,h as g,l as m,m as b}from"./chunk-D7VGXHRZ.js";import{a as o}from"./chunk-LCQWCHVU.js";var x=["apple","google","github"];function R(d){return x.includes(d)}var h={apple:"Apple",google:"Google",github:"GitHub",eip155:"Wallet",nostr:"Nostr"},n=class extends b{constructor(){super(...arguments);this.me=null;this.enabled=null;this.pending=null;this.notice=null;this.blocked=null;this.wallets=null;this.confirmingDelete=!1}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){if(await Promise.resolve(),this.handleLinkRedirect(),this.enabled||(this.enabled=await this.run(()=>this.sdk.auth.methods())??null),!this.sdk.isLoggedIn){this.me=null;return}this.me=await this.run(()=>this.sdk.auth.me())??null}linked(e){return(this.me?.linked_accounts??[]).some(t=>t.namespace===e)}get connectable(){return["eip155","nostr"].filter(e=>this.enabled?.[e]&&!this.linked(e))}get redirectConnectable(){return x.filter(e=>this.enabled?.[e]&&!this.linked(e))}async connectRedirect(e,t=!1){await this.run(async()=>{let r=`${location.origin}${location.pathname}${location.search}`,s=await this.sdk.auth.redirectLinkStart(e,r,{merge:t});window.location.href=s})}handleLinkRedirect(){let e;try{e=this.sdk.auth.completeLinkRedirect()}catch{return}if(e)switch(e.status){case"linked":this.notice=e.merged?`Accounts combined \u2014 ${e.credits.toLocaleString()} credits moved across.`:`${h[e.namespace]??e.namespace} connected.`,this.emit("openapps-identity-linked",e),m();break;case"conflict":if(!R(e.namespace))break;this.pending={namespace:e.namespace,other:{id:"",balance:e.balance}};break;case"blocked":this.blocked=e.message;break;case"error":this.error=e.message;break}}async beginEthereumConnect(){this.blocked=null;let e=await $();if(e.length>1){this.wallets=e;return}await this.connect("eip155",e[0])}async connect(e,t){this.blocked=null,this.wallets=null,await this.run(async()=>{let r=e==="eip155"?await f(t?.provider):void 0,s=await this.sdk.auth.linkChallenge(e,r),p=e==="eip155"?await v(s.message,r,t?.provider):await k(s.message);try{let a=await this.sdk.auth.linkVerify(s.challenge_id,p);this.afterLink(a)}catch(a){if(a instanceof g&&(a.detail?.code==="merge_blocked_by_duplicate_namespace"||a.detail?.code==="namespace_already_linked")){this.blocked=a.message;return}if(a instanceof g&&a.detail?.code==="identity_belongs_to_another_account"){this.pending={namespace:e,other:a.detail.other_account};return}throw a}})}async confirmMerge(){let e=this.pending;if(!e)return;if(R(e.namespace)){this.pending=null,await this.connectRedirect(e.namespace,!0);return}let t=e.namespace;await this.run(async()=>{let r=t==="eip155"?await f():void 0,s=await this.sdk.auth.linkChallenge(t,r),p=t==="eip155"?await v(s.message,r):await k(s.message),a=await this.sdk.auth.linkVerify(s.challenge_id,p,{merge:!0});this.pending=null,this.afterLink(a)})}afterLink(e){this.notice=e.merged?`Accounts combined \u2014 ${(e.credits_transferred??0).toLocaleString()} credits moved across.`:"Connected.",this.emit("openapps-identity-linked",e),m(),this.load()}async unlink(e){await this.run(async()=>{await this.sdk.auth.unlink(e),this.notice="Disconnected.",this.emit("openapps-identity-unlinked",{caip10:e}),await this.load()})}async deleteAccount(){await this.run(async()=>{await this.sdk.auth.deleteAccount(),this.confirmingDelete=!1,this.me=null,this.emit("openapps-account-deleted",null),m()})}renderDelete(){if(!this.confirmingDelete)return i`<button class="link danger-link" ?disabled=${this.busy}
        @click=${()=>this.confirmingDelete=!0}>Delete account…</button>`;let e=this.me?.balance??0;return i`
      <div class="confirm-delete" role="alertdialog" aria-label="Delete account">
        <p><strong>Delete this account?</strong> This cannot be undone.</p>
        <p class="muted small">
          Your sign-in methods are removed from it${e>0?i`, and your <strong>${e.toLocaleString()} credits</strong> are lost`:c}. Signing in again later starts a new, empty account. It is the
          same account in every one of our apps, so it is deleted from all of them.
        </p>
        <div class="row">
          <button ?disabled=${this.busy} @click=${()=>this.confirmingDelete=!1}>Cancel</button>
          <button class="danger" ?disabled=${this.busy} @click=${this.deleteAccount}>Delete my account</button>
        </div>
      </div>
    `}render(){if(!this.sdkOrNull)return i`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return i`<p class="muted">Sign in to manage your account.</p>`;if(!this.me)return i`<p class="muted">Loading…</p>`;if(this.pending)return this.renderMergePrompt(this.pending);let e=this.me.linked_accounts;return i`
      <div class="card">
        <div class="head">
          <div>
            <div class="muted small">Account</div>
            <code class="id">${this.me.id}</code>
          </div>
          <div class="right">
            <div class="balance">${this.me.balance.toLocaleString()}</div>
            <div class="muted small">credits</div>
          </div>
        </div>

        <h3>Sign-in methods</h3>
        <ul class="identities">
          ${e.map(t=>i`
              <li>
                <span class="tag">${h[t.namespace]??t.namespace}</span>
                <code title=${t.caip10}
                  >${C(t.label??t.caip10)}</code
                >
                ${e.length>1?i`<button
                      class="link"
                      ?disabled=${this.busy}
                      @click=${()=>this.unlink(t.caip10)}
                    >
                      Disconnect
                    </button>`:i`<span class="muted small">only method</span>`}
              </li>
            `)}
        </ul>

        ${this.connectable.length||this.redirectConnectable.length?i`
              <h3>Add another</h3>
              <div class="row">
                ${this.redirectConnectable.map(t=>i`<button
                    ?disabled=${this.busy}
                    @click=${()=>this.connectRedirect(t)}
                  >
                    Connect ${h[t]}
                  </button>`)}
                ${this.connectable.map(t=>t==="eip155"&&this.wallets?this.wallets.map(r=>i`
                          <button ?disabled=${this.busy} @click=${()=>this.connect(t,r)}>
                            Connect ${r.name}
                          </button>
                        `):i`
                        <button
                          ?disabled=${this.busy}
                          @click=${()=>t==="eip155"?this.beginEthereumConnect():this.connect(t)}
                        >
                          Connect ${h[t]}
                        </button>
                      `)}
              </div>
              <p class="muted small">
                Connecting a method that is already on another account will offer to
                combine them, so you keep one balance and one history.
              </p>
            `:i`<p class="muted small">Every available method is connected.</p>`}

        ${this.blocked?i`<p class="warn" role="alert">${this.blocked}</p>`:c}
        ${this.notice?i`<p class="notice">${this.notice}</p>`:c}
        ${this.error?i`<p class="error" role="alert">${this.error}</p>`:c}

        <div class="delete">${this.renderDelete()}</div>
      </div>

    `}renderMergePrompt(e){return i`
      <div class="card">
        <h3>Combine two accounts?</h3>
        <p>
          That ${h[e.namespace]??e.namespace} identity already
          belongs to another account holding
          <strong>${e.other.balance.toLocaleString()} credits</strong>.
        </p>
        <p class="muted small">
          Combining moves its credits, payment history and referral earnings onto
          this account, and signs it out everywhere. It cannot be undone.
        </p>
        <div class="row">
          <button class="primary" ?disabled=${this.busy} @click=${this.confirmMerge}>
            Combine them
          </button>
          <button ?disabled=${this.busy} @click=${()=>this.pending=null}>
            Cancel
          </button>
        </div>
        ${this.error?i`<p class="error" role="alert">${this.error}</p>`:c}
    `}};n.styles=[b.baseStyles,y`
      .card {
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: 1rem 1.1rem;
        background: var(--surface-card, var(--fb-card));
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        border-bottom: 1px solid var(--border-hairline, var(--fb-hairline));
        padding-bottom: 0.75rem;
      }
      .right {
        text-align: right;
      }
      .balance {
        font-size: 1.5rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .id {
        font-size: 0.8rem;
        overflow-wrap: anywhere;
      }
      h3 {
        font-size: 0.9rem;
        margin: 1rem 0 0.5rem;
      }
      .identities {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .identities li {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.9rem;
      }
      .identities code {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tag {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: 999px;
        padding: 0.1em 0.6em;
      }
      button.link {
        border: none;
        background: none;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        padding: 0;
        font-size: 0.85em;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .small {
        font-size: 0.8rem;
      }
      .notice {
        font-size: 0.85rem;
        margin-top: 0.6rem;
      }
      /* Semantic tokens rather than a hardcoded pair with its own media
         query: that combination ignored the host entirely, so a page
         forcing dark kept a bright yellow warning. */
      .warn {
        font-size: 0.85rem;
        margin-top: 0.6rem;
        padding: 0.5em 0.7em;
        border-radius: var(--radius-lg, 12px);
        background: var(--warning-bg, #fef3c7);
        color: var(--warning-fg, #92400e);
      }
      /* Deleting sits apart from everything else on the card, so it is not
         read as one more sign-in option. The same danger tokens the base
         styles use for errors, so a host's theme carries through. */
      .delete {
        margin-top: 1rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border-hairline, var(--fb-hairline));
      }
      button.danger-link {
        color: var(--danger-fg, var(--fb-danger));
      }
      .confirm-delete {
        padding: 0.7em 0.8em;
        border-radius: var(--radius-lg, 12px);
        background: var(--danger-bg, #fdecea);
      }
      .confirm-delete p {
        margin: 0 0 0.5rem;
      }
      button.danger {
        background: var(--danger-fg, var(--fb-danger));
        border-color: var(--danger-fg, var(--fb-danger));
        color: #fff;
      }
    `],o([l()],n.prototype,"me",2),o([l()],n.prototype,"enabled",2),o([l()],n.prototype,"pending",2),o([l()],n.prototype,"notice",2),o([l()],n.prototype,"blocked",2),o([l()],n.prototype,"wallets",2),o([l()],n.prototype,"confirmingDelete",2),n=o([w("openapps-account")],n);function C(d,u=18,e=8){return d.length<=u+e+1?d:`${d.slice(0,u)}\u2026${d.slice(-e)}`}export{n as OpenAppsAccount};
//# sourceMappingURL=openapps-account.js.map
