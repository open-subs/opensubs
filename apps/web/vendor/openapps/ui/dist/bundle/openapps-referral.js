import{a as p,b as r,d as o,e as h,f as l,g as n,m as d}from"./chunk-OUMOJ2PH.js";import{a as i}from"./chunk-LCQWCHVU.js";function u(c){return new Date(c*1e3).toLocaleDateString(void 0,{day:"numeric",month:"short"})}var a=class extends d{constructor(){super(...arguments);this.appId="";this.info=null;this.earnings=null;this.referees=null;this.tab="link";this.copied=!1}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){let t=this.sdkOrNull;if(!t?.isLoggedIn){this.info=null,this.earnings=null,this.referees=null;return}this.info=await this.run(()=>t.referral.code(this.appId||void 0))??null,this.earnings=await this.run(()=>t.referral.earnings())??null,this.referees=await this.run(()=>t.referral.referees())??null}updated(t){t.has("appId")&&this.load()}get link(){if(this.info?.invite_url)return this.info.invite_url;let t=this.inviteUrl??(typeof location>"u"?"":`${location.origin}${location.pathname}`);if(!this.info)return t;let e=t.includes("?")?"&":"?";return`${t}${e}ref=${encodeURIComponent(this.info.code)}`}async copy(){try{await navigator.clipboard.writeText(this.link),this.copied=!0,setTimeout(()=>this.copied=!1,2e3)}catch{this.error="Could not copy. Select the link and copy it manually."}}render(){if(!this.sdkOrNull)return r`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return r`<p class="muted">Sign in to get your invite link.</p>`;if(!this.info)return r`<p class="muted">${this.error??"Loading\u2026"}</p>`;let t=this.referees?.referees??[],e=this.earnings?.entries??[],g=[["link","Your link"],["referees",`Referees${t.length?` (${t.length})`:""}`],["earnings",`Earnings${e.length?` (${e.length})`:""}`]];return r`
      <div class="stack">
        <div class="tabs" role="tablist">
          ${g.map(([s,v])=>r`
              <button
                role="tab"
                aria-selected=${this.tab===s}
                class="tab ${this.tab===s?"on":""}"
                @click=${()=>this.tab=s}
              >
                ${v}
              </button>
            `)}
        </div>
        ${this.tab==="link"?this.renderLink():this.tab==="referees"?this.renderReferees(t):this.renderEarnings(e)}
        ${this.error?r`<p class="error" role="alert">${this.error}</p>`:o}
      </div>
    `}renderLink(){let t=this.earnings?.total??0,e=this.earnings?.entries.length??0;return r`
      <p class="desc">
        Share this link. When someone signs up through it and buys credits,
        you earn <strong>${this.info?.bonus_percent}%</strong> of what they
        buy, as credits.
      </p>
      <code class="payload">${this.link}</code>
      <div class="row">
        <button @click=${this.copy}>${this.copied?"Copied":"Copy link"}</button>
        <span class="muted mono">${this.info?.code}</span>
      </div>
      <div class="earned">
        <span class="eyebrow">Earned</span>
        <span class="total mono">${t.toLocaleString()}</span>
        <span class="caption">
          ${e===0?"No referred purchases yet.":`credits from ${e} purchase${e===1?"":"s"}`}
        </span>
      </div>
    `}renderReferees(t){return t.length===0?r`<p class="muted">
        Nobody has signed up through your link yet.
      </p>`:r`
      <p class="caption">
        Handles only — signing up through a link does not share someone's
        identity with you.
      </p>
      <div class="list">
        ${t.map(e=>r`
            <div class="item">
              <span class="mono handle">${e.handle}</span>
              <span class="grow caption">
                joined ${u(e.joined_at)} ·
                ${e.purchases===0?"no purchases yet":`${e.purchases} purchase${e.purchases===1?"":"s"}`}
              </span>
              <span class="mono amount ${e.earned>0?"good":""}">
                ${e.earned>0?`+${e.earned.toLocaleString()}`:"\u2014"}
              </span>
            </div>
          `)}
      </div>
    `}renderEarnings(t){return t.length===0?r`<p class="muted">
        No referral earnings yet. A bonus is credited when a referee's
        purchase settles.
      </p>`:r`
      <p class="caption">
        Each row is one bonus, credited in the same transaction as the
        referee's purchase — so this list and your balance cannot disagree.
      </p>
      <div class="list">
        ${t.map(e=>r`
            <div class="item">
              <span class="mono date">${u(e.created_at)}</span>
              <span class="grow caption">
                ${e.referee??"unknown"}
                ${e.referee_credits?r` bought ${e.referee_credits.toLocaleString()} credits`:o}
              </span>
              <span class="mono amount good">+${e.amount.toLocaleString()}</span>
            </div>
          `)}
      </div>
    `}};a.styles=[d.baseStyles,p`
      .stack {
        display: grid;
        gap: 12px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .tabs {
        display: flex;
        gap: 4px;
        border-bottom: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      /* Underline tabs sitting on the hairline, with a 2px near-black
         indicator — not a filled pill, and never a coloured bar. The
         indicator is drawn on the tab itself and pulled down over the rule
         so the selected tab reads as continuous with its panel. */
      .tab {
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--text-muted, var(--fb-muted));
        margin-bottom: -1px;
        padding: 0 10px;
      }
      .tab.on {
        border-bottom-color: var(--text-strong, var(--fb-strong));
        color: var(--text-strong, var(--fb-strong));
      }
      .tab:hover:not(.on) {
        color: var(--text-strong, var(--fb-strong));
        background: transparent;
      }
      .list {
        display: grid;
        border: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        overflow: hidden;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
      }
      .item + .item {
        border-top: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .grow {
        flex: 1;
      }
      .date,
      .handle {
        font-size: var(--text-2xs, 11px);
        color: var(--text-faint, var(--fb-faint));
        min-width: 3.4em;
      }
      .amount {
        font-size: var(--text-sm, 13px);
        font-weight: var(--weight-medium, 500);
        color: var(--text-muted, var(--fb-muted));
      }
      .amount.good {
        color: var(--success-fg, #0b8a68);
      }
      .earned {
        display: grid;
        gap: 4px;
        padding: 14px 16px;
        border: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        background: var(--surface-card, var(--fb-card));
      }
      /* A balance is a quantity, so it is mono — same rule as the credit
         badge and the ledger. */
      .total {
        font-size: var(--text-3xl, 40px);
        font-weight: var(--weight-medium, 500);
        line-height: 1;
        letter-spacing: var(--tracking-display, -0.035em);
        color: var(--text-strong, var(--fb-strong));
      }
    `],i([l({type:String,attribute:"app-id"})],a.prototype,"appId",2),i([l({type:String,attribute:"invite-url"})],a.prototype,"inviteUrl",2),i([n()],a.prototype,"info",2),i([n()],a.prototype,"earnings",2),i([n()],a.prototype,"referees",2),i([n()],a.prototype,"tab",2),i([n()],a.prototype,"copied",2),a=i([h("openapps-referral")],a);export{a as OpenAppsReferral};
//# sourceMappingURL=openapps-referral.js.map
