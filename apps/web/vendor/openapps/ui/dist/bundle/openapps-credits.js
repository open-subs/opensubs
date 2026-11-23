import{a as m,c as s,e as u,f,g as n,h as b,o as h,p as i,q as l}from"./chunk-HLRRPXU7.js";import{a,b as r,c as p,d}from"./chunk-LCQWCHVU.js";var t,e=class extends l{constructor(){super(...arguments);this.pollSeconds=0;this.label="Credits";this.balance=null;p(this,t)}connectedCallback(){super.connectedCallback(),this.refresh(),this.pollSeconds>0&&d(this,t,setInterval(()=>{this.refresh()},this.pollSeconds*1e3))}disconnectedCallback(){r(this,t)&&clearInterval(r(this,t)),super.disconnectedCallback()}onSessionChange(){this.refresh()}async refresh(){let o=this.sdkOrNull;if(!o?.isLoggedIn){this.balance=null;return}let c=await this.run(()=>o.credits.balance());c!==void 0&&(this.balance=c)}render(){return this.sdkOrNull?this.sdk.isLoggedIn?s`
      <span class="wrap">
        <span class="label muted">${i(this.label)}</span>
        <span class="value" aria-live="polite"
          >${this.balance===null?"\u2026":h(this.balance)}</span
        >
      </span>
      ${this.error?s`<span class="error" role="alert">${this.error}</span>`:u}
    `:s`<span class="muted">${i("Not signed in")}</span>`:s`<span class="muted">…</span>`}};t=new WeakMap,e.styles=[l.baseStyles,m`
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
    `],a([n({type:Number,attribute:"poll-seconds"})],e.prototype,"pollSeconds",2),a([n({type:String})],e.prototype,"label",2),a([b()],e.prototype,"balance",2),e=a([f("openapps-credits")],e);export{e as OpenAppsCredits};
//# sourceMappingURL=openapps-credits.js.map
