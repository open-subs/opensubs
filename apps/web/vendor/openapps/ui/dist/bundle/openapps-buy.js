import{a as $,c as s,e as c,f as y,g as f,h,m as w,o as m,p as e,q as b}from"./chunk-HLRRPXU7.js";import{a as p,b as g,c as k,d as v}from"./chunk-LCQWCHVU.js";var P="USD\u20AE0 is issued by Tether, which can freeze any address holding it.",u,d=class extends b{constructor(){super(...arguments);this.rails="";this.returnTo="";this.packages=null;this.selected=null;this.instruction=null;this.topup=null;this.waiting=!1;k(this,u)}connectedCallback(){super.connectedCallback(),this.load()}disconnectedCallback(){g(this,u)?.abort(),super.disconnectedCallback()}onSessionChange(){if(!this.packages){this.load();return}this.requestUpdate()}async load(){if(!this.sdkOrNull)return;let t=await this.run(()=>this.sdk.payments.packages());t&&(this.packages=t)}get offeredRails(){if(!this.packages)return[];let t=["stripe","ethereum","lightning","usdt0"].filter(i=>this.packages?.rails?.[i]===!0).filter(i=>i!=="usdt0"||this.usdt0Networks.length>0),r=this.rails.split(",").map(i=>i.trim()).filter(Boolean);return r.length?t.filter(i=>r.includes(i)):t}get usdt0Networks(){let t=this.packages?.usdt0?.networks;return Array.isArray(t)?t:[]}get usdt0Notice(){return this.packages?.usdt0?.notice||P}async start(t,r){let i=this.selected;i&&await this.run(async()=>{let o;switch(t){case"stripe":{let a=await this.sdk.payments.stripeCheckout(i.id,{returnTo:this.returnTo==="none"?null:this.returnTo||void 0});this.instruction={kind:"redirect"},!this.dispatchEvent(new CustomEvent("openapps-checkout",{detail:{url:a.checkout_url,packageId:i.id},cancelable:!0,bubbles:!0,composed:!0}))||(window.location.href=a.checkout_url);return}case"ethereum":{let a=await this.sdk.payments.ethDepositAddress(i.id);o=a.topup_id,this.instruction={kind:"address",chain:a.chain,address:a.address,amount:a.expected_amount};break}case"usdt0":{if(!r)return;let a=await this.sdk.payments.usdt0DepositAddress(i.id,r.id);o=a.topup_id,this.instruction={kind:"address",chain:a.chain,address:a.address,amount:a.expected_amount,usdt0:{token:a.token?.symbol||"USD\u20AE0",networkName:a.network_name||r.name,notice:a.notice||this.usdt0Notice}};break}case"lightning":{let a=await this.sdk.payments.lightningInvoice(i.id);o=a.topup_id,this.instruction={kind:"invoice",bolt11:a.bolt11,amountMsat:a.amount_msat};break}}this.watch(o,S[t])})}async watch(t,r){g(this,u)?.abort();let i=new AbortController;v(this,u,i),this.waiting=!0;try{let o=await this.sdk.payments.waitFor(t,{timeoutMs:r,signal:i.signal,onPoll:a=>{this.topup=a}});this.topup=o,o.status==="confirmed"&&(this.emit("openapps-topup",o),w())}catch(o){o instanceof Error&&o.name==="AbortError"||(this.error=U(o))}finally{this.waiting=!1}}reset(){g(this,u)?.abort(),this.selected=null,this.instruction=null,this.topup=null,this.error=null}render(){return this.sdkOrNull?this.sdk.isLoggedIn?this.packages?this.instruction?this.renderInstruction(this.instruction):this.selected?this.renderRails(this.selected):this.renderPackages(this.packages.packages??[]):s`<p class="muted">${this.error??e("Loading packages\u2026")}</p>`:s`<p class="muted">${e("Sign in to buy credits.")}</p>`:s`<p class="muted">${e("Loading\u2026")}</p>`}renderPackages(t){return t.length===0?s`<p class="muted">${e("No credit packages are configured.")}</p>`:s`
      <div class="grid">
        ${t.map(r=>s`
            <button class="package" @click=${()=>this.selected=r}>
              <span class="credits">
                ${e("{n} credits",{n:r.credits})}
              </span>
              <span class="perunit caption">${R(r)}</span>
              <span class="price">${T(r.usd_price)}</span>
            </button>
          `)}
      </div>
      ${this.error?s`<p class="error" role="alert">${this.error}</p>`:c}
    `}renderRails(t){let r=this.offeredRails;return s`
      <p>
        <strong>${e("{n} credits",{n:t.credits})}</strong> —
        ${T(t.usd_price)}
      </p>
      <div class="stack">
        ${r.map(i=>i==="usdt0"?this.renderUsdt0Options():s`
                <button class="primary" ?disabled=${this.busy} @click=${()=>this.start(i)}>
                  ${e(x[i])}
                </button>
              `)}
        ${r.length===0?s`<p class="muted">${e("No payment methods are enabled.")}</p>`:c}
        <button @click=${this.reset}>${e("Back")}</button>
      </div>
      ${this.error?s`<p class="error" role="alert">${this.error}</p>`:c}
    `}renderUsdt0Options(){return s`
      <div class="usdt0" role="group" aria-label="Pay with USD₮">
        ${this.usdt0Networks.map(t=>s`
            <button
              class="primary"
              ?disabled=${this.busy}
              @click=${()=>this.start("usdt0",t)}
            >
              ${x.usdt0} on ${t.name}
            </button>
          `)}
        <p class="caption freezable">
          <strong>Issuer-freezable.</strong> ${this.usdt0Notice}
        </p>
      </div>
    `}renderInstruction(t){let r=this.topup?.status??"pending";return r==="confirmed"?s`
        <span class="badge success"><span class="dot"></span>${e("Confirmed")}</span>
        <p class="ok">${e("Payment confirmed \u2014 credits added.")}</p>
        <button @click=${this.reset}>${e("Buy more")}</button>
      `:r==="failed"||r==="expired"?s`
        <span class="badge danger"><span class="dot"></span>${r==="failed"?e("Failed"):e("Expired")}</span>
        <p class="error" role="alert">${r==="failed"?e("This top-up failed. Nothing was charged."):e("This top-up expired. Nothing was charged.")}</p>
        <button @click=${this.reset}>${e("Try again")}</button>
      `:s`
      ${t.kind==="redirect"?s`<p class="muted">${e("Redirecting to checkout\u2026")}</p>`:c}
      ${t.kind==="address"&&t.usdt0?s`
            <p>Send exactly <strong>${C(t.amount,6)}</strong>
            ${t.usdt0.token} on <strong>${t.usdt0.networkName}</strong>
            to:</p>
            <code class="payload">${t.address}</code>
            <p class="caption">
              Only ${t.usdt0.token} on ${t.usdt0.networkName} is credited
              to this address; other tokens or networks are not.
            </p>
            <p class="caption freezable">
              <strong>Issuer-freezable.</strong> ${t.usdt0.notice}
            </p>
          `:c}
      ${t.kind==="address"&&!t.usdt0?s`
            <p>${e("Send exactly")} <strong>${C(t.amount,6)}</strong> ${e("USDC or USDT on")}
            <code>${t.chain}</code> ${e("to:")}</p>
            <code class="payload">${t.address}</code>
          `:c}
      ${t.kind==="invoice"?s`
            <p>${e("Pay this Lightning invoice")}
            (<strong>${e("{n} sats",{n:Math.ceil(t.amountMsat/1e3)})}</strong>):</p>
            <code class="payload">${t.bolt11}</code>
          `:c}
      ${t.kind!=="redirect"?s`
            <div class="row">
              <button @click=${()=>this.copy(N(t))}>${e("Copy")}</button>
              <button @click=${this.reset}>${e("Cancel")}</button>
            </div>
            ${this.renderWaiting()}
          `:c}
      ${this.error?s`<p class="error" role="alert">${this.error}</p>`:c}
    `}renderWaiting(){if(!this.waiting)return s`<p class="muted" aria-live="polite">${e("Not watching for payment.")}</p>`;let t=this.topup?.confirmations;if(t===void 0)return s`<p class="muted" aria-live="polite">${e("Waiting for payment\u2026")}</p>`;let r=this.topup?.confirmations_required;if(r==null)return s`
        <p class="muted" aria-live="polite">
          ${e("Payment received \u2014 waiting for the network to finalise it.")}
        </p>
      `;let i=Math.min(t,r);return s`
      <p class="muted" aria-live="polite">
        ${e("Payment received \u2014 confirming ({done} of {required}).",{done:String(i),required:String(r)})}
      </p>
      <progress
        class="confirms"
        max=${r}
        value=${i}
        aria-label=${e("Confirmations")}
      ></progress>
    `}async copy(t){try{await navigator.clipboard.writeText(t)}catch{this.error=e("Could not copy \u2014 select the text and copy it manually.")}}};u=new WeakMap,d.styles=[b.baseStyles,$`
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
      .usdt0 {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
      }
      .freezable {
        margin: 0;
        color: var(--text-muted, var(--fb-muted));
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
    `],p([f({type:String})],d.prototype,"rails",2),p([f({type:String,attribute:"return-to"})],d.prototype,"returnTo",2),p([h()],d.prototype,"packages",2),p([h()],d.prototype,"selected",2),p([h()],d.prototype,"instruction",2),p([h()],d.prototype,"topup",2),p([h()],d.prototype,"waiting",2),d=p([y("openapps-buy")],d);var x={stripe:"Pay by card",ethereum:"Pay with USDC / USDT",lightning:"Pay with Lightning",usdt0:"Pay with USD\u20AE"},S={stripe:void 0,lightning:void 0,ethereum:1800*1e3,usdt0:2400*1e3};function N(n){return n.kind==="address"?n.address:n.kind==="invoice"?n.bolt11:""}function T(n){return m(n/100,{style:"currency",currency:"USD"})}function R(n){if(n.credits<=0)return"";let l=n.usd_price/n.credits,t=l<1?2:1;return e("{cents}\xA2 each",{cents:m(l,{minimumFractionDigits:t,maximumFractionDigits:t})})}function C(n,l){return m(n/10**l,{maximumFractionDigits:l,useGrouping:!1})}function U(n){let l=n instanceof Error?n.message:String(n);return l.includes("still pending")?e("Still waiting on the network. Your credits will appear once the payment settles."):l}export{d as OpenAppsBuy,C as formatUnits,T as formatUsd,R as perCreditCost};
//# sourceMappingURL=openapps-buy.js.map
