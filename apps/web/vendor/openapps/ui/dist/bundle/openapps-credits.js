import{a as d,b as s,d as u,e as m,f as r,g as f,m as i}from"./chunk-OUMOJ2PH.js";import{a,b as n,c,d as p}from"./chunk-LCQWCHVU.js";var t,e=class extends i{constructor(){super(...arguments);this.pollSeconds=0;this.label="Credits";this.balance=null;c(this,t)}connectedCallback(){super.connectedCallback(),this.refresh(),this.pollSeconds>0&&p(this,t,setInterval(()=>{this.refresh()},this.pollSeconds*1e3))}disconnectedCallback(){n(this,t)&&clearInterval(n(this,t)),super.disconnectedCallback()}onSessionChange(){this.refresh()}async refresh(){let l=this.sdkOrNull;if(!l?.isLoggedIn){this.balance=null;return}let o=await this.run(()=>l.credits.balance());o!==void 0&&(this.balance=o)}render(){return this.sdkOrNull?this.sdk.isLoggedIn?s`
      <span class="wrap">
        <span class="label muted">${this.label}</span>
        <span class="value" aria-live="polite"
          >${this.balance===null?"\u2026":this.balance.toLocaleString()}</span
        >
      </span>
      ${this.error?s`<span class="error" role="alert">${this.error}</span>`:u}
    `:s`<span class="muted">Not signed in</span>`:s`<span class="muted">…</span>`}};t=new WeakMap,e.styles=[i.baseStyles,d`
      :host {
        display: inline-block;
      }
      .wrap {
        display: inline-flex;
        align-items: baseline;
        gap: 0.4em;
      }
      .label {
        font: var(--type-eyebrow, 500 12px/1.2 "Geist", system-ui, sans-serif);
        letter-spacing: var(--tracking-caps, 0.08em);
        text-transform: uppercase;
        color: var(--text-faint, var(--fb-faint));
      }
      /* A balance is a quantity, so it is set in mono. Tabular figures also
         stop the number jittering sideways as it ticks over on poll. */
      .value {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-weight: var(--weight-medium, 500);
        color: var(--text-strong, var(--fb-strong));
      }
    `],a([r({type:Number,attribute:"poll-seconds"})],e.prototype,"pollSeconds",2),a([r({type:String})],e.prototype,"label",2),a([f()],e.prototype,"balance",2),e=a([m("openapps-credits")],e);export{e as OpenAppsCredits};
//# sourceMappingURL=openapps-credits.js.map
