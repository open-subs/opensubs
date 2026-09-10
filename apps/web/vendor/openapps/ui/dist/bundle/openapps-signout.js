import{a as i,b as r,d as o,e as a,f as n,g as d,l,m as s}from"./chunk-OUMOJ2PH.js";import{a as t}from"./chunk-LCQWCHVU.js";var e=class extends s{constructor(){super(...arguments);this.label="Sign out";this.signedIn=!1}connectedCallback(){super.connectedCallback(),this.refresh()}refresh(){this.signedIn=this.sdkOrNull?.isLoggedIn??!1}onSessionChange(){this.refresh()}async signOut(){await this.run(()=>this.sdk.auth.logout()),this.signedIn=!1,this.emit("openapps-logout",null),l()}render(){return this.signedIn?r`
      <button ?disabled=${this.busy} @click=${this.signOut}>${this.label}</button>
      ${this.error?r`<p class="error" role="alert">${this.error}</p>`:o}
    `:o}};e.styles=[s.baseStyles,i`
      /* Full width and quiet. Nobody opens an account screen in order to
         sign out, and it is the one control there that ends a session —
         so it should be easy to find and hard to hit by accident. */
      button {
        display: block;
        width: 100%;
        font-size: 0.875rem;
        padding: 9px 12px;
        border-radius: var(--radius-md, 8px);
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        background: transparent;
        color: var(--text-muted, var(--fb-muted));
        cursor: pointer;
      }
      button:hover:not(:disabled) {
        color: var(--text-strong, var(--fb-strong));
        border-color: var(--text-muted, var(--fb-muted));
      }
    `],t([n({type:String})],e.prototype,"label",2),t([d()],e.prototype,"signedIn",2),e=t([a("openapps-signout")],e);export{e as OpenAppsSignout};
//# sourceMappingURL=openapps-signout.js.map
