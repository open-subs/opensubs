import{a as P}from"./chunk-LCQWCHVU.js";var D=globalThis,j=D.ShadowRoot&&(D.ShadyCSS===void 0||D.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,K=Symbol(),fe=new WeakMap,C=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==K)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(j&&e===void 0){let r=t!==void 0&&t.length===1;r&&(e=fe.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),r&&fe.set(t,e))}return e}toString(){return this.cssText}},ge=s=>new C(typeof s=="string"?s:s+"",void 0,K),J=(s,...e)=>{let t=s.length===1?s[0]:e.reduce((r,n,o)=>r+(i=>{if(i._$cssResult$===!0)return i.cssText;if(typeof i=="number")return i;throw Error("Value passed to 'css' function must be a 'css' function result: "+i+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+s[o+1],s[0]);return new C(t,s,K)},me=(s,e)=>{if(j)s.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let r=document.createElement("style"),n=D.litNonce;n!==void 0&&r.setAttribute("nonce",n),r.textContent=t.cssText,s.appendChild(r)}},W=j?s=>s:s=>s instanceof CSSStyleSheet?(e=>{let t="";for(let r of e.cssRules)t+=r.cssText;return ge(t)})(s):s;var{is:De,defineProperty:je,getOwnPropertyDescriptor:ze,getOwnPropertyNames:Be,getOwnPropertySymbols:Ge,getPrototypeOf:Fe}=Object,z=globalThis,be=z.trustedTypes,Ve=be?be.emptyScript:"",Ke=z.reactiveElementPolyfillSupport,O=(s,e)=>s,T={toAttribute(s,e){switch(e){case Boolean:s=s?Ve:null;break;case Object:case Array:s=s==null?s:JSON.stringify(s)}return s},fromAttribute(s,e){let t=s;switch(e){case Boolean:t=s!==null;break;case Number:t=s===null?null:Number(s);break;case Object:case Array:try{t=JSON.parse(s)}catch{t=null}}return t}},B=(s,e)=>!De(s,e),ye={attribute:!0,type:String,converter:T,reflect:!1,useDefault:!1,hasChanged:B};Symbol.metadata??=Symbol("metadata"),z.litPropertyMetadata??=new WeakMap;var g=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ye){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let r=Symbol(),n=this.getPropertyDescriptor(e,r,t);n!==void 0&&je(this.prototype,e,n)}}static getPropertyDescriptor(e,t,r){let{get:n,set:o}=ze(this.prototype,e)??{get(){return this[t]},set(i){this[t]=i}};return{get:n,set(i){let a=n?.call(this);o?.call(this,i),this.requestUpdate(e,a,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ye}static _$Ei(){if(this.hasOwnProperty(O("elementProperties")))return;let e=Fe(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(O("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(O("properties"))){let t=this.properties,r=[...Be(t),...Ge(t)];for(let n of r)this.createProperty(n,t[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[r,n]of t)this.elementProperties.set(r,n)}this._$Eh=new Map;for(let[t,r]of this.elementProperties){let n=this._$Eu(t,r);n!==void 0&&this._$Eh.set(n,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let r=new Set(e.flat(1/0).reverse());for(let n of r)t.unshift(W(n))}else e!==void 0&&t.push(W(e));return t}static _$Eu(e,t){let r=t.attribute;return r===!1?void 0:typeof r=="string"?r:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let r of t.keys())this.hasOwnProperty(r)&&(e.set(r,this[r]),delete this[r]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return me(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,r){this._$AK(e,r)}_$ET(e,t){let r=this.constructor.elementProperties.get(e),n=this.constructor._$Eu(e,r);if(n!==void 0&&r.reflect===!0){let o=(r.converter?.toAttribute!==void 0?r.converter:T).toAttribute(t,r.type);this._$Em=e,o==null?this.removeAttribute(n):this.setAttribute(n,o),this._$Em=null}}_$AK(e,t){let r=this.constructor,n=r._$Eh.get(e);if(n!==void 0&&this._$Em!==n){let o=r.getPropertyOptions(n),i=typeof o.converter=="function"?{fromAttribute:o.converter}:o.converter?.fromAttribute!==void 0?o.converter:T;this._$Em=n;let a=i.fromAttribute(t,o.type);this[n]=a??this._$Ej?.get(n)??a,this._$Em=null}}requestUpdate(e,t,r,n=!1,o){if(e!==void 0){let i=this.constructor;if(n===!1&&(o=this[e]),r??=i.getPropertyOptions(e),!((r.hasChanged??B)(o,t)||r.useDefault&&r.reflect&&o===this._$Ej?.get(e)&&!this.hasAttribute(i._$Eu(e,r))))return;this.C(e,t,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:r,reflect:n,wrapped:o},i){r&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,i??t??this[e]),o!==!0||i!==void 0)||(this._$AL.has(e)||(this.hasUpdated||r||(t=void 0),this._$AL.set(e,t)),n===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,o]of this._$Ep)this[n]=o;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[n,o]of r){let{wrapped:i}=o,a=this[n];i!==!0||this._$AL.has(n)||a===void 0||this.C(n,void 0,o,a)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(t)):this._$EM()}catch(r){throw e=!1,this._$EM(),r}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};g.elementStyles=[],g.shadowRootOptions={mode:"open"},g[O("elementProperties")]=new Map,g[O("finalized")]=new Map,Ke?.({ReactiveElement:g}),(z.reactiveElementVersions??=[]).push("2.1.2");var re=globalThis,ve=s=>s,G=re.trustedTypes,_e=G?G.createPolicy("lit-html",{createHTML:s=>s}):void 0,ke="$lit$",b=`lit$${Math.random().toFixed(9).slice(2)}$`,Ee="?"+b,Je=`<${Ee}>`,$=document,R=()=>$.createComment(""),L=s=>s===null||typeof s!="object"&&typeof s!="function",ne=Array.isArray,We=s=>ne(s)||typeof s?.[Symbol.iterator]=="function",Q=`[ 	
\f\r]`,U=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,$e=/-->/g,we=/>/g,v=RegExp(`>|${Q}(?:([^\\s"'>=/]+)(${Q}*=${Q}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),xe=/'/g,Se=/"/g,Pe=/^(?:script|style|textarea|title)$/i,se=s=>(e,...t)=>({_$litType$:s,strings:e,values:t}),Pt=se(1),Ct=se(2),Ot=se(3),w=Symbol.for("lit-noChange"),u=Symbol.for("lit-nothing"),Ae=new WeakMap,_=$.createTreeWalker($,129);function Ce(s,e){if(!ne(s)||!s.hasOwnProperty("raw"))throw Error("invalid template strings array");return _e!==void 0?_e.createHTML(e):e}var Qe=(s,e)=>{let t=s.length-1,r=[],n,o=e===2?"<svg>":e===3?"<math>":"",i=U;for(let a=0;a<t;a++){let l=s[a],c,d,h=-1,f=0;for(;f<l.length&&(i.lastIndex=f,d=i.exec(l),d!==null);)f=i.lastIndex,i===U?d[1]==="!--"?i=$e:d[1]!==void 0?i=we:d[2]!==void 0?(Pe.test(d[2])&&(n=RegExp("</"+d[2],"g")),i=v):d[3]!==void 0&&(i=v):i===v?d[0]===">"?(i=n??U,h=-1):d[1]===void 0?h=-2:(h=i.lastIndex-d[2].length,c=d[1],i=d[3]===void 0?v:d[3]==='"'?Se:xe):i===Se||i===xe?i=v:i===$e||i===we?i=U:(i=v,n=void 0);let m=i===v&&s[a+1].startsWith("/>")?" ":"";o+=i===U?l+Je:h>=0?(r.push(c),l.slice(0,h)+ke+l.slice(h)+b+m):l+b+(h===-2?a:m)}return[Ce(s,o+(s[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),r]},N=class s{constructor({strings:e,_$litType$:t},r){let n;this.parts=[];let o=0,i=0,a=e.length-1,l=this.parts,[c,d]=Qe(e,t);if(this.el=s.createElement(c,r),_.currentNode=this.el.content,t===2||t===3){let h=this.el.content.firstChild;h.replaceWith(...h.childNodes)}for(;(n=_.nextNode())!==null&&l.length<a;){if(n.nodeType===1){if(n.hasAttributes())for(let h of n.getAttributeNames())if(h.endsWith(ke)){let f=d[i++],m=n.getAttribute(h).split(b),H=/([.?@])?(.*)/.exec(f);l.push({type:1,index:o,name:H[2],strings:m,ctor:H[1]==="."?Z:H[1]==="?"?X:H[1]==="@"?ee:A}),n.removeAttribute(h)}else h.startsWith(b)&&(l.push({type:6,index:o}),n.removeAttribute(h));if(Pe.test(n.tagName)){let h=n.textContent.split(b),f=h.length-1;if(f>0){n.textContent=G?G.emptyScript:"";for(let m=0;m<f;m++)n.append(h[m],R()),_.nextNode(),l.push({type:2,index:++o});n.append(h[f],R())}}}else if(n.nodeType===8)if(n.data===Ee)l.push({type:2,index:o});else{let h=-1;for(;(h=n.data.indexOf(b,h+1))!==-1;)l.push({type:7,index:o}),h+=b.length-1}o++}}static createElement(e,t){let r=$.createElement("template");return r.innerHTML=e,r}};function S(s,e,t=s,r){if(e===w)return e;let n=r!==void 0?t._$Co?.[r]:t._$Cl,o=L(e)?void 0:e._$litDirective$;return n?.constructor!==o&&(n?._$AO?.(!1),o===void 0?n=void 0:(n=new o(s),n._$AT(s,t,r)),r!==void 0?(t._$Co??=[])[r]=n:t._$Cl=n),n!==void 0&&(e=S(s,n._$AS(s,e.values),n,r)),e}var Y=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:r}=this._$AD,n=(e?.creationScope??$).importNode(t,!0);_.currentNode=n;let o=_.nextNode(),i=0,a=0,l=r[0];for(;l!==void 0;){if(i===l.index){let c;l.type===2?c=new M(o,o.nextSibling,this,e):l.type===1?c=new l.ctor(o,l.name,l.strings,this,e):l.type===6&&(c=new te(o,this,e)),this._$AV.push(c),l=r[++a]}i!==l?.index&&(o=_.nextNode(),i++)}return _.currentNode=$,n}p(e){let t=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(e,r,t),t+=r.strings.length-2):r._$AI(e[t])),t++}},M=class s{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,r,n){this.type=2,this._$AH=u,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=r,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=S(this,e,t),L(e)?e===u||e==null||e===""?(this._$AH!==u&&this._$AR(),this._$AH=u):e!==this._$AH&&e!==w&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):We(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==u&&L(this._$AH)?this._$AA.nextSibling.data=e:this.T($.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:r}=e,n=typeof r=="number"?this._$AC(e):(r.el===void 0&&(r.el=N.createElement(Ce(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===n)this._$AH.p(t);else{let o=new Y(n,this),i=o.u(this.options);o.p(t),this.T(i),this._$AH=o}}_$AC(e){let t=Ae.get(e.strings);return t===void 0&&Ae.set(e.strings,t=new N(e)),t}k(e){ne(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,r,n=0;for(let o of e)n===t.length?t.push(r=new s(this.O(R()),this.O(R()),this,this.options)):r=t[n],r._$AI(o),n++;n<t.length&&(this._$AR(r&&r._$AB.nextSibling,n),t.length=n)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let r=ve(e).nextSibling;ve(e).remove(),e=r}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},A=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,r,n,o){this.type=1,this._$AH=u,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=o,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=u}_$AI(e,t=this,r,n){let o=this.strings,i=!1;if(o===void 0)e=S(this,e,t,0),i=!L(e)||e!==this._$AH&&e!==w,i&&(this._$AH=e);else{let a=e,l,c;for(e=o[0],l=0;l<o.length-1;l++)c=S(this,a[r+l],t,l),c===w&&(c=this._$AH[l]),i||=!L(c)||c!==this._$AH[l],c===u?e=u:e!==u&&(e+=(c??"")+o[l+1]),this._$AH[l]=c}i&&!n&&this.j(e)}j(e){e===u?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},Z=class extends A{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===u?void 0:e}},X=class extends A{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==u)}},ee=class extends A{constructor(e,t,r,n,o){super(e,t,r,n,o),this.type=5}_$AI(e,t=this){if((e=S(this,e,t,0)??u)===w)return;let r=this._$AH,n=e===u&&r!==u||e.capture!==r.capture||e.once!==r.once||e.passive!==r.passive,o=e!==u&&(r===u||n);n&&this.element.removeEventListener(this.name,this,r),o&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},te=class{constructor(e,t,r){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(e){S(this,e)}};var Ye=re.litHtmlPolyfillSupport;Ye?.(N,M),(re.litHtmlVersions??=[]).push("3.3.3");var Oe=(s,e,t)=>{let r=t?.renderBefore??e,n=r._$litPart$;if(n===void 0){let o=t?.renderBefore??null;r._$litPart$=n=new M(e.insertBefore(R(),o),o,void 0,t??{})}return n._$AI(s),n};var oe=globalThis,y=class extends g{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Oe(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return w}};y._$litElement$=!0,y.finalized=!0,oe.litElementHydrateSupport?.({LitElement:y});var Ze=oe.litElementPolyfillSupport;Ze?.({LitElement:y});(oe.litElementVersions??=[]).push("4.2.2");var Bt=s=>(e,t)=>{t!==void 0?t.addInitializer(()=>{customElements.define(s,e)}):customElements.define(s,e)};var Xe={attribute:!0,type:String,converter:T,reflect:!1,hasChanged:B},et=(s=Xe,e,t)=>{let{kind:r,metadata:n}=t,o=globalThis.litPropertyMetadata.get(n);if(o===void 0&&globalThis.litPropertyMetadata.set(n,o=new Map),r==="setter"&&((s=Object.create(s)).wrapped=!0),o.set(t.name,s),r==="accessor"){let{name:i}=t;return{set(a){let l=e.get.call(this);e.set.call(this,a),this.requestUpdate(i,l,s,!0,a)},init(a){return a!==void 0&&this.C(i,void 0,s,a),a}}}if(r==="setter"){let{name:i}=t;return function(a){let l=this[i];e.call(this,a),this.requestUpdate(i,l,s,!0,a)}}throw Error("Unsupported decorator location: "+r)};function I(s){return(e,t)=>typeof t=="object"?et(s,e,t):((r,n,o)=>{let i=n.hasOwnProperty(o);return n.constructor.createProperty(o,r),i?Object.getOwnPropertyDescriptor(n,o):void 0})(s,e,t)}function ie(s){return I({...s,state:!0,attribute:!1})}var p=class extends Error{code;status;balance;detail;constructor(e,t,r=0,n,o){super(t),this.name="OpenAppsError",this.code=e,this.status=r,this.balance=n,this.detail=o}get isAuthError(){return this.code==="unauthorized"||this.code==="reauth_required"}},tt={400:"bad_request",401:"unauthorized",402:"insufficient_balance",404:"not_found",409:"conflict",429:"rate_limited"};function ae(s,e){let t=e&&typeof e=="object"?e.error:void 0,r=t&&typeof t=="object"?t:void 0,n=r?.code??tt[s]??"internal",o=r?.message??`request failed with status ${s}`,i;if(n==="insufficient_balance"){let a=/-?\d+/.exec(o);a&&(i=Number(a[0]))}return new p(n,o,s,i,r)}function le(s=null){let e=s;return{get:()=>e,set:t=>{e=t}}}function rt(s="openapps.session"){let e=null;try{e=typeof localStorage<"u"?localStorage:null,e?.setItem(s,e.getItem(s)??""),e?.getItem(s)===""&&e.removeItem(s)}catch{e=null}if(!e)return le();let t=e;return{get(){let r=t.getItem(s);if(!r)return null;try{let n=JSON.parse(r);return n.accessToken&&n.refreshToken?n:null}catch{return null}},set(r){r?t.setItem(s,JSON.stringify(r)):t.removeItem(s)}}}function Te(){try{return typeof localStorage<"u"?rt():le()}catch{return le()}}var nt=new Set(["confirmed","failed","expired"]),q=class{baseUrl;#r;#n;#i;#l;#s=null;#o=null;constructor(e){this.baseUrl=e.baseUrl.replace(/\/+$/,""),this.#r=e.appKey,this.#n=e.store??Te();let t=e.fetch??globalThis.fetch;if(!t)throw new p("network","no fetch implementation available; pass one via options.fetch");this.#i=(r,n)=>t(r,n),this.#l=e.onAuthChange}get session(){return this.#n.get()}get isLoggedIn(){return this.#n.get()!==null}#t(e){this.#n.set(e),this.#l?.(e)}adoptSession(e,t){this.#t({accessToken:e,refreshToken:t})}clearSession(){this.#t(null)}async#e(e,t={}){let r=t.auth??"none";if(r!=="none"&&!this.#n.get())throw new p("unauthorized","not logged in");if(r==="app+bearer"&&!this.#r)throw new p("unauthorized","this call needs an app key; construct OpenApps with { appKey }");return this.#a(e,t,r,!0)}async#a(e,t,r,n){let o=`${this.baseUrl}${e}`;if(t.query){let c=new URLSearchParams;for(let[h,f]of Object.entries(t.query))f!==void 0&&c.set(h,String(f));let d=c.toString();d&&(o+=`?${d}`)}let i={accept:"application/json"};t.body!==void 0&&(i["content-type"]="application/json"),r!=="none"&&(i.authorization=`Bearer ${this.#n.get()?.accessToken??""}`),r==="app+bearer"&&this.#r&&(i["x-openapps-app-key"]=this.#r);let a;try{a=await this.#i(o,{method:t.method??"GET",headers:i,body:t.body===void 0?void 0:JSON.stringify(t.body),signal:t.signal})}catch(c){throw c instanceof Error&&c.name==="AbortError"?c:new p("network",c instanceof Error?c.message:"network request failed")}if(a.status===401&&r!=="none"&&n&&await this.#d())return this.#a(e,t,r,!1);let l=await this.#c(a);if(!a.ok){let c=ae(a.status,l);throw c.code==="unauthorized"&&r!=="none"&&this.#t(null),c}return l}async#c(e){if(e.status===204)return null;let t=await e.text();if(!t)return null;try{return JSON.parse(t)}catch{throw new p(e.ok?"internal":"network",`expected JSON, got: ${t.slice(0,200)}`,e.status)}}#d(){if(this.#s)return this.#s;let e=this.#n.get();return e?(this.#s=(async()=>{try{let t=await this.#a("/v1/auth/refresh",{method:"POST",body:{refresh_token:e.refreshToken}},"none",!1),r={accessToken:t.access_token,refreshToken:t.refresh_token};return this.#t(r),r}catch{return this.#t(null),null}finally{this.#s=null}})(),this.#s):Promise.resolve(null)}auth={methods:async e=>(await this.#e("/v1/auth/methods",{signal:e})).methods,serverInfo:async e=>{let t=await this.#e("/v1/auth/methods",{signal:e});return{methods:t.methods,openwallet_install_url:it(t.openwallet_install_url)}},challenge:(e,t,r)=>this.#e("/v1/auth/challenge",{method:"POST",body:{namespace:e,address:t},signal:r}),verify:async(e,t,r={})=>{let n=await this.#e("/v1/auth/verify",{method:"POST",body:{challenge_id:e,proof:t,referral_code:r.referralCode},signal:r.signal});return this.#t({accessToken:n.access_token,refreshToken:n.refresh_token}),n},emailPow:e=>this.#e("/v1/auth/email/pow",{signal:e}),emailStart:(e,t,r={})=>this.#e("/v1/auth/email/start",{method:"POST",body:{email:e,pow:t,lang:r.lang},signal:r.signal}),emailVerify:async(e,t,r={})=>{let n=await this.#e("/v1/auth/email/verify",{method:"POST",body:{flow_id:e,code:t,referral_code:r.referralCode},signal:r.signal});return this.#t({accessToken:n.access_token,refreshToken:n.refresh_token}),n},redirectStartUrl:(e,t,r)=>{let n=new URLSearchParams;t&&n.set("return_to",t),r&&n.set("ref",r);let o=n.toString();return`${this.baseUrl}/v1/auth/oidc/${e}/start${o?`?${o}`:""}`},googleStartUrl:(e,t)=>this.auth.redirectStartUrl("google",e,t),redirectStart:async(e,t,r)=>{let n=this.auth.redirectStartUrl(e,t,r),o=await lt(t);if(!o)return n;let i=n.includes("?")?"&":"?";return`${n}${i}code_challenge=${o}&code_challenge_method=S256`},redirectAuthorizeUrl:async(e,t,r,n)=>{let o=await this.auth.redirectStart(e,t,r),i=`${o}${o.includes("?")?"&":"?"}mode=json`,a;try{a=await this.#i(i,{method:"GET",credentials:"include",headers:{accept:"application/json"},signal:n})}catch(d){throw d instanceof Error&&d.name==="AbortError"?d:new p("network",d instanceof Error?d.message:"network request failed")}let l=await this.#c(a);if(!a.ok)throw ae(a.status,l);let c=l?.authorize_url;if(typeof c!="string"||!c)throw new p("internal","the sign-in start returned no authorize_url");return c},completeRedirect:(e={})=>{let t=ot(e,"code");if(!t)return Promise.resolve(null);if(this.#o)return this.#o;let r=ct();return!r&&this.isLoggedIn?(ce(e,["code"]),Promise.resolve(null)):(this.#o=(async()=>{try{let n=await this.#e("/v1/auth/oidc/exchange",{method:"POST",body:r?{code:t,code_verifier:r}:{code:t},signal:e.signal});return this.#t({accessToken:n.access_token,refreshToken:n.refresh_token}),n}finally{this.#o=null,ce(e,["code"])}})(),this.#o)},me:e=>this.#e("/v1/me",{auth:"bearer",signal:e}),logout:async e=>{try{await this.#e("/v1/auth/logout",{method:"POST",auth:"bearer",signal:e})}finally{this.#t(null)}},deleteAccount:async e=>{await this.#e("/v1/me",{method:"DELETE",auth:"bearer",signal:e}),this.#t(null)},linkChallenge:(e,t,r)=>this.#e("/v1/auth/link/challenge",{method:"POST",auth:"bearer",body:{namespace:e,address:t},signal:r}),linkVerify:(e,t,r={})=>this.#e("/v1/auth/link/verify",{method:"POST",auth:"bearer",body:{challenge_id:e,proof:t,merge:r.merge??!1,...r.expect?{expect:r.expect}:{}},signal:r.signal}),redirectLinkStart:async(e,t,r={})=>(await this.auth.redirectLinkBegin(e,t,r)).auth_url,redirectLinkBegin:(e,t,r={})=>this.#e(`/v1/auth/link/oidc/${e}/start`,{method:"POST",auth:"bearer",body:{return_to:t},signal:r.signal}),redirectLink:async(e,t,r={})=>{let n=await this.auth.redirectLinkBegin(e,t,r);if(!at(n)){if(typeof window>"u")throw new Error("redirectLink needs a page to navigate; use redirectLinkBegin");window.location.href=n.auth_url}},confirmLink:(e,t={})=>this.#e("/v1/auth/link/oidc/confirm",{method:"POST",auth:"bearer",body:{code:e,merge:t.merge??!1},signal:t.signal}),sessions:e=>this.#e("/v1/sessions",{auth:"bearer",signal:e}),revokeSession:(e,t)=>this.#e(`/v1/sessions/${encodeURIComponent(e)}`,{method:"DELETE",auth:"bearer",signal:t}),revokeOtherSessions:e=>this.#e("/v1/sessions/revoke-others",{method:"POST",auth:"bearer",signal:e}),events:e=>this.#e("/v1/me/events",{auth:"bearer",signal:e}),googleLinkStart:(e,t={})=>this.auth.redirectLinkStart("google",e,t),completeLinkRedirect:(e={})=>{let t=Le(e),r=t.get("link_pending"),n=t.get("linked"),o=t.get("link_conflict"),i=t.get("link_blocked"),a=t.get("link_error");if(!r&&!n&&!o&&!i&&!a)return null;if(ce(e,["link_pending","provider","linked","link_conflict","link_blocked","link_error","clashes"],["merged","credits","balance"]),r)return{status:"pending",code:r,namespace:t.get("provider")??""};if(a)return{status:"error",message:a};if(i){let l=(t.get("clashes")??"").split(",").filter(Boolean),c=l.map(Re).join(" and ");return{status:"blocked",namespaces:l,message:`That ${Re(i)} account belongs to another account which also has a ${c} sign-in, and so does this one. Disconnect it from the other account first.`}}return o?{status:"conflict",namespace:o,balance:Number(t.get("balance")??0)}:{status:"linked",namespace:n,merged:t.get("merged")==="1",credits:Number(t.get("credits")??0)}},cancelMerge:(e,t)=>this.#e(`/v1/auth/merges/${encodeURIComponent(e)}/cancel`,{method:"POST",auth:"bearer",signal:t}),unlink:(e,t)=>this.#e(`/v1/auth/link/${encodeURIComponent(e)}`,{method:"DELETE",auth:"bearer",signal:t})};credits={balance:async e=>(await this.#e("/v1/credits/balance",{auth:"bearer",signal:e})).balance,breakdown:e=>this.#e("/v1/credits/balance",{auth:"bearer",signal:e}),deduct:(e,t,r,n)=>this.#e("/v1/credits/deduct",{method:"POST",auth:"app+bearer",body:{amount:e,reason:t,idempotency_key:r},signal:n}),history:(e={})=>this.#e("/v1/credits/history",{auth:"bearer",query:{cursor:e.cursor,limit:e.limit},signal:e.signal})};delegation=(e="GET",t)=>this.#e("/v1/me/delegation",{method:e,auth:"bearer",body:t});payments={packages:e=>this.#e("/v1/payments/packages",{signal:e}),stripeCheckout:(e,t={})=>this.#e("/v1/payments/stripe/checkout",{method:"POST",auth:"bearer",body:{package_id:e,return_to:t.returnTo===null?void 0:t.returnTo??st()},signal:t.signal}),ethDepositAddress:(e,t)=>this.#e("/v1/payments/eth/deposit-address",{method:"POST",auth:"bearer",body:{package_id:e},signal:t}),usdt0DepositAddress:(e,t,r)=>this.#e("/v1/payments/usdt0/deposit-address",{method:"POST",auth:"bearer",body:{package_id:e,network:t},signal:r}),lightningInvoice:(e,t)=>this.#e("/v1/payments/lightning/invoice",{method:"POST",auth:"bearer",body:{package_id:e},signal:t}),list:e=>this.#e("/v1/payments/topups",{auth:"bearer",signal:e}),get:(e,t)=>this.#e(`/v1/payments/topups/${encodeURIComponent(e)}`,{auth:"bearer",signal:t}),waitFor:async(e,t={})=>{let r=t.intervalMs??2e3,n=Date.now()+(t.timeoutMs??900*1e3);for(;;){t.signal?.throwIfAborted();try{let o=await this.payments.get(e,t.signal);if(t.onPoll?.(o),nt.has(o.status))return o}catch(o){if(o instanceof p&&o.code!=="network"||!(o instanceof p))throw o}if(Date.now()+r>n)throw new p("timeout",`top-up ${e} was still pending after the timeout`);await dt(r,t.signal)}}};referral={code:(e,t)=>this.#e("/v1/referral/code",{auth:"bearer",query:{app:e},signal:t}),apply:(e,t)=>this.#e("/v1/referral/apply",{method:"POST",auth:"bearer",body:{code:e},signal:t}),earnings:e=>this.#e("/v1/referral/earnings",{auth:"bearer",signal:e}),referees:e=>this.#e("/v1/referral/referees",{auth:"bearer",signal:e})}};function st(){if(!(typeof location>"u"))return`${location.origin}${location.pathname}${location.search}`}function ce(s,e,t=[]){if(s.url!==void 0||typeof history>"u"||typeof location>"u")return;let r=new URLSearchParams(location.search.replace(/^\?/,"")),n=new URLSearchParams(location.hash.replace(/^#/,""));for(let a of e)r.delete(a),n.delete(a);for(let a of t)n.delete(a);let o=r.toString(),i=n.toString();history.replaceState({},"",location.pathname+(o?`?${o}`:"")+(i?`#${i}`:""))}function Le(s){if(s.url!==void 0){let t=s.url,r=t.indexOf("#"),n=t.indexOf("?"),o=r>=0?t.slice(r+1):"",a=n>=0&&(r<0||n<r)?t.slice(n+1,r>=0?r:void 0):"",l=new URLSearchParams(o),c=new URLSearchParams(a);return{get:d=>l.get(d)??c.get(d)}}let e=s.hash??(typeof location>"u"?"":location.hash);return new URLSearchParams(e.replace(/^#/,""))}function ot(s,e){return Le(s).get(e)}function it(s){if(typeof s!="string")return null;try{let e=new URL(s);return e.protocol==="https:"&&!e.username&&!e.password?s:null}catch{return null}}function at(s){let e=s.go;if(!e||e.method!=="POST"||typeof document>"u")return!1;let t;try{t=new URL(e.url)}catch{return!1}if(t.protocol!=="https:"&&t.protocol!=="http:")return!1;let r=document.createElement("form");r.method="POST",r.action=t.href,r.hidden=!0;for(let[n,o]of Object.entries(e.fields??{})){let i=document.createElement("input");i.type="hidden",i.name=n,i.value=String(o),r.append(i)}return document.body.append(r),r.submit(),!0}var de="openapps.pkce_verifier";function Ne(){try{return typeof sessionStorage>"u"?null:sessionStorage}catch{return null}}function Ue(s){let e="";for(let t of s)e+=String.fromCharCode(t);return btoa(e).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}async function lt(s){let e=Ne(),t=globalThis.crypto?.subtle;if(!e||!t||typeof location>"u")return null;if(s)try{if(new URL(s).origin!==location.origin)return null}catch{return null}let r=new Uint8Array(32);globalThis.crypto.getRandomValues(r);let n=Ue(r),o=new Uint8Array(await t.digest("SHA-256",new TextEncoder().encode(n)));try{e.setItem(de,n)}catch{return null}return Ue(o)}function ct(){let s=Ne();if(!s)return null;try{let e=s.getItem(de);return s.removeItem(de),e}catch{return null}}function Re(s){return{google:"Google",github:"GitHub",apple:"Apple",openwallet:"OnWallet",eip155:"wallet",nostr:"Nostr"}[s]??s}function dt(s,e){return new Promise((t,r)=>{let n=setTimeout(()=>{e?.removeEventListener("abort",o),t()},s),o=()=>{clearTimeout(n),r(e?.reason??new Error("aborted"))};e?.addEventListener("abort",o,{once:!0})})}var he="openapps.referral";function ht(){try{let s=localStorage.getItem(he);if(!s)return null;let e=JSON.parse(s);return typeof e?.code!="string"||typeof e?.at!="number"?null:{code:e.code,at:e.at}}catch{return null}}function ut(){if(!(typeof location>"u"))try{return new URLSearchParams(location.search).get("ref")??void 0}catch{return}}function Me(){let s=ut();if(s)try{localStorage.setItem(he,JSON.stringify({code:s,at:Date.now()}))}catch{}}function Ar(){let s=ht();if(s){if(Date.now()-s.at>2592e6){pt();return}return s.code}}function pt(){try{localStorage.removeItem(he)}catch{}}var V=null;function ft(s){return V=new q(s),Me(),gt(),V}function Ie(s,e){if(s)return s;if(V)return V;if(e)return ft({baseUrl:e});throw new Error("no OpenApps client: call configure({ baseUrl }) or set base-url on the element")}var ue=new Set;function qe(s){return ue.add(s),()=>ue.delete(s)}function gt(){for(let s of ue)s()}var pe=new Map,k="en",mt=new Set;function bt(){return k==="en"&&!pe.has("en")?void 0:k}var He=new Map;function yt(s,e){let t=bt(),r=`${t??""}|${JSON.stringify(e??{})}`,n=He.get(r);if(!n){try{n=new Intl.NumberFormat(t,e)}catch{n=new Intl.NumberFormat(void 0,e)}He.set(r,n)}return n.format(s)}function x(s,e){let t=s,r=!1;if(k!=="en"||pe.has("en")){let n=pe.get(k)?.[s];n!==void 0?(t=n,r=n.includes("|")):k!=="en"&&mt.add(s)}return r&&(t=wt(t,e)),e?t.replace(/\{(\w+)\}/g,(n,o)=>o in e?vt(e[o]):n):t}function vt(s){return typeof s=="number"?yt(s):String(s)}var _t=["one","two","few","many","other"];function $t(s){for(let e of Object.values(s??{})){if(typeof e=="number")return e;if(typeof e=="string"&&/^\d[\d\s\u00a0\u202f.,']*$/.test(e))return Number(e.replace(/\D/g,""))}}function wt(s,e){let t=s.split("|"),r=typeof e?.n=="number"?e.n:$t(e);if(typeof r!="number")return t[t.length-1];let n="other",o=["other"];try{let a=new Intl.PluralRules(k);n=a.select(r);let l=a.resolvedOptions().pluralCategories;o=_t.filter(c=>l.includes(c))}catch{}let i=o.indexOf(n);return t[Math.min(i<0?t.length-1:i,t.length-1)]}var E=class extends y{constructor(){super(...arguments);this.error=null;this.busy=!1}#r;connectedCallback(){super.connectedCallback(),this.#r=qe(()=>{this.onSessionChange(),this.requestUpdate()})}disconnectedCallback(){this.#r?.(),super.disconnectedCallback()}onSessionChange(){this.requestUpdate()}get sdk(){return Ie(this.client,this.baseUrl)}get sdkOrNull(){try{return this.sdk}catch{return null}}async run(t){this.error=null,this.busy=!0;try{return await t()}catch(r){if(r instanceof Error&&r.name==="AbortError")return;this.error=xt(r);return}finally{this.busy=!1}}emit(t,r){this.dispatchEvent(new CustomEvent(t,{detail:r,bubbles:!0,composed:!0}))}static{this.baseStyles=J`
    :host {
      /* Fallback palette: the design system's light values, inlined. */
      --fb-card: #ffffff;
      --fb-subtle: #f8f8f7;
      --fb-hairline: #deded9;
      --fb-strong: #020202;
      --fb-body: #3d3d3d;
      --fb-muted: #656565;
      --fb-faint: #7c7c7c;
      --fb-brand: #00c896;
      --fb-selected: #e6f9f3;
      --fb-danger: #b3261e;

      display: block;
      font: var(--type-body, 400 15px/1.45 "Geist", system-ui, sans-serif);
      letter-spacing: var(--tracking-body, -0.005em);
      color: var(--text-body, var(--fb-body));
    }

    /* Only the *fallbacks* follow the OS. Once tokens are linked, dark mode
       is the host's decision via the oa-auto / oa-dark classes, and a
       component running its own media query would sit stubbornly light
       inside a host that had deliberately forced dark. */
    @media (prefers-color-scheme: dark) {
      :host {
        --fb-card: #1a1a1a;
        --fb-subtle: #1a1a1a;
        --fb-hairline: rgba(255, 255, 255, 0.1);
        --fb-strong: #ffffff;
        --fb-body: rgba(255, 255, 255, 0.7);
        --fb-muted: rgba(255, 255, 255, 0.6);
        --fb-faint: rgba(255, 255, 255, 0.4);
        --fb-selected: #10312a;
        --fb-danger: #ff4d4d;
      }
    }

    /* ---- The SDK frame ----
       One card, capped at --sdk-max. It never assumes a page, so it drops
       into a modal, a settings pane, a phone screen or a route unchanged. */
    .panel {
      width: 100%;
      max-width: var(--sdk-max, 420px);
      background: var(--surface-card, var(--fb-card));
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
      overflow: hidden;
      box-sizing: border-box;
    }

    .panel.wide {
      max-width: var(--sdk-wide, 560px);
    }

    .head {
      display: grid;
      gap: 8px;
      padding: 24px 24px 0;
    }

    .title {
      margin: 0;
      font: var(--weight-medium, 500) var(--text-xl, 24px) / 1.2
        var(--font-display, "Geist", system-ui, sans-serif);
      letter-spacing: var(--tracking-heading, -0.02em);
      color: var(--text-strong, var(--fb-strong));
    }

    .desc {
      margin: 0;
      font: var(--type-body, 400 15px/1.45 "Geist", system-ui, sans-serif);
      color: var(--text-muted, var(--fb-muted));
    }

    .body {
      display: grid;
      gap: 14px;
      padding: 24px;
    }

    /* A labelled rule, for "or" between a provider row and the rest. */
    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .divider::before,
    .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--border-hairline, var(--fb-hairline));
    }

    .caption {
      margin: 0;
      font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      color: var(--text-faint, var(--fb-faint));
    }

    .eyebrow {
      font: var(--type-eyebrow, 500 12px/1.2 "Geist", system-ui, sans-serif);
      letter-spacing: var(--tracking-caps, 0.08em);
      text-transform: uppercase;
      color: var(--text-faint, var(--fb-faint));
    }

    /* The O monogram on a squircle. No logo was ever supplied, so the mark
       is typographic by design: legible at 16px, works in one colour, and
       re-skins from the --logo-* tokens without redrawing anything. */
    .mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: var(--logo-tile-radius, 0.22em);
      background: var(--logo-tile-bg, var(--fb-strong));
      color: var(--logo-tile-fg, var(--fb-brand));
      font: var(--weight-medium, 500) 18px / 1
        var(--font-display, "Geist", system-ui, sans-serif);
      letter-spacing: var(--logo-tracking, -0.04em);
      user-select: none;
    }

    /* A value the user is meant to copy: an address, an invoice, a link.
       Shared because three elements render one and a fourth will. */
    .payload {
      display: block;
      overflow-wrap: anywhere;
      padding: 0.6em;
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      border-radius: var(--radius-lg, 12px);
      background: var(--bg-subtle, var(--fb-subtle));
      font: var(--type-mono, 400 13px/1.5 ui-monospace, monospace);
      color: var(--text-body, var(--fb-body));
    }

    /* ---- Badge ----
       A read-only status pill. Never given a click handler: a badge that
       does something is a control wearing a status's clothes. */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 22px;
      padding: 0 8px;
      border-radius: var(--radius-full, 999px);
      font: var(--weight-medium, 500) var(--text-xs, 12px) / 1
        var(--font-sans, "Geist", system-ui, sans-serif);
      white-space: nowrap;
      background: var(--bg-sunken, #f2f2f2);
      color: var(--text-muted, var(--fb-muted));
    }

    .badge.success {
      background: var(--success-bg, #e6f9f3);
      color: var(--success-fg, #0b8a68);
    }

    .badge.danger {
      background: var(--danger-bg, #fdecea);
      color: var(--danger-fg, var(--fb-danger));
    }

    .badge.brand {
      background: var(--brand-soft, #e6f9f3);
      color: var(--text-brand, var(--fb-brand));
    }

    /* Inherits the pill's colour, so a tone change carries the dot with it. */
    .badge .dot {
      width: 5px;
      height: 5px;
      border-radius: var(--radius-full, 999px);
      background: currentColor;
    }

    /* ---- Field ----
       Label, control, hint. Focus is a near-black border plus the offset
       ring — never a coloured glow, and never a removed outline. */
    .field {
      display: grid;
      gap: 6px;
    }

    .field label {
      font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      color: var(--text-strong, var(--fb-strong));
    }

    .field input {
      width: 100%;
      box-sizing: border-box;
      min-height: var(--control-h-md, 36px);
      padding: 0 12px;
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      border-radius: var(--radius-md, 8px);
      background: var(--surface-card, var(--fb-card));
      color: var(--text-strong, var(--fb-strong));
      font: var(--type-body, 400 15px/1.45 "Geist", system-ui, sans-serif);
      letter-spacing: inherit;
    }

    .field input::placeholder {
      color: var(--text-faint, var(--fb-faint));
    }

    .field input:focus-visible {
      border-color: var(--text-strong, var(--fb-strong));
      box-shadow: var(--focus-ring, 0 0 0 2px #f2f2f2, 0 0 0 4px #020202);
    }

    .field .hint {
      font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      color: var(--text-faint, var(--fb-faint));
    }

    /* Anything numeric — balances, prices, per-unit rates, ledger amounts. */
    .mono {
      font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
    }

    /* ---- Controls ----
       Height comes from the platform tokens, which re-point themselves under
       a pointer:coarse media query, so touch targets clear 44px with no
       mobile-specific variant here. */
    button {
      font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      letter-spacing: inherit;
      cursor: pointer;
      min-height: var(--control-h-md, 36px);
      padding: 0 14px;
      border-radius: var(--radius-md, 8px);
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      background: var(--surface-card, var(--fb-card));
      color: var(--text-strong, var(--fb-strong));
      transition: var(--transition-control, all 120ms cubic-bezier(0.2, 0, 0, 1));
    }

    button:hover:not([disabled]) {
      background: var(--surface-hover, rgba(0, 0, 0, 0.04));
    }

    /* The whole press feedback is half a pixel. Nothing scales. */
    button:active:not([disabled]) {
      transform: translateY(0.5px);
    }

    button.primary {
      background: var(--brand, var(--fb-brand));
      border-color: var(--brand, var(--fb-brand));
      color: var(--brand-contrast, #020202);
    }

    button.primary:hover:not([disabled]) {
      background: var(--brand-soft, #1ad3a5);
    }

    button.ghost {
      background: transparent;
      border-color: transparent;
    }

    button.block {
      width: 100%;
      justify-content: center;
    }

    button[disabled] {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* A ring, never a glow, and never removed. */
    :focus-visible {
      outline: none;
      box-shadow: var(--focus-ring, 0 0 0 2px #f2f2f2, 0 0 0 4px #020202);
    }

    a {
      color: var(--text-link, var(--fb-strong));
      text-decoration: none;
      text-underline-offset: 3px;
    }

    a:hover {
      text-decoration: underline;
    }

    .error {
      color: var(--danger-fg, var(--fb-danger));
      font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      margin-top: 0.5em;
    }

    .muted {
      color: var(--text-muted, var(--fb-muted));
    }
  `}};P([I({type:String,attribute:"base-url"})],E.prototype,"baseUrl",2),P([I({attribute:!1})],E.prototype,"client",2),P([ie()],E.prototype,"error",2),P([ie()],E.prototype,"busy",2);function xt(s){if(s instanceof p)switch(s.code){case"unauthorized":return x("Please sign in again.");case"insufficient_balance":return s.balance===void 0?x("Not enough credits."):x("Not enough credits \u2014 you have {balance}.",{balance:s.balance});case"rate_limited":return x("Too many attempts. Please wait a moment and try again.");case"network":return x("Could not reach the server. Check your connection.");case"timeout":return x("This is taking longer than expected. It may still complete.");default:return s.message}return s instanceof Error?s.message:String(s)}export{J as a,me as b,Pt as c,Ct as d,u as e,Bt as f,I as g,ie as h,p as i,ut as j,Ar as k,pt as l,gt as m,bt as n,yt as o,x as p,E as q,xt as r};
//# sourceMappingURL=chunk-HLRRPXU7.js.map
