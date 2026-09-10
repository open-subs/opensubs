import{c as $,e as b,f,g as v}from"./chunk-QGFEREF7.js";import{a as w,b as i,d as l,e as y,g as o,h as p,l as g,m as u}from"./chunk-OUMOJ2PH.js";import{a as r}from"./chunk-LCQWCHVU.js";var k={google:"Google",eip155:"Wallet",nostr:"Nostr"},n=class extends u{constructor(){super(...arguments);this.me=null;this.enabled=null;this.pending=null;this.notice=null;this.blocked=null;this.wallets=null}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){if(await Promise.resolve(),this.handleLinkRedirect(),this.enabled||(this.enabled=await this.run(()=>this.sdk.auth.methods())??null),!this.sdk.isLoggedIn){this.me=null;return}this.me=await this.run(()=>this.sdk.auth.me())??null}linked(e){return(this.me?.linked_accounts??[]).some(t=>t.namespace===e)}get connectable(){return["eip155","nostr"].filter(e=>this.enabled?.[e]&&!this.linked(e))}get canConnectGoogle(){return(this.enabled?.google??!1)&&!this.linked("google")}async connectGoogle(e=!1){await this.run(async()=>{let t=`${location.origin}${location.pathname}${location.search}`,a=await this.sdk.auth.googleLinkStart(t,{merge:e});window.location.href=a})}handleLinkRedirect(){let e;try{e=this.sdk.auth.completeLinkRedirect()}catch{return}if(e)switch(e.status){case"linked":this.notice=e.merged?`Accounts combined \u2014 ${e.credits.toLocaleString()} credits moved across.`:"Google connected.",this.emit("openapps-identity-linked",e),g();break;case"conflict":this.pending={namespace:"google",other:{id:"",balance:e.balance}};break;case"blocked":this.blocked=e.message;break;case"error":this.error=e.message;break}}async beginEthereumConnect(){this.blocked=null;let e=await $();if(e.length>1){this.wallets=e;return}await this.connect("eip155",e[0])}async connect(e,t){this.blocked=null,this.wallets=null,await this.run(async()=>{let a=e==="eip155"?await b(t?.provider):void 0,c=await this.sdk.auth.linkChallenge(e,a),m=e==="eip155"?await f(c.message,a,t?.provider):await v(c.message);try{let s=await this.sdk.auth.linkVerify(c.challenge_id,m);this.afterLink(s)}catch(s){if(s instanceof p&&(s.detail?.code==="merge_blocked_by_duplicate_namespace"||s.detail?.code==="namespace_already_linked")){this.blocked=s.message;return}if(s instanceof p&&s.detail?.code==="identity_belongs_to_another_account"){this.pending={namespace:e,other:s.detail.other_account};return}throw s}})}async confirmMerge(){let e=this.pending;if(e){if(e.namespace==="google"){this.pending=null,await this.connectGoogle(!0);return}await this.run(async()=>{let t=e.namespace==="eip155"?await b():void 0,a=await this.sdk.auth.linkChallenge(e.namespace,t),c=e.namespace==="eip155"?await f(a.message,t):await v(a.message),m=await this.sdk.auth.linkVerify(a.challenge_id,c,{merge:!0});this.pending=null,this.afterLink(m)})}}afterLink(e){this.notice=e.merged?`Accounts combined \u2014 ${(e.credits_transferred??0).toLocaleString()} credits moved across.`:"Connected.",this.emit("openapps-identity-linked",e),g(),this.load()}async unlink(e){await this.run(async()=>{await this.sdk.auth.unlink(e),this.notice="Disconnected.",this.emit("openapps-identity-unlinked",{caip10:e}),await this.load()})}render(){if(!this.sdkOrNull)return i`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return i`<p class="muted">Sign in to manage your account.</p>`;if(!this.me)return i`<p class="muted">Loading…</p>`;if(this.pending)return this.renderMergePrompt(this.pending);let e=this.me.linked_accounts;return i`
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
                <span class="tag">${k[t.namespace]??t.namespace}</span>
                <code title=${t.caip10}
                  >${x(t.label??t.caip10)}</code
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

        ${this.connectable.length||this.canConnectGoogle?i`
              <h3>Add another</h3>
              <div class="row">
                ${this.canConnectGoogle?i`<button ?disabled=${this.busy} @click=${()=>this.connectGoogle()}>
                      Connect Google
                    </button>`:l}
                ${this.connectable.map(t=>t==="eip155"&&this.wallets?this.wallets.map(a=>i`
                          <button ?disabled=${this.busy} @click=${()=>this.connect(t,a)}>
                            Connect ${a.name}
                          </button>
                        `):i`
                        <button
                          ?disabled=${this.busy}
                          @click=${()=>t==="eip155"?this.beginEthereumConnect():this.connect(t)}
                        >
                          Connect ${k[t]}
                        </button>
                      `)}
              </div>
              <p class="muted small">
                Connecting a method that is already on another account will offer to
                combine them, so you keep one balance and one history.
              </p>
            `:i`<p class="muted small">Every available method is connected.</p>`}

        ${this.blocked?i`<p class="warn" role="alert">${this.blocked}</p>`:l}
        ${this.notice?i`<p class="notice">${this.notice}</p>`:l}
        ${this.error?i`<p class="error" role="alert">${this.error}</p>`:l}
      </div>

    `}renderMergePrompt(e){return i`
      <div class="card">
        <h3>Combine two accounts?</h3>
        <p>
          That ${k[e.namespace]??e.namespace} identity already
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
        ${this.error?i`<p class="error" role="alert">${this.error}</p>`:l}
    `}};n.styles=[u.baseStyles,w`
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
    `],r([o()],n.prototype,"me",2),r([o()],n.prototype,"enabled",2),r([o()],n.prototype,"pending",2),r([o()],n.prototype,"notice",2),r([o()],n.prototype,"blocked",2),r([o()],n.prototype,"wallets",2),n=r([y("openapps-account")],n);function x(d,h=18,e=8){return d.length<=h+e+1?d:`${d.slice(0,h)}\u2026${d.slice(-e)}`}export{n as OpenAppsAccount};
//# sourceMappingURL=openapps-account.js.map
