import{a as v,b as r,d as l,e as k,f as h,g as p,l as y,m as g}from"./chunk-OUMOJ2PH.js";import{a as c,b as u,c as f,d as b}from"./chunk-LCQWCHVU.js";var d,n=class extends g{constructor(){super(...arguments);this.rails="";this.returnTo="";this.packages=null;this.selected=null;this.instruction=null;this.topup=null;this.waiting=!1;f(this,d)}connectedCallback(){super.connectedCallback(),this.load()}disconnectedCallback(){u(this,d)?.abort(),super.disconnectedCallback()}onSessionChange(){if(!this.packages){this.load();return}this.requestUpdate()}async load(){if(!this.sdkOrNull)return;let e=await this.run(()=>this.sdk.payments.packages());e&&(this.packages=e)}get offeredRails(){if(!this.packages)return[];let e=["stripe","ethereum","lightning"].filter(a=>this.packages?.rails?.[a]),t=this.rails.split(",").map(a=>a.trim()).filter(Boolean);return t.length?e.filter(a=>t.includes(a)):e}async start(e){let t=this.selected;t&&await this.run(async()=>{let a;switch(e){case"stripe":{let i=await this.sdk.payments.stripeCheckout(t.id,{returnTo:this.returnTo==="none"?null:this.returnTo||void 0});this.instruction={kind:"redirect"},!this.dispatchEvent(new CustomEvent("openapps-checkout",{detail:{url:i.checkout_url,packageId:t.id},cancelable:!0,bubbles:!0,composed:!0}))||(window.location.href=i.checkout_url);return}case"ethereum":{let i=await this.sdk.payments.ethDepositAddress(t.id);a=i.topup_id,this.instruction={kind:"address",chain:i.chain,address:i.address,amount:i.expected_amount};break}case"lightning":{let i=await this.sdk.payments.lightningInvoice(t.id);a=i.topup_id,this.instruction={kind:"invoice",bolt11:i.bolt11,amountMsat:i.amount_msat};break}}this.watch(a,x[e])})}async watch(e,t){u(this,d)?.abort();let a=new AbortController;b(this,d,a),this.waiting=!0;try{let i=await this.sdk.payments.waitFor(e,{timeoutMs:t,signal:a.signal,onPoll:m=>{this.topup=m}});this.topup=i,i.status==="confirmed"&&(this.emit("openapps-topup",i),y())}catch(i){i instanceof Error&&i.name==="AbortError"||(this.error=R(i))}finally{this.waiting=!1}}reset(){u(this,d)?.abort(),this.selected=null,this.instruction=null,this.topup=null,this.error=null}render(){return this.sdkOrNull?this.sdk.isLoggedIn?this.packages?this.instruction?this.renderInstruction(this.instruction):this.selected?this.renderRails(this.selected):this.renderPackages(this.packages.packages??[]):r`<p class="muted">${this.error??"Loading packages\u2026"}</p>`:r`<p class="muted">Sign in to buy credits.</p>`:r`<p class="muted">Loading…</p>`}renderPackages(e){return e.length===0?r`<p class="muted">No credit packages are configured.</p>`:r`
      <div class="grid">
        ${e.map(t=>r`
            <button class="package" @click=${()=>this.selected=t}>
              <span class="credits">
                ${t.credits.toLocaleString()} credits
              </span>
              <span class="perunit caption">${T(t)}</span>
              <span class="price">${w(t.usd_price)}</span>
            </button>
          `)}
      </div>
      ${this.error?r`<p class="error" role="alert">${this.error}</p>`:l}
    `}renderRails(e){let t=this.offeredRails;return r`
      <p>
        <strong>${e.credits.toLocaleString()} credits</strong> —
        ${w(e.usd_price)}
      </p>
      <div class="stack">
        ${t.map(a=>r`
            <button class="primary" ?disabled=${this.busy} @click=${()=>this.start(a)}>
              ${$[a]}
            </button>
          `)}
        ${t.length===0?r`<p class="muted">No payment methods are enabled.</p>`:l}
        <button @click=${this.reset}>Back</button>
      </div>
      ${this.error?r`<p class="error" role="alert">${this.error}</p>`:l}
    `}renderInstruction(e){let t=this.topup?.status??"pending";return t==="confirmed"?r`
        <span class="badge success"><span class="dot"></span>Confirmed</span>
        <p class="ok">Payment confirmed — credits added.</p>
        <button @click=${this.reset}>Buy more</button>
      `:t==="failed"||t==="expired"?r`
        <span class="badge danger"><span class="dot"></span>${t==="failed"?"Failed":"Expired"}</span>
        <p class="error" role="alert">This top-up ${t}. Nothing was charged.</p>
        <button @click=${this.reset}>Try again</button>
      `:r`
      ${e.kind==="redirect"?r`<p class="muted">Redirecting to checkout…</p>`:l}
      ${e.kind==="address"?r`
            <p>Send exactly <strong>${P(e.amount,6)}</strong> USDC or
            USDT on <code>${e.chain}</code> to:</p>
            <code class="payload">${e.address}</code>
          `:l}
      ${e.kind==="invoice"?r`
            <p>Pay this Lightning invoice
            (<strong>${Math.ceil(e.amountMsat/1e3).toLocaleString()} sats</strong>):</p>
            <code class="payload">${e.bolt11}</code>
          `:l}
      ${e.kind!=="redirect"?r`
            <div class="row">
              <button @click=${()=>this.copy(C(e))}>Copy</button>
              <button @click=${this.reset}>Cancel</button>
            </div>
            ${this.renderWaiting()}
          `:l}
      ${this.error?r`<p class="error" role="alert">${this.error}</p>`:l}
    `}renderWaiting(){if(!this.waiting)return r`<p class="muted" aria-live="polite">Not watching for payment.</p>`;let e=this.topup?.confirmations;if(e===void 0)return r`<p class="muted" aria-live="polite">Waiting for payment…</p>`;let t=this.topup?.confirmations_required;if(t==null)return r`
        <p class="muted" aria-live="polite">
          Payment received — waiting for the network to finalise it.
        </p>
      `;let a=Math.min(e,t);return r`
      <p class="muted" aria-live="polite">
        Payment received — confirming (${a} of ${t}).
      </p>
      <progress
        class="confirms"
        max=${t}
        value=${a}
        aria-label="Confirmations"
      ></progress>
    `}async copy(e){try{await navigator.clipboard.writeText(e)}catch{this.error="Could not copy \u2014 select the text and copy it manually."}}};d=new WeakMap,n.styles=[g.baseStyles,v`
      /* Packs stack as rows rather than tiles: the numbers line up down the
         right edge, which is what makes three prices comparable at a glance. */
      .grid {
        display: grid;
        gap: 8px;
      }
      .package {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: auto;
        padding: 14px 16px;
        text-align: left;
        border-radius: var(--radius-lg, 12px);
      }
      .package:hover:not([disabled]) {
        border-color: var(--border-strong, var(--fb-hairline));
      }
      .credits {
        flex: 1;
        font: var(--weight-medium, 500) var(--text-base, 15px) / 1.2
          var(--font-sans, "Geist", system-ui, sans-serif);
        color: var(--text-strong, var(--fb-strong));
      }
      /* Money is always mono — balances, prices, per-unit rates, ledger
         amounts. Tabular figures keep the column aligned across packs. */
      .price {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: var(--text-md, 17px);
        color: var(--text-strong, var(--fb-strong));
      }
      .perunit {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-size: var(--text-2xs, 11px);
        color: var(--text-faint, var(--fb-faint));
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
      }
      .row {
        display: flex;
        gap: 0.5em;
        margin-top: 0.5em;
      }
      .ok {
        font-weight: 600;
      }
      .confirms {
        display: block;
        width: 100%;
        height: 0.4em;
        margin-top: 0.35em;
        border: none;
        border-radius: 999px;
        overflow: hidden;
        background: var(--surface-card, var(--fb-card));
        accent-color: var(--brand, var(--fb-brand));
      }
      /* WebKit ignores accent-color on <progress>, so colour it directly. */
      .confirms::-webkit-progress-bar {
        background: var(--surface-card, var(--fb-card));
      }
      .confirms::-webkit-progress-value {
        background: var(--brand, var(--fb-brand));
      }
    `],c([h({type:String})],n.prototype,"rails",2),c([h({type:String,attribute:"return-to"})],n.prototype,"returnTo",2),c([p()],n.prototype,"packages",2),c([p()],n.prototype,"selected",2),c([p()],n.prototype,"instruction",2),c([p()],n.prototype,"topup",2),c([p()],n.prototype,"waiting",2),n=c([k("openapps-buy")],n);var $={stripe:"Pay by card",ethereum:"Pay with USDC / USDT",lightning:"Pay with Lightning"},x={stripe:void 0,lightning:void 0,ethereum:1800*1e3};function C(s){return s.kind==="address"?s.address:s.kind==="invoice"?s.bolt11:""}function w(s){return`$${(s/100).toFixed(2)}`}function T(s){if(s.credits<=0)return"";let o=s.usd_price/s.credits;return`${o<1?o.toFixed(2):o.toFixed(1)}\xA2 each`}function P(s,o){let e=10**o;return(s/e).toFixed(o).replace(/\.?0+$/,"")}function R(s){let o=s instanceof Error?s.message:String(s);return o.includes("still pending")?"Still waiting on the network. Your credits will appear once the payment settles.":o}export{n as OpenAppsBuy,P as formatUnits,w as formatUsd,T as perCreditCost};
//# sourceMappingURL=openapps-buy.js.map
