import{a as m,b as s,d,e as g,f as p,g as u,m as c}from"./chunk-OUMOJ2PH.js";import{a as n}from"./chunk-LCQWCHVU.js";var i=class extends c{constructor(){super(...arguments);this.pageSize=25;this.appId="";this.noSummary=!1;this.entries=[];this.cursor=null;this.complete=!1;this.loaded=!1}connectedCallback(){super.connectedCallback(),this.refresh()}onSessionChange(){this.refresh()}async refresh(){this.entries=[],this.cursor=null,this.complete=!1,this.loaded=!1,await this.loadMore()}async loadMore(){let t=this.sdkOrNull;if(!t?.isLoggedIn){this.loaded=!0;return}let r=await this.run(()=>t.credits.history({cursor:this.cursor??void 0,limit:this.pageSize}));this.loaded=!0,r&&(this.entries=[...this.entries,...r.entries],this.cursor=r.next_cursor,this.complete=r.next_cursor===null)}get visible(){return this.appId?this.entries.filter(t=>t.app_id===this.appId):this.entries}get spending(){let t=new Map;for(let r of this.visible){if(r.amount>=0)continue;let l=h(r),e=t.get(l);e?(e.credits+=-r.amount,e.count+=1):t.set(l,{label:l,credits:-r.amount,count:1})}return[...t.values()].sort((r,l)=>l.credits-r.credits)}render(){if(!this.sdkOrNull)return s`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return s`<p class="muted">Sign in to see where your credits went.</p>`;if(!this.loaded)return s`<p class="muted">Loading…</p>`;let t=this.visible;if(t.length===0)return s`
        <p class="muted">
          Nothing yet. Credits you buy and spend both appear here, with what
          each one was for.
        </p>
        ${this.error?s`<p class="error" role="alert">${this.error}</p>`:d}
      `;let r=this.noSummary?[]:this.spending,l=r.reduce((e,b)=>e+b.credits,0);return s`
      ${r.length?s`
            <div class="summary">
              <div class="eyebrow">
                ${this.complete?"Spent, all time":"Spent, recent activity"}
              </div>
              <ul class="groups">
                ${r.map(e=>s`
                    <li>
                      <span class="what" title=${e.label}>${e.label}</span>
                      <span class="times muted"
                        >${e.count===1?"once":`${e.count}\xD7`}</span
                      >
                      <span class="mono amount">${e.credits.toLocaleString()}</span>
                      <!-- The bar is proportional to the largest row, not to
                           the total: with one dominant item every other bar
                           would round to nothing and the comparison people
                           actually want — this against that — disappears. -->
                      <span
                        class="bar"
                        style=${`--w:${Math.round(e.credits/r[0].credits*100)}%`}
                      ></span>
                    </li>
                  `)}
              </ul>
              <p class="caption">
                ${l.toLocaleString()} credits across ${t.length}
                ${t.length===1?"entry":"entries"}${this.complete?"":" so far"}.
              </p>
            </div>
          `:d}

      <div class="eyebrow rule">Activity</div>
      <ul class="entries">
        ${t.map(e=>s`
            <li>
              <span class="when muted">${v(e.created_at)}</span>
              <span class="what" title=${f(e)}
                >${f(e)}</span
              >
              <span class="mono amount ${e.amount<0?"debit":"credit"}">
                ${e.amount>0?"+":"\u2212"}${Math.abs(e.amount).toLocaleString()}
              </span>
              <span class="mono after muted" title="Balance after"
                >${e.balance_after.toLocaleString()}</span
              >
            </li>
          `)}
      </ul>

      ${this.cursor!==null?s`<button
            class="block"
            ?disabled=${this.busy}
            @click=${()=>{this.loadMore()}}
          >
            ${this.busy?"Loading\u2026":"Show earlier"}
          </button>`:d}
      ${this.error?s`<p class="error" role="alert">${this.error}</p>`:d}
    `}};i.styles=[c.baseStyles,m`
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
    `],n([p({type:Number,attribute:"page-size"})],i.prototype,"pageSize",2),n([p({type:String,attribute:"app-id"})],i.prototype,"appId",2),n([p({type:Boolean,attribute:"no-summary"})],i.prototype,"noSummary",2),n([u()],i.prototype,"entries",2),n([u()],i.prototype,"cursor",2),n([u()],i.prototype,"complete",2),n([u()],i.prototype,"loaded",2),i=n([g("openapps-history")],i);function h(a){let o=a.app_name??a.app_id??null,t=a.ref_id??null;return o&&t?`${o} \xB7 ${t}`:o||t||"Spent"}function f(a){switch(a.kind){case"debit":return h(a);case"topup":return"Credits purchased";case"referral_bonus":return"Referral bonus";case"adjustment":return a.ref_id?`Adjustment \u2014 ${a.ref_id}`:"Adjustment";case"refund":return a.amount<0?"Payment reversed":"Refund";default:return h(a)}}function v(a){let o=new Date(a*1e3);return Number.isNaN(o.getTime())?"":o.toLocaleDateString(void 0,{month:"short",day:"numeric"})}export{i as OpenAppsHistory,f as describeEntry,v as formatDate,h as spendLabel};
//# sourceMappingURL=openapps-history.js.map
