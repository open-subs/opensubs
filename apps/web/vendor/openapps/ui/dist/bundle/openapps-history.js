import{a as f,c as n,e as u,f as b,g as p,h as c,n as v,o as h,p as e,q as m}from"./chunk-HLRRPXU7.js";import{a as l}from"./chunk-LCQWCHVU.js";var o=class extends m{constructor(){super(...arguments);this.pageSize=25;this.appId="";this.noSummary=!1;this.entries=[];this.cursor=null;this.complete=!1;this.loaded=!1}connectedCallback(){super.connectedCallback(),this.refresh()}onSessionChange(){this.refresh()}async refresh(){this.entries=[],this.cursor=null,this.complete=!1,this.loaded=!1,await this.loadMore()}async loadMore(){let t=this.sdkOrNull;if(!t?.isLoggedIn){this.loaded=!0;return}let a=this.entries,s=await this.run(()=>t.credits.history({cursor:this.cursor??void 0,limit:this.pageSize}));this.entries===a&&(this.loaded=!0,s&&(this.entries=[...this.entries,...s.entries],this.cursor=s.next_cursor,this.complete=s.next_cursor===null))}get visible(){return this.appId?this.entries.filter(t=>t.app_id===this.appId):this.entries}get spending(){let t=new Map;for(let a of this.visible){if(a.amount>=0)continue;let s=g(a),r=t.get(s);r?(r.credits+=-a.amount,r.count+=1):t.set(s,{label:s,credits:-a.amount,count:1})}return[...t.values()].sort((a,s)=>s.credits-a.credits)}render(){if(!this.sdkOrNull)return n`<p class="muted">${e("Loading\u2026")}</p>`;if(!this.sdk.isLoggedIn)return n`<p class="muted">${e("Sign in to see where your credits went.")}</p>`;if(!this.loaded)return n`<p class="muted">${e("Loading\u2026")}</p>`;let t=this.visible;if(t.length===0)return n`
        <p class="muted">
          ${e("Nothing yet. Credits you buy and spend both appear here, with what each one was for.")}
        </p>
        ${this.error?n`<p class="error" role="alert">${this.error}</p>`:u}
      `;let a=this.noSummary?[]:this.spending,s=a.reduce((r,y)=>r+y.credits,0);return n`
      ${a.length?n`
            <div class="summary">
              <div class="eyebrow">
                ${this.complete?e("Spent, all time"):e("Spent, recent activity")}
              </div>
              <ul class="groups">
                ${a.map(r=>n`
                    <li>
                      <span class="what" title=${r.label}>${r.label}</span>
                      <span class="times muted"
                        >${r.count===1?e("once"):`${r.count}\xD7`}</span
                      >
                      <span class="mono amount">${h(r.credits)}</span>
                      <!-- The bar is proportional to the largest row, not to
                           the total: with one dominant item every other bar
                           would round to nothing and the comparison people
                           actually want — this against that — disappears. -->
                      <span
                        class="bar"
                        style=${`--w:${Math.round(r.credits/a[0].credits*100)}%`}
                      ></span>
                    </li>
                  `)}
              </ul>
              <p class="caption">
                ${this.complete?t.length===1?e("{credits} credits across 1 entry.",{credits:s}):e("{credits} credits across {n} entries.",{credits:s,n:t.length}):t.length===1?e("{credits} credits across 1 entry so far.",{credits:s}):e("{credits} credits across {n} entries so far.",{credits:s,n:t.length})}
              </p>
            </div>
          `:u}

      <div class="eyebrow rule">${e("Activity")}</div>
      <ul class="entries">
        ${t.map(r=>n`
            <li>
              <span class="when muted">${$(r.created_at)}</span>
              <span class="what" title=${w(r)}
                >${w(r)}</span
              >
              <span class="mono amount ${r.amount<0?"debit":"credit"}">
                ${r.amount>0?"+":"\u2212"}${h(Math.abs(r.amount))}
              </span>
              <span class="mono after muted" title=${e("Balance after")}
                >${h(r.balance_after)}</span
              >
            </li>
          `)}
      </ul>

      ${this.cursor!==null?n`<button
            class="block"
            ?disabled=${this.busy}
            @click=${()=>{this.loadMore()}}
          >
            ${this.busy?e("Loading\u2026"):e("Show earlier")}
          </button>`:u}
      ${this.error?n`<p class="error" role="alert">${this.error}</p>`:u}
    `}};o.styles=[m.baseStyles,f`
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .summary {
        display: grid;
        gap: 8px;
        margin-bottom: 18px;
      }
      /* Label, count, amount — then the bar spanning the full width beneath,
         so a long feature name never squeezes the figure it belongs to. */
      .groups li {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: baseline;
        gap: 8px;
        padding: 5px 0;
      }
      .groups .bar {
        grid-column: 1 / -1;
        height: 3px;
        border-radius: var(--radius-full, 999px);
        background: var(--brand-soft, #e6f9f3);
        width: var(--w, 0%);
        min-width: 2px;
      }
      .times {
        font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      }
      .rule {
        display: block;
        padding-top: 12px;
        border-top: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .entries li {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        align-items: baseline;
        gap: 10px;
        padding: 7px 0;
        border-bottom: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .entries li:last-child {
        border-bottom: none;
      }
      .when {
        font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
        white-space: nowrap;
      }
      /* A feature name is arbitrary text from whichever app charged; it
         truncates rather than pushing the amount off the panel. */
      .what {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-strong, var(--fb-strong));
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      }
      .amount {
        font-weight: var(--weight-medium, 500);
        color: var(--text-strong, var(--fb-strong));
      }
      /* Spending is the ordinary case here, so it stays in the body colour;
         only money arriving is worth a tone. Colouring every debit red would
         make a working account look like a page of errors. */
      .amount.credit {
        color: var(--success-fg, #0b8a68);
      }
      .after {
        font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
        min-width: 3.5em;
        text-align: right;
      }
      button.block {
        margin-top: 12px;
      }
    `],l([p({type:Number,attribute:"page-size"})],o.prototype,"pageSize",2),l([p({type:String,attribute:"app-id"})],o.prototype,"appId",2),l([p({type:Boolean,attribute:"no-summary"})],o.prototype,"noSummary",2),l([c()],o.prototype,"entries",2),l([c()],o.prototype,"cursor",2),l([c()],o.prototype,"complete",2),l([c()],o.prototype,"loaded",2),o=l([b("openapps-history")],o);function g(i){let d=i.app_name??i.app_id??null,t=i.ref_id??null;return d&&t?`${d} \xB7 ${t}`:d||t||e("Spent")}function w(i){switch(i.kind){case"debit":return g(i);case"topup":return e("Credits purchased");case"referral_bonus":return e("Referral bonus");case"adjustment":return i.ref_id?e("Adjustment \u2014 {reason}",{reason:i.ref_id}):e("Adjustment");case"refund":return i.amount<0?e("Payment reversed"):e("Refund");default:return g(i)}}function $(i){let d=new Date(i*1e3);return Number.isNaN(d.getTime())?"":d.toLocaleDateString(v(),{month:"short",day:"numeric"})}export{o as OpenAppsHistory,w as describeEntry,$ as formatDate,g as spendLabel};
//# sourceMappingURL=openapps-history.js.map
