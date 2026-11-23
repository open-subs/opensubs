import{a as P}from"./chunk-LCQWCHVU.js";var p=class extends Error{code;status;balance;detail;constructor(e,t,r=0,s,o){super(t),this.name="OpenAppsError",this.code=e,this.status=r,this.balance=s,this.detail=o}get isAuthError(){return this.code==="unauthorized"||this.code==="reauth_required"}},Ge={400:"bad_request",401:"unauthorized",402:"insufficient_balance",404:"not_found",409:"conflict",429:"rate_limited"};function Y(n,e){let t=e&&typeof e=="object"?e.error:void 0,r=t&&typeof t=="object"?t:void 0,s=r?.code??Ge[n]??"internal",o=r?.message??`request failed with status ${n}`,i;if(s==="insufficient_balance"){let a=/-?\d+/.exec(o);a&&(i=Number(a[0]))}return new p(s,o,n,i,r)}function Z(n=null){let e=n;return{get:()=>e,set:t=>{e=t}}}function Fe(n="openapps.session"){let e=null;try{e=typeof localStorage<"u"?localStorage:null,e?.setItem(n,e.getItem(n)??""),e?.getItem(n)===""&&e.removeItem(n)}catch{e=null}if(!e)return Z();let t=e;return{get(){let r=t.getItem(n);if(!r)return null;try{let s=JSON.parse(r);return s.accessToken&&s.refreshToken?s:null}catch{return null}},set(r){r?t.setItem(n,JSON.stringify(r)):t.removeItem(n)}}}function be(){try{return typeof localStorage<"u"?Fe():Z()}catch{return Z()}}var Ve=new Set(["confirmed","failed","expired"]),C=class{baseUrl;#r;#n;#i;#l;#s=null;#o=null;constructor(e){this.baseUrl=e.baseUrl.replace(/\/+$/,""),this.#r=e.appKey,this.#n=e.store??be();let t=e.fetch??globalThis.fetch;if(!t)throw new p("network","no fetch implementation available; pass one via options.fetch");this.#i=(r,s)=>t(r,s),this.#l=e.onAuthChange}get session(){return this.#n.get()}get isLoggedIn(){return this.#n.get()!==null}#t(e){this.#n.set(e),this.#l?.(e)}adoptSession(e,t){this.#t({accessToken:e,refreshToken:t})}clearSession(){this.#t(null)}async#e(e,t={}){let r=t.auth??"none";if(r!=="none"&&!this.#n.get())throw new p("unauthorized","not logged in");if(r==="app+bearer"&&!this.#r)throw new p("unauthorized","this call needs an app key; construct OpenApps with { appKey }");return this.#a(e,t,r,!0)}async#a(e,t,r,s){let o=`${this.baseUrl}${e}`;if(t.query){let c=new URLSearchParams;for(let[h,f]of Object.entries(t.query))f!==void 0&&c.set(h,String(f));let d=c.toString();d&&(o+=`?${d}`)}let i={accept:"application/json"};t.body!==void 0&&(i["content-type"]="application/json"),r!=="none"&&(i.authorization=`Bearer ${this.#n.get()?.accessToken??""}`),r==="app+bearer"&&this.#r&&(i["x-openapps-app-key"]=this.#r);let a;try{a=await this.#i(o,{method:t.method??"GET",headers:i,body:t.body===void 0?void 0:JSON.stringify(t.body),signal:t.signal})}catch(c){throw c instanceof Error&&c.name==="AbortError"?c:new p("network",c instanceof Error?c.message:"network request failed")}if(a.status===401&&r!=="none"&&s&&await this.#d())return this.#a(e,t,r,!1);let l=await this.#c(a);if(!a.ok){let c=Y(a.status,l);throw c.code==="unauthorized"&&r!=="none"&&this.#t(null),c}return l}async#c(e){if(e.status===204)return null;let t=await e.text();if(!t)return null;try{return JSON.parse(t)}catch{throw new p(e.ok?"internal":"network",`expected JSON, got: ${t.slice(0,200)}`,e.status)}}#d(){if(this.#s)return this.#s;let e=this.#n.get();return e?(this.#s=(async()=>{try{let t=await this.#a("/v1/auth/refresh",{method:"POST",body:{refresh_token:e.refreshToken}},"none",!1),r={accessToken:t.access_token,refreshToken:t.refresh_token};return this.#t(r),r}catch{return this.#t(null),null}finally{this.#s=null}})(),this.#s):Promise.resolve(null)}auth={methods:async e=>(await this.#e("/v1/auth/methods",{signal:e})).methods,serverInfo:async e=>{let t=await this.#e("/v1/auth/methods",{signal:e});return{methods:t.methods,openwallet_install_url:Je(t.openwallet_install_url)}},challenge:(e,t,r)=>this.#e("/v1/auth/challenge",{method:"POST",body:{namespace:e,address:t},signal:r}),verify:async(e,t,r={})=>{let s=await this.#e("/v1/auth/verify",{method:"POST",body:{challenge_id:e,proof:t,referral_code:r.referralCode},signal:r.signal});return this.#t({accessToken:s.access_token,refreshToken:s.refresh_token}),s},emailPow:e=>this.#e("/v1/auth/email/pow",{signal:e}),emailStart:(e,t,r={})=>this.#e("/v1/auth/email/start",{method:"POST",body:{email:e,pow:t,lang:r.lang},signal:r.signal}),emailVerify:async(e,t,r={})=>{let s=await this.#e("/v1/auth/email/verify",{method:"POST",body:{flow_id:e,code:t,referral_code:r.referralCode},signal:r.signal});return this.#t({accessToken:s.access_token,refreshToken:s.refresh_token}),s},redirectStartUrl:(e,t,r)=>{let s=new URLSearchParams;t&&s.set("return_to",t),r&&s.set("ref",r);let o=s.toString();return`${this.baseUrl}/v1/auth/oidc/${e}/start${o?`?${o}`:""}`},googleStartUrl:(e,t)=>this.auth.redirectStartUrl("google",e,t),redirectStart:async(e,t,r)=>{let s=this.auth.redirectStartUrl(e,t,r),o=await Ye(t);if(!o)return s;let i=s.includes("?")?"&":"?";return`${s}${i}code_challenge=${o}&code_challenge_method=S256`},redirectAuthorizeUrl:async(e,t,r,s)=>{let o=await this.auth.redirectStart(e,t,r),i=`${o}${o.includes("?")?"&":"?"}mode=json`,a;try{a=await this.#i(i,{method:"GET",credentials:"include",headers:{accept:"application/json"},signal:s})}catch(d){throw d instanceof Error&&d.name==="AbortError"?d:new p("network",d instanceof Error?d.message:"network request failed")}let l=await this.#c(a);if(!a.ok)throw Y(a.status,l);let c=l?.authorize_url;if(typeof c!="string"||!c)throw new p("internal","the sign-in start returned no authorize_url");return c},completeRedirect:(e={})=>{let t=We(e,"code");if(!t)return Promise.resolve(null);if(this.#o)return this.#o;let r=Ze();return!r&&this.isLoggedIn?(X(e,["code"]),Promise.resolve(null)):(this.#o=(async()=>{try{let s=await this.#e("/v1/auth/oidc/exchange",{method:"POST",body:r?{code:t,code_verifier:r}:{code:t},signal:e.signal});return this.#t({accessToken:s.access_token,refreshToken:s.refresh_token}),s}finally{this.#o=null,X(e,["code"])}})(),this.#o)},me:e=>this.#e("/v1/me",{auth:"bearer",signal:e}),logout:async e=>{try{await this.#e("/v1/auth/logout",{method:"POST",auth:"bearer",signal:e})}finally{this.#t(null)}},deleteAccount:async e=>{await this.#e("/v1/me",{method:"DELETE",auth:"bearer",signal:e}),this.#t(null)},linkChallenge:(e,t,r)=>this.#e("/v1/auth/link/challenge",{method:"POST",auth:"bearer",body:{namespace:e,address:t},signal:r}),linkVerify:(e,t,r={})=>this.#e("/v1/auth/link/verify",{method:"POST",auth:"bearer",body:{challenge_id:e,proof:t,merge:r.merge??!1,...r.expect?{expect:r.expect}:{}},signal:r.signal}),redirectLinkStart:async(e,t,r={})=>(await this.auth.redirectLinkBegin(e,t,r)).auth_url,redirectLinkBegin:(e,t,r={})=>this.#e(`/v1/auth/link/oidc/${e}/start`,{method:"POST",auth:"bearer",body:{return_to:t},signal:r.signal}),redirectLink:async(e,t,r={})=>{let s=await this.auth.redirectLinkBegin(e,t,r);if(!Qe(s)){if(typeof window>"u")throw new Error("redirectLink needs a page to navigate; use redirectLinkBegin");window.location.href=s.auth_url}},confirmLink:(e,t={})=>this.#e("/v1/auth/link/oidc/confirm",{method:"POST",auth:"bearer",body:{code:e,merge:t.merge??!1},signal:t.signal}),sessions:e=>this.#e("/v1/sessions",{auth:"bearer",signal:e}),revokeSession:(e,t)=>this.#e(`/v1/sessions/${encodeURIComponent(e)}`,{method:"DELETE",auth:"bearer",signal:t}),revokeOtherSessions:e=>this.#e("/v1/sessions/revoke-others",{method:"POST",auth:"bearer",signal:e}),events:e=>this.#e("/v1/me/events",{auth:"bearer",signal:e}),googleLinkStart:(e,t={})=>this.auth.redirectLinkStart("google",e,t),completeLinkRedirect:(e={})=>{let t=_e(e),r=t.get("link_pending"),s=t.get("linked"),o=t.get("link_conflict"),i=t.get("link_blocked"),a=t.get("link_error");if(!r&&!s&&!o&&!i&&!a)return null;if(X(e,["link_pending","provider","linked","link_conflict","link_blocked","link_error","clashes"],["merged","credits","balance"]),r)return{status:"pending",code:r,namespace:t.get("provider")??""};if(a)return{status:"error",message:a};if(i){let l=(t.get("clashes")??"").split(",").filter(Boolean),c=l.map(ve).join(" and ");return{status:"blocked",namespaces:l,message:`That ${ve(i)} account belongs to another account which also has a ${c} sign-in, and so does this one. Disconnect it from the other account first.`}}return o?{status:"conflict",namespace:o,balance:Number(t.get("balance")??0)}:{status:"linked",namespace:s,merged:t.get("merged")==="1",credits:Number(t.get("credits")??0)}},cancelMerge:(e,t)=>this.#e(`/v1/auth/merges/${encodeURIComponent(e)}/cancel`,{method:"POST",auth:"bearer",signal:t}),unlink:(e,t)=>this.#e(`/v1/auth/link/${encodeURIComponent(e)}`,{method:"DELETE",auth:"bearer",signal:t})};credits={balance:async e=>(await this.#e("/v1/credits/balance",{auth:"bearer",signal:e})).balance,breakdown:e=>this.#e("/v1/credits/balance",{auth:"bearer",signal:e}),deduct:(e,t,r,s)=>this.#e("/v1/credits/deduct",{method:"POST",auth:"app+bearer",body:{amount:e,reason:t,idempotency_key:r},signal:s}),history:(e={})=>this.#e("/v1/credits/history",{auth:"bearer",query:{cursor:e.cursor,limit:e.limit},signal:e.signal})};delegation=(e="GET",t)=>this.#e("/v1/me/delegation",{method:e,auth:"bearer",body:t});payments={packages:e=>this.#e("/v1/payments/packages",{signal:e}),stripeCheckout:(e,t={})=>this.#e("/v1/payments/stripe/checkout",{method:"POST",auth:"bearer",body:{package_id:e,return_to:t.returnTo===null?void 0:t.returnTo??Ke()},signal:t.signal}),ethDepositAddress:(e,t)=>this.#e("/v1/payments/eth/deposit-address",{method:"POST",auth:"bearer",body:{package_id:e},signal:t}),usdt0DepositAddress:(e,t,r)=>this.#e("/v1/payments/usdt0/deposit-address",{method:"POST",auth:"bearer",body:{package_id:e,network:t},signal:r}),lightningInvoice:(e,t)=>this.#e("/v1/payments/lightning/invoice",{method:"POST",auth:"bearer",body:{package_id:e},signal:t}),list:e=>this.#e("/v1/payments/topups",{auth:"bearer",signal:e}),get:(e,t)=>this.#e(`/v1/payments/topups/${encodeURIComponent(e)}`,{auth:"bearer",signal:t}),waitFor:async(e,t={})=>{let r=t.intervalMs??2e3,s=Date.now()+(t.timeoutMs??900*1e3);for(;;){t.signal?.throwIfAborted();try{let o=await this.payments.get(e,t.signal);if(t.onPoll?.(o),Ve.has(o.status))return o}catch(o){if(o instanceof p&&o.code!=="network"||!(o instanceof p))throw o}if(Date.now()+r>s)throw new p("timeout",`top-up ${e} was still pending after the timeout`);await Xe(r,t.signal)}}};referral={code:(e,t)=>this.#e("/v1/referral/code",{auth:"bearer",query:{app:e},signal:t}),apply:(e,t)=>this.#e("/v1/referral/apply",{method:"POST",auth:"bearer",body:{code:e},signal:t}),earnings:e=>this.#e("/v1/referral/earnings",{auth:"bearer",signal:e}),referees:e=>this.#e("/v1/referral/referees",{auth:"bearer",signal:e})}};function Ke(){if(!(typeof location>"u"))return`${location.origin}${location.pathname}${location.search}`}function X(n,e,t=[]){if(n.url!==void 0||typeof history>"u"||typeof location>"u")return;let r=new URLSearchParams(location.search.replace(/^\?/,"")),s=new URLSearchParams(location.hash.replace(/^#/,""));for(let a of e)r.delete(a),s.delete(a);for(let a of t)s.delete(a);let o=r.toString(),i=s.toString();history.replaceState({},"",location.pathname+(o?`?${o}`:"")+(i?`#${i}`:""))}function _e(n){if(n.url!==void 0){let t=n.url,r=t.indexOf("#"),s=t.indexOf("?"),o=r>=0?t.slice(r+1):"",a=s>=0&&(r<0||s<r)?t.slice(s+1,r>=0?r:void 0):"",l=new URLSearchParams(o),c=new URLSearchParams(a);return{get:d=>l.get(d)??c.get(d)}}let e=n.hash??(typeof location>"u"?"":location.hash);return new URLSearchParams(e.replace(/^#/,""))}function We(n,e){return _e(n).get(e)}function Je(n){if(typeof n!="string")return null;try{let e=new URL(n);return e.protocol==="https:"&&!e.username&&!e.password?n:null}catch{return null}}function Qe(n){let e=n.go;if(!e||e.method!=="POST"||typeof document>"u")return!1;let t;try{t=new URL(e.url)}catch{return!1}if(t.protocol!=="https:"&&t.protocol!=="http:")return!1;let r=document.createElement("form");r.method="POST",r.action=t.href,r.hidden=!0;for(let[s,o]of Object.entries(e.fields??{})){let i=document.createElement("input");i.type="hidden",i.name=s,i.value=String(o),r.append(i)}return document.body.append(r),r.submit(),!0}var ee="openapps.pkce_verifier";function $e(){try{return typeof sessionStorage>"u"?null:sessionStorage}catch{return null}}function ye(n){let e="";for(let t of n)e+=String.fromCharCode(t);return btoa(e).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}async function Ye(n){let e=$e(),t=globalThis.crypto?.subtle;if(!e||!t||typeof location>"u")return null;if(n)try{if(new URL(n).origin!==location.origin)return null}catch{return null}let r=new Uint8Array(32);globalThis.crypto.getRandomValues(r);let s=ye(r),o=new Uint8Array(await t.digest("SHA-256",new TextEncoder().encode(s)));try{e.setItem(ee,s)}catch{return null}return ye(o)}function Ze(){let n=$e();if(!n)return null;try{let e=n.getItem(ee);return n.removeItem(ee),e}catch{return null}}function ve(n){return{google:"Google",github:"GitHub",apple:"Apple",openwallet:"OnWallet",eip155:"wallet",nostr:"Nostr"}[n]??n}function Xe(n,e){return new Promise((t,r)=>{let s=setTimeout(()=>{e?.removeEventListener("abort",o),t()},n),o=()=>{clearTimeout(s),r(e?.reason??new Error("aborted"))};e?.addEventListener("abort",o,{once:!0})})}var te="openapps.referral";function et(){try{let n=localStorage.getItem(te);if(!n)return null;let e=JSON.parse(n);return typeof e?.code!="string"||typeof e?.at!="number"?null:{code:e.code,at:e.at}}catch{return null}}function tt(){if(!(typeof location>"u"))try{return new URLSearchParams(location.search).get("ref")??void 0}catch{return}}function we(){let n=tt();if(n)try{localStorage.setItem(te,JSON.stringify({code:n,at:Date.now()}))}catch{}}function Rt(){let n=et();if(n){if(Date.now()-n.at>2592e6){rt();return}return n.code}}function rt(){try{localStorage.removeItem(te)}catch{}}var O=null;function nt(n){return O=new C(n),we(),z(),O}function It(){return O}function xe(n,e){if(n)return n;if(O)return O;if(e)return nt({baseUrl:e});throw new Error("no OpenApps client: call configure({ baseUrl }) or set base-url on the element")}var re=new Set;function Se(n){return re.add(n),()=>re.delete(n)}function z(){for(let n of re)n()}var T=new Map,g="en",ke=new Set;function Ht(n,e){T.set(n,{...T.get(n)??{},...e}),n===g&&z()}function jt(n){n!==g&&(g=n,ke.clear(),z())}function zt(){return g}function B(){return g==="en"&&!T.has("en")?void 0:g}var Ae=new Map;function G(n,e){let t=B(),r=`${t??""}|${JSON.stringify(e??{})}`,s=Ae.get(r);if(!s){try{s=new Intl.NumberFormat(t,e)}catch{s=new Intl.NumberFormat(void 0,e)}Ae.set(r,s)}return s.format(n)}function m(n,e){let t=n,r=!1;if(g!=="en"||T.has("en")){let s=T.get(g)?.[n];s!==void 0?(t=s,r=s.includes("|")):g!=="en"&&ke.add(n)}return r&&(t=at(t,e)),e?t.replace(/\{(\w+)\}/g,(s,o)=>o in e?st(e[o]):s):t}function st(n){return typeof n=="number"?G(n):String(n)}var ot=["one","two","few","many","other"];function it(n){for(let e of Object.values(n??{})){if(typeof e=="number")return e;if(typeof e=="string"&&/^\d[\d\s\u00a0\u202f.,']*$/.test(e))return Number(e.replace(/\D/g,""))}}function at(n,e){let t=n.split("|"),r=typeof e?.n=="number"?e.n:it(e);if(typeof r!="number")return t[t.length-1];let s="other",o=["other"];try{let a=new Intl.PluralRules(g);s=a.select(r);let l=a.resolvedOptions().pluralCategories;o=ot.filter(c=>l.includes(c))}catch{}let i=o.indexOf(s);return t[Math.min(i<0?t.length-1:i,t.length-1)]}var F=globalThis,V=F.ShadowRoot&&(F.ShadyCSS===void 0||F.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,ne=Symbol(),Ee=new WeakMap,U=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==ne)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(V&&e===void 0){let r=t!==void 0&&t.length===1;r&&(e=Ee.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),r&&Ee.set(t,e))}return e}toString(){return this.cssText}},Pe=n=>new U(typeof n=="string"?n:n+"",void 0,ne),se=(n,...e)=>{let t=n.length===1?n[0]:e.reduce((r,s,o)=>r+(i=>{if(i._$cssResult$===!0)return i.cssText;if(typeof i=="number")return i;throw Error("Value passed to 'css' function must be a 'css' function result: "+i+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+n[o+1],n[0]);return new U(t,n,ne)},Ce=(n,e)=>{if(V)n.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let r=document.createElement("style"),s=F.litNonce;s!==void 0&&r.setAttribute("nonce",s),r.textContent=t.cssText,n.appendChild(r)}},oe=V?n=>n:n=>n instanceof CSSStyleSheet?(e=>{let t="";for(let r of e.cssRules)t+=r.cssText;return Pe(t)})(n):n;var{is:lt,defineProperty:ct,getOwnPropertyDescriptor:dt,getOwnPropertyNames:ht,getOwnPropertySymbols:ut,getPrototypeOf:pt}=Object,K=globalThis,Oe=K.trustedTypes,ft=Oe?Oe.emptyScript:"",gt=K.reactiveElementPolyfillSupport,R=(n,e)=>n,L={toAttribute(n,e){switch(e){case Boolean:n=n?ft:null;break;case Object:case Array:n=n==null?n:JSON.stringify(n)}return n},fromAttribute(n,e){let t=n;switch(e){case Boolean:t=n!==null;break;case Number:t=n===null?null:Number(n);break;case Object:case Array:try{t=JSON.parse(n)}catch{t=null}}return t}},W=(n,e)=>!lt(n,e),Te={attribute:!0,type:String,converter:L,reflect:!1,useDefault:!1,hasChanged:W};Symbol.metadata??=Symbol("metadata"),K.litPropertyMetadata??=new WeakMap;var b=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Te){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let r=Symbol(),s=this.getPropertyDescriptor(e,r,t);s!==void 0&&ct(this.prototype,e,s)}}static getPropertyDescriptor(e,t,r){let{get:s,set:o}=dt(this.prototype,e)??{get(){return this[t]},set(i){this[t]=i}};return{get:s,set(i){let a=s?.call(this);o?.call(this,i),this.requestUpdate(e,a,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Te}static _$Ei(){if(this.hasOwnProperty(R("elementProperties")))return;let e=pt(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(R("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(R("properties"))){let t=this.properties,r=[...ht(t),...ut(t)];for(let s of r)this.createProperty(s,t[s])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[r,s]of t)this.elementProperties.set(r,s)}this._$Eh=new Map;for(let[t,r]of this.elementProperties){let s=this._$Eu(t,r);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let r=new Set(e.flat(1/0).reverse());for(let s of r)t.unshift(oe(s))}else e!==void 0&&t.push(oe(e));return t}static _$Eu(e,t){let r=t.attribute;return r===!1?void 0:typeof r=="string"?r:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let r of t.keys())this.hasOwnProperty(r)&&(e.set(r,this[r]),delete this[r]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ce(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,r){this._$AK(e,r)}_$ET(e,t){let r=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,r);if(s!==void 0&&r.reflect===!0){let o=(r.converter?.toAttribute!==void 0?r.converter:L).toAttribute(t,r.type);this._$Em=e,o==null?this.removeAttribute(s):this.setAttribute(s,o),this._$Em=null}}_$AK(e,t){let r=this.constructor,s=r._$Eh.get(e);if(s!==void 0&&this._$Em!==s){let o=r.getPropertyOptions(s),i=typeof o.converter=="function"?{fromAttribute:o.converter}:o.converter?.fromAttribute!==void 0?o.converter:L;this._$Em=s;let a=i.fromAttribute(t,o.type);this[s]=a??this._$Ej?.get(s)??a,this._$Em=null}}requestUpdate(e,t,r,s=!1,o){if(e!==void 0){let i=this.constructor;if(s===!1&&(o=this[e]),r??=i.getPropertyOptions(e),!((r.hasChanged??W)(o,t)||r.useDefault&&r.reflect&&o===this._$Ej?.get(e)&&!this.hasAttribute(i._$Eu(e,r))))return;this.C(e,t,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:r,reflect:s,wrapped:o},i){r&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,i??t??this[e]),o!==!0||i!==void 0)||(this._$AL.has(e)||(this.hasUpdated||r||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[s,o]of this._$Ep)this[s]=o;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[s,o]of r){let{wrapped:i}=o,a=this[s];i!==!0||this._$AL.has(s)||a===void 0||this.C(s,void 0,o,a)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(t)):this._$EM()}catch(r){throw e=!1,this._$EM(),r}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};b.elementStyles=[],b.shadowRootOptions={mode:"open"},b[R("elementProperties")]=new Map,b[R("finalized")]=new Map,gt?.({ReactiveElement:b}),(K.reactiveElementVersions??=[]).push("2.1.2");var ue=globalThis,Ue=n=>n,J=ue.trustedTypes,Re=J?J.createPolicy("lit-html",{createHTML:n=>n}):void 0,qe="$lit$",v=`lit$${Math.random().toFixed(9).slice(2)}$`,He="?"+v,mt=`<${He}>`,x=document,M=()=>x.createComment(""),I=n=>n===null||typeof n!="object"&&typeof n!="function",pe=Array.isArray,bt=n=>pe(n)||typeof n?.[Symbol.iterator]=="function",ie=`[ 	
\f\r]`,N=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Le=/-->/g,Ne=/>/g,$=RegExp(`>|${ie}(?:([^\\s"'>=/]+)(${ie}*=${ie}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Me=/'/g,Ie=/"/g,je=/^(?:script|style|textarea|title)$/i,fe=n=>(e,...t)=>({_$litType$:n,strings:e,values:t}),Wt=fe(1),Jt=fe(2),Qt=fe(3),S=Symbol.for("lit-noChange"),u=Symbol.for("lit-nothing"),De=new WeakMap,w=x.createTreeWalker(x,129);function ze(n,e){if(!pe(n)||!n.hasOwnProperty("raw"))throw Error("invalid template strings array");return Re!==void 0?Re.createHTML(e):e}var yt=(n,e)=>{let t=n.length-1,r=[],s,o=e===2?"<svg>":e===3?"<math>":"",i=N;for(let a=0;a<t;a++){let l=n[a],c,d,h=-1,f=0;for(;f<l.length&&(i.lastIndex=f,d=i.exec(l),d!==null);)f=i.lastIndex,i===N?d[1]==="!--"?i=Le:d[1]!==void 0?i=Ne:d[2]!==void 0?(je.test(d[2])&&(s=RegExp("</"+d[2],"g")),i=$):d[3]!==void 0&&(i=$):i===$?d[0]===">"?(i=s??N,h=-1):d[1]===void 0?h=-2:(h=i.lastIndex-d[2].length,c=d[1],i=d[3]===void 0?$:d[3]==='"'?Ie:Me):i===Ie||i===Me?i=$:i===Le||i===Ne?i=N:(i=$,s=void 0);let y=i===$&&n[a+1].startsWith("/>")?" ":"";o+=i===N?l+mt:h>=0?(r.push(c),l.slice(0,h)+qe+l.slice(h)+v+y):l+v+(h===-2?a:y)}return[ze(n,o+(n[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),r]},D=class n{constructor({strings:e,_$litType$:t},r){let s;this.parts=[];let o=0,i=0,a=e.length-1,l=this.parts,[c,d]=yt(e,t);if(this.el=n.createElement(c,r),w.currentNode=this.el.content,t===2||t===3){let h=this.el.content.firstChild;h.replaceWith(...h.childNodes)}for(;(s=w.nextNode())!==null&&l.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(let h of s.getAttributeNames())if(h.endsWith(qe)){let f=d[i++],y=s.getAttribute(h).split(v),j=/([.?@])?(.*)/.exec(f);l.push({type:1,index:o,name:j[2],strings:y,ctor:j[1]==="."?le:j[1]==="?"?ce:j[1]==="@"?de:k}),s.removeAttribute(h)}else h.startsWith(v)&&(l.push({type:6,index:o}),s.removeAttribute(h));if(je.test(s.tagName)){let h=s.textContent.split(v),f=h.length-1;if(f>0){s.textContent=J?J.emptyScript:"";for(let y=0;y<f;y++)s.append(h[y],M()),w.nextNode(),l.push({type:2,index:++o});s.append(h[f],M())}}}else if(s.nodeType===8)if(s.data===He)l.push({type:2,index:o});else{let h=-1;for(;(h=s.data.indexOf(v,h+1))!==-1;)l.push({type:7,index:o}),h+=v.length-1}o++}}static createElement(e,t){let r=x.createElement("template");return r.innerHTML=e,r}};function A(n,e,t=n,r){if(e===S)return e;let s=r!==void 0?t._$Co?.[r]:t._$Cl,o=I(e)?void 0:e._$litDirective$;return s?.constructor!==o&&(s?._$AO?.(!1),o===void 0?s=void 0:(s=new o(n),s._$AT(n,t,r)),r!==void 0?(t._$Co??=[])[r]=s:t._$Cl=s),s!==void 0&&(e=A(n,s._$AS(n,e.values),s,r)),e}var ae=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:r}=this._$AD,s=(e?.creationScope??x).importNode(t,!0);w.currentNode=s;let o=w.nextNode(),i=0,a=0,l=r[0];for(;l!==void 0;){if(i===l.index){let c;l.type===2?c=new q(o,o.nextSibling,this,e):l.type===1?c=new l.ctor(o,l.name,l.strings,this,e):l.type===6&&(c=new he(o,this,e)),this._$AV.push(c),l=r[++a]}i!==l?.index&&(o=w.nextNode(),i++)}return w.currentNode=x,s}p(e){let t=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(e,r,t),t+=r.strings.length-2):r._$AI(e[t])),t++}},q=class n{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,r,s){this.type=2,this._$AH=u,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=r,this.options=s,this._$Cv=s?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=A(this,e,t),I(e)?e===u||e==null||e===""?(this._$AH!==u&&this._$AR(),this._$AH=u):e!==this._$AH&&e!==S&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):bt(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==u&&I(this._$AH)?this._$AA.nextSibling.data=e:this.T(x.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:r}=e,s=typeof r=="number"?this._$AC(e):(r.el===void 0&&(r.el=D.createElement(ze(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===s)this._$AH.p(t);else{let o=new ae(s,this),i=o.u(this.options);o.p(t),this.T(i),this._$AH=o}}_$AC(e){let t=De.get(e.strings);return t===void 0&&De.set(e.strings,t=new D(e)),t}k(e){pe(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,r,s=0;for(let o of e)s===t.length?t.push(r=new n(this.O(M()),this.O(M()),this,this.options)):r=t[s],r._$AI(o),s++;s<t.length&&(this._$AR(r&&r._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let r=Ue(e).nextSibling;Ue(e).remove(),e=r}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},k=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,r,s,o){this.type=1,this._$AH=u,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=o,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=u}_$AI(e,t=this,r,s){let o=this.strings,i=!1;if(o===void 0)e=A(this,e,t,0),i=!I(e)||e!==this._$AH&&e!==S,i&&(this._$AH=e);else{let a=e,l,c;for(e=o[0],l=0;l<o.length-1;l++)c=A(this,a[r+l],t,l),c===S&&(c=this._$AH[l]),i||=!I(c)||c!==this._$AH[l],c===u?e=u:e!==u&&(e+=(c??"")+o[l+1]),this._$AH[l]=c}i&&!s&&this.j(e)}j(e){e===u?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},le=class extends k{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===u?void 0:e}},ce=class extends k{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==u)}},de=class extends k{constructor(e,t,r,s,o){super(e,t,r,s,o),this.type=5}_$AI(e,t=this){if((e=A(this,e,t,0)??u)===S)return;let r=this._$AH,s=e===u&&r!==u||e.capture!==r.capture||e.once!==r.once||e.passive!==r.passive,o=e!==u&&(r===u||s);s&&this.element.removeEventListener(this.name,this,r),o&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},he=class{constructor(e,t,r){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(e){A(this,e)}};var vt=ue.litHtmlPolyfillSupport;vt?.(D,q),(ue.litHtmlVersions??=[]).push("3.3.3");var Be=(n,e,t)=>{let r=t?.renderBefore??e,s=r._$litPart$;if(s===void 0){let o=t?.renderBefore??null;r._$litPart$=s=new q(e.insertBefore(M(),o),o,void 0,t??{})}return s._$AI(n),s};var ge=globalThis,_=class extends b{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Be(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return S}};_._$litElement$=!0,_.finalized=!0,ge.litElementHydrateSupport?.({LitElement:_});var _t=ge.litElementPolyfillSupport;_t?.({LitElement:_});(ge.litElementVersions??=[]).push("4.2.2");var cr=n=>(e,t)=>{t!==void 0?t.addInitializer(()=>{customElements.define(n,e)}):customElements.define(n,e)};var $t={attribute:!0,type:String,converter:L,reflect:!1,hasChanged:W},wt=(n=$t,e,t)=>{let{kind:r,metadata:s}=t,o=globalThis.litPropertyMetadata.get(s);if(o===void 0&&globalThis.litPropertyMetadata.set(s,o=new Map),r==="setter"&&((n=Object.create(n)).wrapped=!0),o.set(t.name,n),r==="accessor"){let{name:i}=t;return{set(a){let l=e.get.call(this);e.set.call(this,a),this.requestUpdate(i,l,n,!0,a)},init(a){return a!==void 0&&this.C(i,void 0,n,a),a}}}if(r==="setter"){let{name:i}=t;return function(a){let l=this[i];e.call(this,a),this.requestUpdate(i,l,n,!0,a)}}throw Error("Unsupported decorator location: "+r)};function H(n){return(e,t)=>typeof t=="object"?wt(n,e,t):((r,s,o)=>{let i=s.hasOwnProperty(o);return s.constructor.createProperty(o,r),i?Object.getOwnPropertyDescriptor(s,o):void 0})(n,e,t)}function me(n){return H({...n,state:!0,attribute:!1})}var E=class extends _{constructor(){super(...arguments);this.error=null;this.busy=!1}#r;connectedCallback(){super.connectedCallback(),this.#r=Se(()=>{this.onSessionChange(),this.requestUpdate()})}disconnectedCallback(){this.#r?.(),super.disconnectedCallback()}onSessionChange(){this.requestUpdate()}get sdk(){return xe(this.client,this.baseUrl)}get sdkOrNull(){try{return this.sdk}catch{return null}}async run(t){this.error=null,this.busy=!0;try{return await t()}catch(r){if(r instanceof Error&&r.name==="AbortError")return;this.error=xt(r);return}finally{this.busy=!1}}emit(t,r){this.dispatchEvent(new CustomEvent(t,{detail:r,bubbles:!0,composed:!0}))}static{this.baseStyles=se`
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
  `}};P([H({type:String,attribute:"base-url"})],E.prototype,"baseUrl",2),P([H({attribute:!1})],E.prototype,"client",2),P([me()],E.prototype,"error",2),P([me()],E.prototype,"busy",2);function xt(n){if(n instanceof p)switch(n.code){case"unauthorized":return m("Please sign in again.");case"insufficient_balance":return n.balance===void 0?m("Not enough credits."):m("Not enough credits \u2014 you have {balance}.",{balance:n.balance});case"rate_limited":return m("Too many attempts. Please wait a moment and try again.");case"network":return m("Could not reach the server. Check your connection.");case"timeout":return m("This is taking longer than expected. It may still complete.");default:return n.message}return n instanceof Error?n.message:String(n)}var St={apple:"Apple",google:"Google",github:"GitHub",openwallet:"OnWallet",nostr:"Nostr"};function Fr(n){return n==="eip155"?m("Wallet"):St[n]??n}function Vr(n){return G(n)}function Kr(n){return G(n/1e6,{style:"percent",maximumFractionDigits:1})}function Wr(n){return new Date(n*1e3).toLocaleDateString(B(),{year:"numeric",month:"long",day:"numeric"})}function Jr(n){return new Date(n*1e3).toLocaleString(B(),{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"})}function Qr(n){return`${new Date(n*1e3).toISOString().slice(0,16).replace("T"," ")} UTC`}function Yr(n,e=18,t=8){return n.length<=e+t+1?n:`${n.slice(0,e)}\u2026${n.slice(-t)}`}export{p as a,tt as b,we as c,Rt as d,rt as e,nt as f,It as g,Se as h,z as i,Ht as j,jt as k,zt as l,B as m,G as n,m as o,se as p,Ce as q,Wt as r,Jt as s,u as t,cr as u,H as v,me as w,E as x,xt as y,St as z,Fr as A,Vr as B,Kr as C,Wr as D,Jr as E,Qr as F,Yr as G};
//# sourceMappingURL=chunk-BGLZNXAK.js.map
