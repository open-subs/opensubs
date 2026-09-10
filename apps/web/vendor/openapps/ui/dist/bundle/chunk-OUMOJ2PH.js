import{a as k}from"./chunk-LCQWCHVU.js";var H=globalThis,I=H.ShadowRoot&&(H.ShadyCSS===void 0||H.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,F=Symbol(),le=new WeakMap,E=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==F)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(I&&e===void 0){let r=t!==void 0&&t.length===1;r&&(e=le.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),r&&le.set(t,e))}return e}toString(){return this.cssText}},ce=s=>new E(typeof s=="string"?s:s+"",void 0,F),V=(s,...e)=>{let t=s.length===1?s[0]:e.reduce((r,n,o)=>r+(i=>{if(i._$cssResult$===!0)return i.cssText;if(typeof i=="number")return i;throw Error("Value passed to 'css' function must be a 'css' function result: "+i+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+s[o+1],s[0]);return new E(t,s,F)},de=(s,e)=>{if(I)s.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let r=document.createElement("style"),n=H.litNonce;n!==void 0&&r.setAttribute("nonce",n),r.textContent=t.cssText,s.appendChild(r)}},J=I?s=>s:s=>s instanceof CSSStyleSheet?(e=>{let t="";for(let r of e.cssRules)t+=r.cssText;return ce(t)})(s):s;var{is:Te,defineProperty:Ue,getOwnPropertyDescriptor:Re,getOwnPropertyNames:Ne,getOwnPropertySymbols:Me,getPrototypeOf:Le}=Object,j=globalThis,he=j.trustedTypes,qe=he?he.emptyScript:"",He=j.reactiveElementPolyfillSupport,C=(s,e)=>s,P={toAttribute(s,e){switch(e){case Boolean:s=s?qe:null;break;case Object:case Array:s=s==null?s:JSON.stringify(s)}return s},fromAttribute(s,e){let t=s;switch(e){case Boolean:t=s!==null;break;case Number:t=s===null?null:Number(s);break;case Object:case Array:try{t=JSON.parse(s)}catch{t=null}}return t}},D=(s,e)=>!Te(s,e),ue={attribute:!0,type:String,converter:P,reflect:!1,useDefault:!1,hasChanged:D};Symbol.metadata??=Symbol("metadata"),j.litPropertyMetadata??=new WeakMap;var g=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ue){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let r=Symbol(),n=this.getPropertyDescriptor(e,r,t);n!==void 0&&Ue(this.prototype,e,n)}}static getPropertyDescriptor(e,t,r){let{get:n,set:o}=Re(this.prototype,e)??{get(){return this[t]},set(i){this[t]=i}};return{get:n,set(i){let l=n?.call(this);o?.call(this,i),this.requestUpdate(e,l,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ue}static _$Ei(){if(this.hasOwnProperty(C("elementProperties")))return;let e=Le(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(C("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(C("properties"))){let t=this.properties,r=[...Ne(t),...Me(t)];for(let n of r)this.createProperty(n,t[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[r,n]of t)this.elementProperties.set(r,n)}this._$Eh=new Map;for(let[t,r]of this.elementProperties){let n=this._$Eu(t,r);n!==void 0&&this._$Eh.set(n,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let r=new Set(e.flat(1/0).reverse());for(let n of r)t.unshift(J(n))}else e!==void 0&&t.push(J(e));return t}static _$Eu(e,t){let r=t.attribute;return r===!1?void 0:typeof r=="string"?r:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let r of t.keys())this.hasOwnProperty(r)&&(e.set(r,this[r]),delete this[r]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return de(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,r){this._$AK(e,r)}_$ET(e,t){let r=this.constructor.elementProperties.get(e),n=this.constructor._$Eu(e,r);if(n!==void 0&&r.reflect===!0){let o=(r.converter?.toAttribute!==void 0?r.converter:P).toAttribute(t,r.type);this._$Em=e,o==null?this.removeAttribute(n):this.setAttribute(n,o),this._$Em=null}}_$AK(e,t){let r=this.constructor,n=r._$Eh.get(e);if(n!==void 0&&this._$Em!==n){let o=r.getPropertyOptions(n),i=typeof o.converter=="function"?{fromAttribute:o.converter}:o.converter?.fromAttribute!==void 0?o.converter:P;this._$Em=n;let l=i.fromAttribute(t,o.type);this[n]=l??this._$Ej?.get(n)??l,this._$Em=null}}requestUpdate(e,t,r,n=!1,o){if(e!==void 0){let i=this.constructor;if(n===!1&&(o=this[e]),r??=i.getPropertyOptions(e),!((r.hasChanged??D)(o,t)||r.useDefault&&r.reflect&&o===this._$Ej?.get(e)&&!this.hasAttribute(i._$Eu(e,r))))return;this.C(e,t,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:r,reflect:n,wrapped:o},i){r&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,i??t??this[e]),o!==!0||i!==void 0)||(this._$AL.has(e)||(this.hasUpdated||r||(t=void 0),this._$AL.set(e,t)),n===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,o]of this._$Ep)this[n]=o;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[n,o]of r){let{wrapped:i}=o,l=this[n];i!==!0||this._$AL.has(n)||l===void 0||this.C(n,void 0,o,l)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(t)):this._$EM()}catch(r){throw e=!1,this._$EM(),r}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};g.elementStyles=[],g.shadowRootOptions={mode:"open"},g[C("elementProperties")]=new Map,g[C("finalized")]=new Map,He?.({ReactiveElement:g}),(j.reactiveElementVersions??=[]).push("2.1.2");var ee=globalThis,pe=s=>s,z=ee.trustedTypes,fe=z?z.createPolicy("lit-html",{createHTML:s=>s}):void 0,$e="$lit$",b=`lit$${Math.random().toFixed(9).slice(2)}$`,_e="?"+b,Ie=`<${_e}>`,_=document,T=()=>_.createComment(""),U=s=>s===null||typeof s!="object"&&typeof s!="function",te=Array.isArray,je=s=>te(s)||typeof s?.[Symbol.iterator]=="function",K=`[ 	
\f\r]`,O=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,ge=/-->/g,me=/>/g,v=RegExp(`>|${K}(?:([^\\s"'>=/]+)(${K}*=${K}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),be=/'/g,ye=/"/g,xe=/^(?:script|style|textarea|title)$/i,re=s=>(e,...t)=>({_$litType$:s,strings:e,values:t}),lt=re(1),ct=re(2),dt=re(3),x=Symbol.for("lit-noChange"),u=Symbol.for("lit-nothing"),ve=new WeakMap,$=_.createTreeWalker(_,129);function we(s,e){if(!te(s)||!s.hasOwnProperty("raw"))throw Error("invalid template strings array");return fe!==void 0?fe.createHTML(e):e}var De=(s,e)=>{let t=s.length-1,r=[],n,o=e===2?"<svg>":e===3?"<math>":"",i=O;for(let l=0;l<t;l++){let a=s[l],c,h,d=-1,f=0;for(;f<a.length&&(i.lastIndex=f,h=i.exec(a),h!==null);)f=i.lastIndex,i===O?h[1]==="!--"?i=ge:h[1]!==void 0?i=me:h[2]!==void 0?(xe.test(h[2])&&(n=RegExp("</"+h[2],"g")),i=v):h[3]!==void 0&&(i=v):i===v?h[0]===">"?(i=n??O,d=-1):h[1]===void 0?d=-2:(d=i.lastIndex-h[2].length,c=h[1],i=h[3]===void 0?v:h[3]==='"'?ye:be):i===ye||i===be?i=v:i===ge||i===me?i=O:(i=v,n=void 0);let m=i===v&&s[l+1].startsWith("/>")?" ":"";o+=i===O?a+Ie:d>=0?(r.push(c),a.slice(0,d)+$e+a.slice(d)+b+m):a+b+(d===-2?l:m)}return[we(s,o+(s[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),r]},R=class s{constructor({strings:e,_$litType$:t},r){let n;this.parts=[];let o=0,i=0,l=e.length-1,a=this.parts,[c,h]=De(e,t);if(this.el=s.createElement(c,r),$.currentNode=this.el.content,t===2||t===3){let d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(n=$.nextNode())!==null&&a.length<l;){if(n.nodeType===1){if(n.hasAttributes())for(let d of n.getAttributeNames())if(d.endsWith($e)){let f=h[i++],m=n.getAttribute(d).split(b),q=/([.?@])?(.*)/.exec(f);a.push({type:1,index:o,name:q[2],strings:m,ctor:q[1]==="."?Q:q[1]==="?"?Y:q[1]==="@"?Z:A}),n.removeAttribute(d)}else d.startsWith(b)&&(a.push({type:6,index:o}),n.removeAttribute(d));if(xe.test(n.tagName)){let d=n.textContent.split(b),f=d.length-1;if(f>0){n.textContent=z?z.emptyScript:"";for(let m=0;m<f;m++)n.append(d[m],T()),$.nextNode(),a.push({type:2,index:++o});n.append(d[f],T())}}}else if(n.nodeType===8)if(n.data===_e)a.push({type:2,index:o});else{let d=-1;for(;(d=n.data.indexOf(b,d+1))!==-1;)a.push({type:7,index:o}),d+=b.length-1}o++}}static createElement(e,t){let r=_.createElement("template");return r.innerHTML=e,r}};function w(s,e,t=s,r){if(e===x)return e;let n=r!==void 0?t._$Co?.[r]:t._$Cl,o=U(e)?void 0:e._$litDirective$;return n?.constructor!==o&&(n?._$AO?.(!1),o===void 0?n=void 0:(n=new o(s),n._$AT(s,t,r)),r!==void 0?(t._$Co??=[])[r]=n:t._$Cl=n),n!==void 0&&(e=w(s,n._$AS(s,e.values),n,r)),e}var W=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:r}=this._$AD,n=(e?.creationScope??_).importNode(t,!0);$.currentNode=n;let o=$.nextNode(),i=0,l=0,a=r[0];for(;a!==void 0;){if(i===a.index){let c;a.type===2?c=new N(o,o.nextSibling,this,e):a.type===1?c=new a.ctor(o,a.name,a.strings,this,e):a.type===6&&(c=new X(o,this,e)),this._$AV.push(c),a=r[++l]}i!==a?.index&&(o=$.nextNode(),i++)}return $.currentNode=_,n}p(e){let t=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(e,r,t),t+=r.strings.length-2):r._$AI(e[t])),t++}},N=class s{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,r,n){this.type=2,this._$AH=u,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=r,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=w(this,e,t),U(e)?e===u||e==null||e===""?(this._$AH!==u&&this._$AR(),this._$AH=u):e!==this._$AH&&e!==x&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):je(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==u&&U(this._$AH)?this._$AA.nextSibling.data=e:this.T(_.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:r}=e,n=typeof r=="number"?this._$AC(e):(r.el===void 0&&(r.el=R.createElement(we(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===n)this._$AH.p(t);else{let o=new W(n,this),i=o.u(this.options);o.p(t),this.T(i),this._$AH=o}}_$AC(e){let t=ve.get(e.strings);return t===void 0&&ve.set(e.strings,t=new R(e)),t}k(e){te(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,r,n=0;for(let o of e)n===t.length?t.push(r=new s(this.O(T()),this.O(T()),this,this.options)):r=t[n],r._$AI(o),n++;n<t.length&&(this._$AR(r&&r._$AB.nextSibling,n),t.length=n)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let r=pe(e).nextSibling;pe(e).remove(),e=r}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},A=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,r,n,o){this.type=1,this._$AH=u,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=o,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=u}_$AI(e,t=this,r,n){let o=this.strings,i=!1;if(o===void 0)e=w(this,e,t,0),i=!U(e)||e!==this._$AH&&e!==x,i&&(this._$AH=e);else{let l=e,a,c;for(e=o[0],a=0;a<o.length-1;a++)c=w(this,l[r+a],t,a),c===x&&(c=this._$AH[a]),i||=!U(c)||c!==this._$AH[a],c===u?e=u:e!==u&&(e+=(c??"")+o[a+1]),this._$AH[a]=c}i&&!n&&this.j(e)}j(e){e===u?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},Q=class extends A{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===u?void 0:e}},Y=class extends A{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==u)}},Z=class extends A{constructor(e,t,r,n,o){super(e,t,r,n,o),this.type=5}_$AI(e,t=this){if((e=w(this,e,t,0)??u)===x)return;let r=this._$AH,n=e===u&&r!==u||e.capture!==r.capture||e.once!==r.once||e.passive!==r.passive,o=e!==u&&(r===u||n);n&&this.element.removeEventListener(this.name,this,r),o&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},X=class{constructor(e,t,r){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(e){w(this,e)}};var ze=ee.litHtmlPolyfillSupport;ze?.(R,N),(ee.litHtmlVersions??=[]).push("3.3.3");var Ae=(s,e,t)=>{let r=t?.renderBefore??e,n=r._$litPart$;if(n===void 0){let o=t?.renderBefore??null;r._$litPart$=n=new N(e.insertBefore(T(),o),o,void 0,t??{})}return n._$AI(s),n};var se=globalThis,y=class extends g{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Ae(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return x}};y._$litElement$=!0,y.finalized=!0,se.litElementHydrateSupport?.({LitElement:y});var Be=se.litElementPolyfillSupport;Be?.({LitElement:y});(se.litElementVersions??=[]).push("4.2.2");var wt=s=>(e,t)=>{t!==void 0?t.addInitializer(()=>{customElements.define(s,e)}):customElements.define(s,e)};var Ge={attribute:!0,type:String,converter:P,reflect:!1,hasChanged:D},Fe=(s=Ge,e,t)=>{let{kind:r,metadata:n}=t,o=globalThis.litPropertyMetadata.get(n);if(o===void 0&&globalThis.litPropertyMetadata.set(n,o=new Map),r==="setter"&&((s=Object.create(s)).wrapped=!0),o.set(t.name,s),r==="accessor"){let{name:i}=t;return{set(l){let a=e.get.call(this);e.set.call(this,l),this.requestUpdate(i,a,s,!0,l)},init(l){return l!==void 0&&this.C(i,void 0,s,l),l}}}if(r==="setter"){let{name:i}=t;return function(l){let a=this[i];e.call(this,l),this.requestUpdate(i,a,s,!0,l)}}throw Error("Unsupported decorator location: "+r)};function M(s){return(e,t)=>typeof t=="object"?Fe(s,e,t):((r,n,o)=>{let i=n.hasOwnProperty(o);return n.constructor.createProperty(o,r),i?Object.getOwnPropertyDescriptor(n,o):void 0})(s,e,t)}function ne(s){return M({...s,state:!0,attribute:!1})}var p=class extends Error{code;status;balance;detail;constructor(e,t,r=0,n,o){super(t),this.name="OpenAppsError",this.code=e,this.status=r,this.balance=n,this.detail=o}get isAuthError(){return this.code==="unauthorized"}},Ve={400:"bad_request",401:"unauthorized",402:"insufficient_balance",404:"not_found",409:"conflict",429:"rate_limited"};function Se(s,e){let t=e&&typeof e=="object"?e.error:void 0,r=t&&typeof t=="object"?t:void 0,n=r?.code??Ve[s]??"internal",o=r?.message??`request failed with status ${s}`,i;if(n==="insufficient_balance"){let l=/-?\d+/.exec(o);l&&(i=Number(l[0]))}return new p(n,o,s,i,r)}function oe(s=null){let e=s;return{get:()=>e,set:t=>{e=t}}}function Je(s="openapps.session"){let e=null;try{e=typeof localStorage<"u"?localStorage:null,e?.setItem(s,e.getItem(s)??""),e?.getItem(s)===""&&e.removeItem(s)}catch{e=null}if(!e)return oe();let t=e;return{get(){let r=t.getItem(s);if(!r)return null;try{let n=JSON.parse(r);return n.accessToken&&n.refreshToken?n:null}catch{return null}},set(r){r?t.setItem(s,JSON.stringify(r)):t.removeItem(s)}}}function ke(){try{return typeof localStorage<"u"?Je():oe()}catch{return oe()}}var Ke=new Set(["confirmed","failed","expired"]),L=class{baseUrl;#r;#s;#a;#l;#n=null;#o=null;constructor(e){this.baseUrl=e.baseUrl.replace(/\/+$/,""),this.#r=e.appKey,this.#s=e.store??ke();let t=e.fetch??globalThis.fetch;if(!t)throw new p("network","no fetch implementation available; pass one via options.fetch");this.#a=(r,n)=>t(r,n),this.#l=e.onAuthChange}get session(){return this.#s.get()}get isLoggedIn(){return this.#s.get()!==null}#t(e){this.#s.set(e),this.#l?.(e)}adoptSession(e,t){this.#t({accessToken:e,refreshToken:t})}clearSession(){this.#t(null)}async#e(e,t={}){let r=t.auth??"none";if(r!=="none"&&!this.#s.get())throw new p("unauthorized","not logged in");if(r==="app+bearer"&&!this.#r)throw new p("unauthorized","this call needs an app key; construct OpenApps with { appKey }");return this.#i(e,t,r,!0)}async#i(e,t,r,n){let o=`${this.baseUrl}${e}`;if(t.query){let c=new URLSearchParams;for(let[d,f]of Object.entries(t.query))f!==void 0&&c.set(d,String(f));let h=c.toString();h&&(o+=`?${h}`)}let i={accept:"application/json"};t.body!==void 0&&(i["content-type"]="application/json"),r!=="none"&&(i.authorization=`Bearer ${this.#s.get()?.accessToken??""}`),r==="app+bearer"&&this.#r&&(i["x-openapps-app-key"]=this.#r);let l;try{l=await this.#a(o,{method:t.method??"GET",headers:i,body:t.body===void 0?void 0:JSON.stringify(t.body),signal:t.signal})}catch(c){throw c instanceof Error&&c.name==="AbortError"?c:new p("network",c instanceof Error?c.message:"network request failed")}if(l.status===401&&r!=="none"&&n&&await this.#d())return this.#i(e,t,r,!1);let a=await this.#c(l);if(!l.ok){let c=Se(l.status,a);throw c.code==="unauthorized"&&r!=="none"&&this.#t(null),c}return a}async#c(e){if(e.status===204)return null;let t=await e.text();if(!t)return null;try{return JSON.parse(t)}catch{throw new p(e.ok?"internal":"network",`expected JSON, got: ${t.slice(0,200)}`,e.status)}}#d(){if(this.#n)return this.#n;let e=this.#s.get();return e?(this.#n=(async()=>{try{let t=await this.#i("/v1/auth/refresh",{method:"POST",body:{refresh_token:e.refreshToken}},"none",!1),r={accessToken:t.access_token,refreshToken:t.refresh_token};return this.#t(r),r}catch{return this.#t(null),null}finally{this.#n=null}})(),this.#n):Promise.resolve(null)}auth={methods:async e=>(await this.#e("/v1/auth/methods",{signal:e})).methods,challenge:(e,t,r)=>this.#e("/v1/auth/challenge",{method:"POST",body:{namespace:e,address:t},signal:r}),verify:async(e,t,r={})=>{let n=await this.#e("/v1/auth/verify",{method:"POST",body:{challenge_id:e,proof:t,referral_code:r.referralCode},signal:r.signal});return this.#t({accessToken:n.access_token,refreshToken:n.refresh_token}),n},googleStartUrl:(e,t)=>{let r=new URLSearchParams;e&&r.set("return_to",e),t&&r.set("ref",t);let n=r.toString();return`${this.baseUrl}/v1/auth/oidc/google/start${n?`?${n}`:""}`},completeRedirect:(e={})=>{let t=Qe(e,"code");return t?this.#o?this.#o:(this.#o=(async()=>{try{let r=await this.#e("/v1/auth/oidc/exchange",{method:"POST",body:{code:t},signal:e.signal});return this.#t({accessToken:r.access_token,refreshToken:r.refresh_token}),e.hash===void 0&&e.url===void 0&&typeof history<"u"&&typeof location<"u"&&history.replaceState({},"",location.pathname+location.search),r}finally{this.#o=null}})(),this.#o):Promise.resolve(null)},me:e=>this.#e("/v1/me",{auth:"bearer",signal:e}),logout:async e=>{try{await this.#e("/v1/auth/logout",{method:"POST",auth:"bearer",signal:e})}finally{this.#t(null)}},linkChallenge:(e,t,r)=>this.#e("/v1/auth/link/challenge",{method:"POST",auth:"bearer",body:{namespace:e,address:t},signal:r}),linkVerify:(e,t,r={})=>this.#e("/v1/auth/link/verify",{method:"POST",auth:"bearer",body:{challenge_id:e,proof:t,merge:r.merge??!1},signal:r.signal}),googleLinkStart:async(e,t={})=>(await this.#e("/v1/auth/link/oidc/google/start",{method:"POST",auth:"bearer",body:{return_to:e,merge:t.merge??!1},signal:t.signal})).auth_url,completeLinkRedirect:(e={})=>{let t=Ee(e),r=t.get("linked"),n=t.get("link_conflict"),o=t.get("link_blocked"),i=t.get("link_error");if(!r&&!n&&!o&&!i)return null;if(e.hash===void 0&&e.url===void 0&&typeof history<"u"&&history.replaceState({},"",location.pathname+location.search),i)return{status:"error",message:i};if(o){let l=(t.get("clashes")??"").split(",").filter(Boolean),a=l.map(c=>({google:"Google",eip155:"wallet",nostr:"Nostr"})[c]??c).join(" and ");return{status:"blocked",namespaces:l,message:`That Google account belongs to another account which also has a ${a} sign-in, and so does this one. Disconnect it from the other account first.`}}return n?{status:"conflict",namespace:n,balance:Number(t.get("balance")??0)}:{status:"linked",namespace:r,merged:t.get("merged")==="1",credits:Number(t.get("credits")??0)}},unlink:(e,t)=>this.#e(`/v1/auth/link/${encodeURIComponent(e)}`,{method:"DELETE",auth:"bearer",signal:t})};credits={balance:async e=>(await this.#e("/v1/credits/balance",{auth:"bearer",signal:e})).balance,deduct:(e,t,r,n)=>this.#e("/v1/credits/deduct",{method:"POST",auth:"app+bearer",body:{amount:e,reason:t,idempotency_key:r},signal:n}),history:(e={})=>this.#e("/v1/credits/history",{auth:"bearer",query:{cursor:e.cursor,limit:e.limit},signal:e.signal})};payments={packages:e=>this.#e("/v1/payments/packages",{signal:e}),stripeCheckout:(e,t={})=>this.#e("/v1/payments/stripe/checkout",{method:"POST",auth:"bearer",body:{package_id:e,return_to:t.returnTo===null?void 0:t.returnTo??We()},signal:t.signal}),ethDepositAddress:(e,t)=>this.#e("/v1/payments/eth/deposit-address",{method:"POST",auth:"bearer",body:{package_id:e},signal:t}),lightningInvoice:(e,t)=>this.#e("/v1/payments/lightning/invoice",{method:"POST",auth:"bearer",body:{package_id:e},signal:t}),list:e=>this.#e("/v1/payments/topups",{auth:"bearer",signal:e}),get:(e,t)=>this.#e(`/v1/payments/topups/${encodeURIComponent(e)}`,{auth:"bearer",signal:t}),waitFor:async(e,t={})=>{let r=t.intervalMs??2e3,n=Date.now()+(t.timeoutMs??900*1e3);for(;;){t.signal?.throwIfAborted();try{let o=await this.payments.get(e,t.signal);if(t.onPoll?.(o),Ke.has(o.status))return o}catch(o){if(o instanceof p&&o.code!=="network"||!(o instanceof p))throw o}if(Date.now()+r>n)throw new p("timeout",`top-up ${e} was still pending after the timeout`);await Ye(r,t.signal)}}};referral={code:(e,t)=>this.#e("/v1/referral/code",{auth:"bearer",query:{app:e},signal:t}),apply:(e,t)=>this.#e("/v1/referral/apply",{method:"POST",auth:"bearer",body:{code:e},signal:t}),earnings:e=>this.#e("/v1/referral/earnings",{auth:"bearer",signal:e}),referees:e=>this.#e("/v1/referral/referees",{auth:"bearer",signal:e})}};function We(){if(!(typeof location>"u"))return`${location.origin}${location.pathname}${location.search}`}function Ee(s){if(s.url!==void 0){let t=s.url,r=t.indexOf("#"),n=t.indexOf("?"),o=r>=0?t.slice(r+1):"",l=n>=0&&(r<0||n<r)?t.slice(n+1,r>=0?r:void 0):"",a=new URLSearchParams(o),c=new URLSearchParams(l);return{get:h=>a.get(h)??c.get(h)}}let e=s.hash??(typeof location>"u"?"":location.hash);return new URLSearchParams(e.replace(/^#/,""))}function Qe(s,e){return Ee(s).get(e)}function Ye(s,e){return new Promise((t,r)=>{let n=setTimeout(()=>{e?.removeEventListener("abort",o),t()},s),o=()=>{clearTimeout(n),r(e?.reason??new Error("aborted"))};e?.addEventListener("abort",o,{once:!0})})}var ie="openapps.referral";function Ze(){try{let s=localStorage.getItem(ie);if(!s)return null;let e=JSON.parse(s);return typeof e?.code!="string"||typeof e?.at!="number"?null:{code:e.code,at:e.at}}catch{return null}}function Xe(){if(!(typeof location>"u"))try{return new URLSearchParams(location.search).get("ref")??void 0}catch{return}}function Ce(){let s=Xe();if(s)try{localStorage.setItem(ie,JSON.stringify({code:s,at:Date.now()}))}catch{}}function or(){let s=Ze();if(s){if(Date.now()-s.at>2592e6){et();return}return s.code}}function et(){try{localStorage.removeItem(ie)}catch{}}var G=null;function tt(s){return G=new L(s),Ce(),rt(),G}function Pe(s,e){if(s)return s;if(G)return G;if(e)return tt({baseUrl:e});throw new Error("no OpenApps client: call configure({ baseUrl }) or set base-url on the element")}var ae=new Set;function Oe(s){return ae.add(s),()=>ae.delete(s)}function rt(){for(let s of ae)s()}var S=class extends y{constructor(){super(...arguments);this.error=null;this.busy=!1}#r;connectedCallback(){super.connectedCallback(),this.#r=Oe(()=>this.onSessionChange())}disconnectedCallback(){this.#r?.(),super.disconnectedCallback()}onSessionChange(){this.requestUpdate()}get sdk(){return Pe(this.client,this.baseUrl)}get sdkOrNull(){try{return this.sdk}catch{return null}}async run(t){this.error=null,this.busy=!0;try{return await t()}catch(r){if(r instanceof Error&&r.name==="AbortError")return;this.error=st(r);return}finally{this.busy=!1}}emit(t,r){this.dispatchEvent(new CustomEvent(t,{detail:r,bubbles:!0,composed:!0}))}static{this.baseStyles=V`
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
  `}};k([M({type:String,attribute:"base-url"})],S.prototype,"baseUrl",2),k([M({attribute:!1})],S.prototype,"client",2),k([ne()],S.prototype,"error",2),k([ne()],S.prototype,"busy",2);function st(s){if(s instanceof p)switch(s.code){case"unauthorized":return"Please sign in again.";case"insufficient_balance":return s.balance===void 0?"Not enough credits.":`Not enough credits \u2014 you have ${s.balance}.`;case"rate_limited":return"Too many attempts. Please wait a moment and try again.";case"network":return"Could not reach the server. Check your connection.";case"timeout":return"This is taking longer than expected. It may still complete.";default:return s.message}return s instanceof Error?s.message:String(s)}export{V as a,lt as b,ct as c,u as d,wt as e,M as f,ne as g,p as h,Xe as i,or as j,et as k,rt as l,S as m};
//# sourceMappingURL=chunk-OUMOJ2PH.js.map
