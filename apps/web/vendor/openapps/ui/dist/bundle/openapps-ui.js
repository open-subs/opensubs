import{a as l,b as I,c as ae,d as oe}from"./chunk-LCQWCHVU.js";var y=class extends Error{code;status;balance;detail;constructor(t,e,r=0,s,i){super(e),this.name="OpenAppsError",this.code=t,this.status=r,this.balance=s,this.detail=i}get isAuthError(){return this.code==="unauthorized"}},kt={400:"bad_request",401:"unauthorized",402:"insufficient_balance",404:"not_found",409:"conflict",429:"rate_limited"};function Be(n,t){let e=t&&typeof t=="object"?t.error:void 0,r=e&&typeof e=="object"?e:void 0,s=r?.code??kt[n]??"internal",i=r?.message??`request failed with status ${n}`,a;if(s==="insufficient_balance"){let c=/-?\d+/.exec(i);c&&(a=Number(c[0]))}return new y(s,i,n,a,r)}function ve(n=null){let t=n;return{get:()=>t,set:e=>{t=e}}}function $t(n="openapps.session"){let t=null;try{t=typeof localStorage<"u"?localStorage:null,t?.setItem(n,t.getItem(n)??""),t?.getItem(n)===""&&t.removeItem(n)}catch{t=null}if(!t)return ve();let e=t;return{get(){let r=e.getItem(n);if(!r)return null;try{let s=JSON.parse(r);return s.accessToken&&s.refreshToken?s:null}catch{return null}},set(r){r?e.setItem(n,JSON.stringify(r)):e.removeItem(n)}}}function Ve(){try{return typeof localStorage<"u"?$t():ve()}catch{return ve()}}var xt=new Set(["confirmed","failed","expired"]),K=class{baseUrl;#r;#n;#o;#l;#s=null;#i=null;constructor(t){this.baseUrl=t.baseUrl.replace(/\/+$/,""),this.#r=t.appKey,this.#n=t.store??Ve();let e=t.fetch??globalThis.fetch;if(!e)throw new y("network","no fetch implementation available; pass one via options.fetch");this.#o=(r,s)=>e(r,s),this.#l=t.onAuthChange}get session(){return this.#n.get()}get isLoggedIn(){return this.#n.get()!==null}#t(t){this.#n.set(t),this.#l?.(t)}adoptSession(t,e){this.#t({accessToken:t,refreshToken:e})}clearSession(){this.#t(null)}async#e(t,e={}){let r=e.auth??"none";if(r!=="none"&&!this.#n.get())throw new y("unauthorized","not logged in");if(r==="app+bearer"&&!this.#r)throw new y("unauthorized","this call needs an app key; construct OpenApps with { appKey }");return this.#a(t,e,r,!0)}async#a(t,e,r,s){let i=`${this.baseUrl}${t}`;if(e.query){let h=new URLSearchParams;for(let[m,E]of Object.entries(e.query))E!==void 0&&h.set(m,String(E));let b=h.toString();b&&(i+=`?${b}`)}let a={accept:"application/json"};e.body!==void 0&&(a["content-type"]="application/json"),r!=="none"&&(a.authorization=`Bearer ${this.#n.get()?.accessToken??""}`),r==="app+bearer"&&this.#r&&(a["x-openapps-app-key"]=this.#r);let c;try{c=await this.#o(i,{method:e.method??"GET",headers:a,body:e.body===void 0?void 0:JSON.stringify(e.body),signal:e.signal})}catch(h){throw h instanceof Error&&h.name==="AbortError"?h:new y("network",h instanceof Error?h.message:"network request failed")}if(c.status===401&&r!=="none"&&s&&await this.#d())return this.#a(t,e,r,!1);let u=await this.#c(c);if(!c.ok){let h=Be(c.status,u);throw h.code==="unauthorized"&&r!=="none"&&this.#t(null),h}return u}async#c(t){if(t.status===204)return null;let e=await t.text();if(!e)return null;try{return JSON.parse(e)}catch{throw new y(t.ok?"internal":"network",`expected JSON, got: ${e.slice(0,200)}`,t.status)}}#d(){if(this.#s)return this.#s;let t=this.#n.get();return t?(this.#s=(async()=>{try{let e=await this.#a("/v1/auth/refresh",{method:"POST",body:{refresh_token:t.refreshToken}},"none",!1),r={accessToken:e.access_token,refreshToken:e.refresh_token};return this.#t(r),r}catch{return this.#t(null),null}finally{this.#s=null}})(),this.#s):Promise.resolve(null)}auth={methods:async t=>(await this.#e("/v1/auth/methods",{signal:t})).methods,challenge:(t,e,r)=>this.#e("/v1/auth/challenge",{method:"POST",body:{namespace:t,address:e},signal:r}),verify:async(t,e,r={})=>{let s=await this.#e("/v1/auth/verify",{method:"POST",body:{challenge_id:t,proof:e,referral_code:r.referralCode},signal:r.signal});return this.#t({accessToken:s.access_token,refreshToken:s.refresh_token}),s},googleStartUrl:(t,e)=>{let r=new URLSearchParams;t&&r.set("return_to",t),e&&r.set("ref",e);let s=r.toString();return`${this.baseUrl}/v1/auth/oidc/google/start${s?`?${s}`:""}`},completeRedirect:(t={})=>{let e=St(t,"code");return e?this.#i?this.#i:(this.#i=(async()=>{try{let r=await this.#e("/v1/auth/oidc/exchange",{method:"POST",body:{code:e},signal:t.signal});return this.#t({accessToken:r.access_token,refreshToken:r.refresh_token}),t.hash===void 0&&t.url===void 0&&typeof history<"u"&&typeof location<"u"&&history.replaceState({},"",location.pathname+location.search),r}finally{this.#i=null}})(),this.#i):Promise.resolve(null)},me:t=>this.#e("/v1/me",{auth:"bearer",signal:t}),logout:async t=>{try{await this.#e("/v1/auth/logout",{method:"POST",auth:"bearer",signal:t})}finally{this.#t(null)}},linkChallenge:(t,e,r)=>this.#e("/v1/auth/link/challenge",{method:"POST",auth:"bearer",body:{namespace:t,address:e},signal:r}),linkVerify:(t,e,r={})=>this.#e("/v1/auth/link/verify",{method:"POST",auth:"bearer",body:{challenge_id:t,proof:e,merge:r.merge??!1},signal:r.signal}),googleLinkStart:async(t,e={})=>(await this.#e("/v1/auth/link/oidc/google/start",{method:"POST",auth:"bearer",body:{return_to:t,merge:e.merge??!1},signal:e.signal})).auth_url,completeLinkRedirect:(t={})=>{let e=Ke(t),r=e.get("linked"),s=e.get("link_conflict"),i=e.get("link_blocked"),a=e.get("link_error");if(!r&&!s&&!i&&!a)return null;if(t.hash===void 0&&t.url===void 0&&typeof history<"u"&&history.replaceState({},"",location.pathname+location.search),a)return{status:"error",message:a};if(i){let c=(e.get("clashes")??"").split(",").filter(Boolean),u=c.map(h=>({google:"Google",eip155:"wallet",nostr:"Nostr"})[h]??h).join(" and ");return{status:"blocked",namespaces:c,message:`That Google account belongs to another account which also has a ${u} sign-in, and so does this one. Disconnect it from the other account first.`}}return s?{status:"conflict",namespace:s,balance:Number(e.get("balance")??0)}:{status:"linked",namespace:r,merged:e.get("merged")==="1",credits:Number(e.get("credits")??0)}},unlink:(t,e)=>this.#e(`/v1/auth/link/${encodeURIComponent(t)}`,{method:"DELETE",auth:"bearer",signal:e})};credits={balance:async t=>(await this.#e("/v1/credits/balance",{auth:"bearer",signal:t})).balance,deduct:(t,e,r,s)=>this.#e("/v1/credits/deduct",{method:"POST",auth:"app+bearer",body:{amount:t,reason:e,idempotency_key:r},signal:s}),history:(t={})=>this.#e("/v1/credits/history",{auth:"bearer",query:{cursor:t.cursor,limit:t.limit},signal:t.signal})};payments={packages:t=>this.#e("/v1/payments/packages",{signal:t}),stripeCheckout:(t,e={})=>this.#e("/v1/payments/stripe/checkout",{method:"POST",auth:"bearer",body:{package_id:t,return_to:e.returnTo===null?void 0:e.returnTo??_t()},signal:e.signal}),ethDepositAddress:(t,e)=>this.#e("/v1/payments/eth/deposit-address",{method:"POST",auth:"bearer",body:{package_id:t},signal:e}),lightningInvoice:(t,e)=>this.#e("/v1/payments/lightning/invoice",{method:"POST",auth:"bearer",body:{package_id:t},signal:e}),list:t=>this.#e("/v1/payments/topups",{auth:"bearer",signal:t}),get:(t,e)=>this.#e(`/v1/payments/topups/${encodeURIComponent(t)}`,{auth:"bearer",signal:e}),waitFor:async(t,e={})=>{let r=e.intervalMs??2e3,s=Date.now()+(e.timeoutMs??900*1e3);for(;;){e.signal?.throwIfAborted();try{let i=await this.payments.get(t,e.signal);if(e.onPoll?.(i),xt.has(i.status))return i}catch(i){if(i instanceof y&&i.code!=="network"||!(i instanceof y))throw i}if(Date.now()+r>s)throw new y("timeout",`top-up ${t} was still pending after the timeout`);await Ct(r,e.signal)}}};referral={code:(t,e)=>this.#e("/v1/referral/code",{auth:"bearer",query:{app:t},signal:e}),apply:(t,e)=>this.#e("/v1/referral/apply",{method:"POST",auth:"bearer",body:{code:t},signal:e}),earnings:t=>this.#e("/v1/referral/earnings",{auth:"bearer",signal:t}),referees:t=>this.#e("/v1/referral/referees",{auth:"bearer",signal:t})}};function _t(){if(!(typeof location>"u"))return`${location.origin}${location.pathname}${location.search}`}function Ke(n){if(n.url!==void 0){let e=n.url,r=e.indexOf("#"),s=e.indexOf("?"),i=r>=0?e.slice(r+1):"",c=s>=0&&(r<0||s<r)?e.slice(s+1,r>=0?r:void 0):"",u=new URLSearchParams(i),h=new URLSearchParams(c);return{get:b=>u.get(b)??h.get(b)}}let t=n.hash??(typeof location>"u"?"":location.hash);return new URLSearchParams(t.replace(/^#/,""))}function St(n,t){return Ke(n).get(t)}function Ct(n,t){return new Promise((e,r)=>{let s=setTimeout(()=>{t?.removeEventListener("abort",i),e()},n),i=()=>{clearTimeout(s),r(t?.reason??new Error("aborted"))};t?.addEventListener("abort",i,{once:!0})})}var ye="openapps.referral";function Et(){try{let n=localStorage.getItem(ye);if(!n)return null;let t=JSON.parse(n);return typeof t?.code!="string"||typeof t?.at!="number"?null:{code:t.code,at:t.at}}catch{return null}}function le(){if(!(typeof location>"u"))try{return new URLSearchParams(location.search).get("ref")??void 0}catch{return}}function we(){let n=le();if(n)try{localStorage.setItem(ye,JSON.stringify({code:n,at:Date.now()}))}catch{}}function ke(){let n=Et();if(n){if(Date.now()-n.at>2592e6){R();return}return n.code}}function R(){try{localStorage.removeItem(ye)}catch{}}var J=null;function Je(n){return J=new K(n),we(),$(),J}function Pt(){return J}function Ye(n,t){if(n)return n;if(J)return J;if(t)return Je({baseUrl:t});throw new Error("no OpenApps client: call configure({ baseUrl }) or set base-url on the element")}var $e=new Set;function xe(n){return $e.add(n),()=>$e.delete(n)}function $(){for(let n of $e)n()}var ce=globalThis,de=ce.ShadowRoot&&(ce.ShadyCSS===void 0||ce.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,_e=Symbol(),Qe=new WeakMap,Y=class{constructor(t,e,r){if(this._$cssResult$=!0,r!==_e)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o,e=this.t;if(de&&t===void 0){let r=e!==void 0&&e.length===1;r&&(t=Qe.get(e)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),r&&Qe.set(e,t))}return t}toString(){return this.cssText}},Ze=n=>new Y(typeof n=="string"?n:n+"",void 0,_e),w=(n,...t)=>{let e=n.length===1?n[0]:t.reduce((r,s,i)=>r+(a=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+n[i+1],n[0]);return new Y(e,n,_e)},Xe=(n,t)=>{if(de)n.adoptedStyleSheets=t.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let e of t){let r=document.createElement("style"),s=ce.litNonce;s!==void 0&&r.setAttribute("nonce",s),r.textContent=e.cssText,n.appendChild(r)}},Se=de?n=>n:n=>n instanceof CSSStyleSheet?(t=>{let e="";for(let r of t.cssRules)e+=r.cssText;return Ze(e)})(n):n;var{is:Tt,defineProperty:At,getOwnPropertyDescriptor:Nt,getOwnPropertyNames:Rt,getOwnPropertySymbols:Mt,getPrototypeOf:Lt}=Object,ue=globalThis,et=ue.trustedTypes,Ut=et?et.emptyScript:"",It=ue.reactiveElementPolyfillSupport,Q=(n,t)=>n,Z={toAttribute(n,t){switch(t){case Boolean:n=n?Ut:null;break;case Object:case Array:n=n==null?n:JSON.stringify(n)}return n},fromAttribute(n,t){let e=n;switch(t){case Boolean:e=n!==null;break;case Number:e=n===null?null:Number(n);break;case Object:case Array:try{e=JSON.parse(n)}catch{e=null}}return e}},he=(n,t)=>!Tt(n,t),tt={attribute:!0,type:String,converter:Z,reflect:!1,useDefault:!1,hasChanged:he};Symbol.metadata??=Symbol("metadata"),ue.litPropertyMetadata??=new WeakMap;var T=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=tt){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){let r=Symbol(),s=this.getPropertyDescriptor(t,r,e);s!==void 0&&At(this.prototype,t,s)}}static getPropertyDescriptor(t,e,r){let{get:s,set:i}=Nt(this.prototype,t)??{get(){return this[e]},set(a){this[e]=a}};return{get:s,set(a){let c=s?.call(this);i?.call(this,a),this.requestUpdate(t,c,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??tt}static _$Ei(){if(this.hasOwnProperty(Q("elementProperties")))return;let t=Lt(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(Q("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Q("properties"))){let e=this.properties,r=[...Rt(e),...Mt(e)];for(let s of r)this.createProperty(s,e[s])}let t=this[Symbol.metadata];if(t!==null){let e=litPropertyMetadata.get(t);if(e!==void 0)for(let[r,s]of e)this.elementProperties.set(r,s)}this._$Eh=new Map;for(let[e,r]of this.elementProperties){let s=this._$Eu(e,r);s!==void 0&&this._$Eh.set(s,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let e=[];if(Array.isArray(t)){let r=new Set(t.flat(1/0).reverse());for(let s of r)e.unshift(Se(s))}else t!==void 0&&e.push(Se(t));return e}static _$Eu(t,e){let r=e.attribute;return r===!1?void 0:typeof r=="string"?r:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??=new Set).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,e=this.constructor.elementProperties;for(let r of e.keys())this.hasOwnProperty(r)&&(t.set(r,this[r]),delete this[r]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Xe(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,e,r){this._$AK(t,r)}_$ET(t,e){let r=this.constructor.elementProperties.get(t),s=this.constructor._$Eu(t,r);if(s!==void 0&&r.reflect===!0){let i=(r.converter?.toAttribute!==void 0?r.converter:Z).toAttribute(e,r.type);this._$Em=t,i==null?this.removeAttribute(s):this.setAttribute(s,i),this._$Em=null}}_$AK(t,e){let r=this.constructor,s=r._$Eh.get(t);if(s!==void 0&&this._$Em!==s){let i=r.getPropertyOptions(s),a=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:Z;this._$Em=s;let c=a.fromAttribute(e,i.type);this[s]=c??this._$Ej?.get(s)??c,this._$Em=null}}requestUpdate(t,e,r,s=!1,i){if(t!==void 0){let a=this.constructor;if(s===!1&&(i=this[t]),r??=a.getPropertyOptions(t),!((r.hasChanged??he)(i,e)||r.useDefault&&r.reflect&&i===this._$Ej?.get(t)&&!this.hasAttribute(a._$Eu(t,r))))return;this.C(t,e,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,e,{useDefault:r,reflect:s,wrapped:i},a){r&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,a??e??this[t]),i!==!0||a!==void 0)||(this._$AL.has(t)||(this.hasUpdated||r||(e=void 0),this._$AL.set(t,e)),s===!0&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[s,i]of this._$Ep)this[s]=i;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[s,i]of r){let{wrapped:a}=i,c=this[s];a!==!0||this._$AL.has(s)||c===void 0||this.C(s,void 0,i,c)}}let t=!1,e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(e)):this._$EM()}catch(r){throw t=!1,this._$EM(),r}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(t){}firstUpdated(t){}};T.elementStyles=[],T.shadowRootOptions={mode:"open"},T[Q("elementProperties")]=new Map,T[Q("finalized")]=new Map,It?.({ReactiveElement:T}),(ue.reactiveElementVersions??=[]).push("2.1.2");var Re=globalThis,rt=n=>n,pe=Re.trustedTypes,nt=pe?pe.createPolicy("lit-html",{createHTML:n=>n}):void 0,ct="$lit$",M=`lit$${Math.random().toFixed(9).slice(2)}$`,dt="?"+M,Ot=`<${dt}>`,W=document,ee=()=>W.createComment(""),te=n=>n===null||typeof n!="object"&&typeof n!="function",Me=Array.isArray,zt=n=>Me(n)||typeof n?.[Symbol.iterator]=="function",Ce=`[ 	
\f\r]`,X=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,st=/-->/g,it=/>/g,O=RegExp(`>|${Ce}(?:([^\\s"'>=/]+)(${Ce}*=${Ce}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),at=/'/g,ot=/"/g,ut=/^(?:script|style|textarea|title)$/i,Le=n=>(t,...e)=>({_$litType$:n,strings:t,values:e}),o=Le(1),fe=Le(2),xr=Le(3),q=Symbol.for("lit-noChange"),d=Symbol.for("lit-nothing"),lt=new WeakMap,z=W.createTreeWalker(W,129);function ht(n,t){if(!Me(n)||!n.hasOwnProperty("raw"))throw Error("invalid template strings array");return nt!==void 0?nt.createHTML(t):t}var Wt=(n,t)=>{let e=n.length-1,r=[],s,i=t===2?"<svg>":t===3?"<math>":"",a=X;for(let c=0;c<e;c++){let u=n[c],h,b,m=-1,E=0;for(;E<u.length&&(a.lastIndex=E,b=a.exec(u),b!==null);)E=a.lastIndex,a===X?b[1]==="!--"?a=st:b[1]!==void 0?a=it:b[2]!==void 0?(ut.test(b[2])&&(s=RegExp("</"+b[2],"g")),a=O):b[3]!==void 0&&(a=O):a===O?b[0]===">"?(a=s??X,m=-1):b[1]===void 0?m=-2:(m=a.lastIndex-b[2].length,h=b[1],a=b[3]===void 0?O:b[3]==='"'?ot:at):a===ot||a===at?a=O:a===st||a===it?a=X:(a=O,s=void 0);let N=a===O&&n[c+1].startsWith("/>")?" ":"";i+=a===X?u+Ot:m>=0?(r.push(h),u.slice(0,m)+ct+u.slice(m)+M+N):u+M+(m===-2?c:N)}return[ht(n,i+(n[e]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),r]},re=class n{constructor({strings:t,_$litType$:e},r){let s;this.parts=[];let i=0,a=0,c=t.length-1,u=this.parts,[h,b]=Wt(t,e);if(this.el=n.createElement(h,r),z.currentNode=this.el.content,e===2||e===3){let m=this.el.content.firstChild;m.replaceWith(...m.childNodes)}for(;(s=z.nextNode())!==null&&u.length<c;){if(s.nodeType===1){if(s.hasAttributes())for(let m of s.getAttributeNames())if(m.endsWith(ct)){let E=b[a++],N=s.getAttribute(m).split(M),ie=/([.?@])?(.*)/.exec(E);u.push({type:1,index:i,name:ie[2],strings:N,ctor:ie[1]==="."?Pe:ie[1]==="?"?Te:ie[1]==="@"?Ae:j}),s.removeAttribute(m)}else m.startsWith(M)&&(u.push({type:6,index:i}),s.removeAttribute(m));if(ut.test(s.tagName)){let m=s.textContent.split(M),E=m.length-1;if(E>0){s.textContent=pe?pe.emptyScript:"";for(let N=0;N<E;N++)s.append(m[N],ee()),z.nextNode(),u.push({type:2,index:++i});s.append(m[E],ee())}}}else if(s.nodeType===8)if(s.data===dt)u.push({type:2,index:i});else{let m=-1;for(;(m=s.data.indexOf(M,m+1))!==-1;)u.push({type:7,index:i}),m+=M.length-1}i++}}static createElement(t,e){let r=W.createElement("template");return r.innerHTML=t,r}};function H(n,t,e=n,r){if(t===q)return t;let s=r!==void 0?e._$Co?.[r]:e._$Cl,i=te(t)?void 0:t._$litDirective$;return s?.constructor!==i&&(s?._$AO?.(!1),i===void 0?s=void 0:(s=new i(n),s._$AT(n,e,r)),r!==void 0?(e._$Co??=[])[r]=s:e._$Cl=s),s!==void 0&&(t=H(n,s._$AS(n,t.values),s,r)),t}var Ee=class{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:e},parts:r}=this._$AD,s=(t?.creationScope??W).importNode(e,!0);z.currentNode=s;let i=z.nextNode(),a=0,c=0,u=r[0];for(;u!==void 0;){if(a===u.index){let h;u.type===2?h=new ne(i,i.nextSibling,this,t):u.type===1?h=new u.ctor(i,u.name,u.strings,this,t):u.type===6&&(h=new Ne(i,this,t)),this._$AV.push(h),u=r[++c]}a!==u?.index&&(i=z.nextNode(),a++)}return z.currentNode=W,s}p(t){let e=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(t,r,e),e+=r.strings.length-2):r._$AI(t[e])),e++}},ne=class n{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,r,s){this.type=2,this._$AH=d,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=r,this.options=s,this._$Cv=s?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,e=this._$AM;return e!==void 0&&t?.nodeType===11&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=H(this,t,e),te(t)?t===d||t==null||t===""?(this._$AH!==d&&this._$AR(),this._$AH=d):t!==this._$AH&&t!==q&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):zt(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==d&&te(this._$AH)?this._$AA.nextSibling.data=t:this.T(W.createTextNode(t)),this._$AH=t}$(t){let{values:e,_$litType$:r}=t,s=typeof r=="number"?this._$AC(t):(r.el===void 0&&(r.el=re.createElement(ht(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===s)this._$AH.p(e);else{let i=new Ee(s,this),a=i.u(this.options);i.p(e),this.T(a),this._$AH=i}}_$AC(t){let e=lt.get(t.strings);return e===void 0&&lt.set(t.strings,e=new re(t)),e}k(t){Me(this._$AH)||(this._$AH=[],this._$AR());let e=this._$AH,r,s=0;for(let i of t)s===e.length?e.push(r=new n(this.O(ee()),this.O(ee()),this,this.options)):r=e[s],r._$AI(i),s++;s<e.length&&(this._$AR(r&&r._$AB.nextSibling,s),e.length=s)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t!==this._$AB;){let r=rt(t).nextSibling;rt(t).remove(),t=r}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},j=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,r,s,i){this.type=1,this._$AH=d,this._$AN=void 0,this.element=t,this.name=e,this._$AM=s,this.options=i,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=d}_$AI(t,e=this,r,s){let i=this.strings,a=!1;if(i===void 0)t=H(this,t,e,0),a=!te(t)||t!==this._$AH&&t!==q,a&&(this._$AH=t);else{let c=t,u,h;for(t=i[0],u=0;u<i.length-1;u++)h=H(this,c[r+u],e,u),h===q&&(h=this._$AH[u]),a||=!te(h)||h!==this._$AH[u],h===d?t=d:t!==d&&(t+=(h??"")+i[u+1]),this._$AH[u]=h}a&&!s&&this.j(t)}j(t){t===d?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},Pe=class extends j{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===d?void 0:t}},Te=class extends j{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==d)}},Ae=class extends j{constructor(t,e,r,s,i){super(t,e,r,s,i),this.type=5}_$AI(t,e=this){if((t=H(this,t,e,0)??d)===q)return;let r=this._$AH,s=t===d&&r!==d||t.capture!==r.capture||t.once!==r.once||t.passive!==r.passive,i=t!==d&&(r===d||s);s&&this.element.removeEventListener(this.name,this,r),i&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},Ne=class{constructor(t,e,r){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(t){H(this,t)}};var qt=Re.litHtmlPolyfillSupport;qt?.(re,ne),(Re.litHtmlVersions??=[]).push("3.3.3");var pt=(n,t,e)=>{let r=e?.renderBefore??t,s=r._$litPart$;if(s===void 0){let i=e?.renderBefore??null;r._$litPart$=s=new ne(t.insertBefore(ee(),i),i,void 0,e??{})}return s._$AI(n),s};var Ue=globalThis,L=class extends T{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){let e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=pt(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return q}};L._$litElement$=!0,L.finalized=!0,Ue.litElementHydrateSupport?.({LitElement:L});var Dt=Ue.litElementPolyfillSupport;Dt?.({LitElement:L});(Ue.litElementVersions??=[]).push("4.2.2");var x=n=>(t,e)=>{e!==void 0?e.addInitializer(()=>{customElements.define(n,t)}):customElements.define(n,t)};var Ht={attribute:!0,type:String,converter:Z,reflect:!1,hasChanged:he},jt=(n=Ht,t,e)=>{let{kind:r,metadata:s}=e,i=globalThis.litPropertyMetadata.get(s);if(i===void 0&&globalThis.litPropertyMetadata.set(s,i=new Map),r==="setter"&&((n=Object.create(n)).wrapped=!0),i.set(e.name,n),r==="accessor"){let{name:a}=e;return{set(c){let u=t.get.call(this);t.set.call(this,c),this.requestUpdate(a,u,n,!0,c)},init(c){return c!==void 0&&this.C(a,void 0,n,c),c}}}if(r==="setter"){let{name:a}=e;return function(c){let u=this[a];t.call(this,c),this.requestUpdate(a,u,n,!0,c)}}throw Error("Unsupported decorator location: "+r)};function g(n){return(t,e)=>typeof e=="object"?jt(n,t,e):((r,s,i)=>{let a=s.hasOwnProperty(i);return s.constructor.createProperty(i,r),a?Object.getOwnPropertyDescriptor(s,i):void 0})(n,t,e)}function p(n){return g({...n,state:!0,attribute:!1})}var f=class extends L{constructor(){super(...arguments);this.error=null;this.busy=!1}#r;connectedCallback(){super.connectedCallback(),this.#r=xe(()=>this.onSessionChange())}disconnectedCallback(){this.#r?.(),super.disconnectedCallback()}onSessionChange(){this.requestUpdate()}get sdk(){return Ye(this.client,this.baseUrl)}get sdkOrNull(){try{return this.sdk}catch{return null}}async run(e){this.error=null,this.busy=!0;try{return await e()}catch(r){if(r instanceof Error&&r.name==="AbortError")return;this.error=Gt(r);return}finally{this.busy=!1}}emit(e,r){this.dispatchEvent(new CustomEvent(e,{detail:r,bubbles:!0,composed:!0}))}static{this.baseStyles=w`
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
  `}};l([g({type:String,attribute:"base-url"})],f.prototype,"baseUrl",2),l([g({attribute:!1})],f.prototype,"client",2),l([p()],f.prototype,"error",2),l([p()],f.prototype,"busy",2);function Gt(n){if(n instanceof y)switch(n.code){case"unauthorized":return"Please sign in again.";case"insufficient_balance":return n.balance===void 0?"Not enough credits.":`Not enough credits \u2014 you have ${n.balance}.`;case"rate_limited":return"Too many attempts. Please wait a moment and try again.";case"network":return"Could not reach the server. Check your connection.";case"timeout":return"This is taking longer than expected. It may still complete.";default:return n.message}return n instanceof Error?n.message:String(n)}var ft=fe`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.909c1.702-1.567 2.683-3.874 2.683-6.614z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.181l-2.909-2.258c-.806.54-1.837.859-3.047.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.582C13.463.892 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>`,Ie=fe`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g fill="#627EEA"><path d="M12 1.5 5.75 12.02 12 15.73V1.5z" opacity=".55"/><path d="M12 1.5v14.23l6.25-3.71L12 1.5z" opacity=".85"/><path d="M12 17.06 5.75 13.35 12 22.5v-5.44z" opacity=".55"/><path d="M12 22.5v-5.44l6.25-3.71L12 22.5z" opacity=".85"/></g></svg>`,mt=fe`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="#9C59FF" d="M3 23.9C2.7 23.6 2.8 22.7 3.3 22.1C3.4 21.9 3.4 21.9 3.2 21.9C3 22 2.9 21.9 2.9 21.6C3 21.3 3.4 21 3.9 20.9C4.4 20.8 4.4 20.8 5.2 19.5C5.7 18.9 6.3 18.1 6.5 17.7C6.9 17.2 7 17 7.1 16.8C7.2 16.3 7.4 16 7.9 15.8C8.5 15.6 10.4 13.8 10.2 13.6C10.2 13.6 10 13.6 9.7 13.5C8.7 13.3 7.5 12.8 6.9 12.4C6.6 12.2 6.6 12.2 6.4 12.2C5.6 12.3 4.9 12.5 4.4 12.8C3.8 13.1 3.8 13.2 3.7 13.1C3.6 13 3.6 12.4 3.8 12C3.8 11.9 3.8 11.9 3.7 11.9C3.6 11.9 3.4 12 3.1 12.3C2.7 12.8 2.6 12.8 2.5 12.6C2.3 12.4 2.4 12.1 2.5 11.7C2.6 11.2 2.6 11.2 2.5 11.2C2.4 11.3 2.2 11.4 2 11.4C1.6 11.6 1.5 11.6 1.5 11.4C1.5 10.7 2.3 9.7 3 9.3C3.7 8.9 4.9 8.8 5.2 9C5.3 9.1 5.6 9.2 5.6 9.2C5.6 9.2 5.6 9.1 5.5 9C5.4 8.8 5.4 8.6 5.5 8.6C5.5 8.6 5.9 8.6 6.3 8.6C7.6 8.6 8.1 8.4 9.4 7.8C10.9 7.1 11.1 7 11.7 6.8C12.5 6.5 12.9 6.4 13.9 6.4C15.4 6.3 16 6.5 17.4 7.3C18 7.7 18.1 7.7 18.4 7.6C18.7 7.6 18.8 7.6 19.1 7.6C19.7 7.7 20 7.7 20.4 7.5C21.1 7.1 21.4 6.5 21.3 5.7C21.3 5 21.1 4.7 20.2 4.1C19.1 3.2 18.7 2.5 18.7 1.5C18.7 0.9 18.8 0.6 19.1 0.3C19.5 -0.1 19.9 -0.1 20.6 0.4C21 0.6 21.2 0.7 21.8 0.9C22.6 1.2 22.7 1.2 22.2 1.3C21.8 1.3 21.8 1.3 22.1 1.4C22.7 1.6 22.6 1.7 21.7 1.7C21.1 1.7 20.9 1.7 20.6 1.8C20.1 1.9 20 2 20.1 2.2C20.1 2.5 20.2 2.6 20.9 3.1C22.1 4.1 22.5 4.8 22.5 6C22.4 7.5 21.5 8.7 19.8 9.8C19.2 10.1 19.2 10.1 19.2 10.7C19.2 11.9 19 12.5 18.3 13.1C17.5 13.7 16.6 13.9 15.1 14L14.3 14L14.2 14.2C14.1 14.2 14.1 14.3 14.1 14.4C14.1 14.4 13.8 14.6 13.5 14.8C13.2 15 12.6 15.8 12.9 15.7C12.9 15.7 13.4 15.5 14 15.3C17 14.4 16.7 14.5 17.2 14.5C17.8 14.5 17.8 14.5 18.4 15.4C19 16.3 19.1 16.5 19 16.6C19 16.8 18.5 16.6 18 16.1C17.7 15.8 17.6 15.8 17.7 16.1C17.7 16.4 17.6 16.5 17.4 16.4C17.3 16.3 17.2 16.2 17.1 15.8L17.1 15.5L16.9 15.5C16.6 15.5 16.6 15.5 14.5 16.2C13.3 16.6 12.9 16.7 12.7 16.9C12 17.2 11.5 17 11.5 16.3C11.5 16.1 11.9 14.9 12.1 14.8C12.1 14.8 12.3 14.4 12.2 14.4C12.2 14.4 11.9 14.5 11.6 14.6L11 14.8L10 15.6C9 16.4 9 16.4 8.9 16.6C8.8 17 8.5 17.3 8.1 17.4C7.9 17.5 7.8 17.7 6.9 18.8C5.9 20.1 5.3 20.9 4.9 21.6C4.8 21.8 4.5 22.1 4.3 22.4C3.7 22.9 3.6 23.1 3.3 23.6C3.1 24 3.1 24 3 23.9Z"/></svg>`;var v=class extends Error{constructor(t){super(t),this.name="WalletError"}};function bt(){return typeof window>"u"?[]:[{where:"window.nostr",provider:window.nostr},{where:"window.okxwallet.nostr",provider:window.okxwallet?.nostr}]}function Ft(n){let t=n;return!!t&&typeof t.getPublicKey=="function"&&typeof t.signEvent=="function"}function Oe(){for(let{provider:n}of bt())if(Ft(n))return n;return null}async function ge(n=2e3){let t=Date.now()+n;for(;;){let e=Oe();if(e)return e;let r=t-Date.now();if(r<=0)return null;await new Promise(s=>setTimeout(s,Math.min(100,r)))}}function ze(){return bt().map(n=>n.where)}function We(n){if(!n)return"wallet";let t=n;return t.isOkxWallet?"OKX Wallet":t.isCoinbaseWallet?"Coinbase Wallet":t.isMetaMask?"MetaMask":"wallet"}function qe(){if(typeof window>"u")return null;for(let n of[window.ethereum,window.okxwallet])if(n&&typeof n.request=="function")return n;return null}function Bt(){if(typeof window>"u")return[];let n=new Set,t=[];for(let e of[window.ethereum,window.okxwallet])!e||typeof e.request!="function"||n.has(e)||(n.add(e),t.push({name:We(e),provider:e}));return t}async function be(){if(typeof window>"u")return[];let n=new Map,t=e=>{let r=e.detail,s=r?.provider,i=r?.info;if(!s||typeof s.request!="function")return;let a=i?.uuid??i?.name??String(n.size);n.has(a)||n.set(a,{name:i?.name??We(s),provider:s})};return window.addEventListener("eip6963:announceProvider",t),window.dispatchEvent(new Event("eip6963:requestProvider")),await new Promise(e=>setTimeout(e,0)),window.removeEventListener("eip6963:announceProvider",t),n.size>0?[...n.values()]:Bt()}function Vt(){return qe()!==null}function Kt(){return Oe()!==null}function Jt(){let n=[];return Vt()&&n.push("eip155"),Kt()&&n.push("nostr"),n}async function De(n,t){let e;try{e=JSON.parse(n)}catch{throw new v("server sent an unreadable Nostr challenge")}let{nip19:r,finalizeEvent:s}=await import("./esm-ZDSEP2UJ.js"),i;try{let a=r.decode(t.trim());if(a.type!=="nsec")throw new v(`that is an ${a.type} key \u2014 sign-in needs the secret key, which starts with nsec1`);i=a.data}catch(a){throw a instanceof v?a:new v("that does not look like a valid nsec1\u2026 key")}try{let a=s({kind:e.kind,content:e.content,tags:e.tags,created_at:e.created_at??Math.floor(Date.now()/1e3)},i);return{type:"nostr_event",event:JSON.stringify(a)}}finally{i.fill(0)}}async function G(n){let t=n??qe();if(!t)throw new v("no Ethereum wallet found in this browser");let e=We(t);try{let i=await t.request({method:"eth_accounts"}),a=Array.isArray(i)?i[0]:void 0;if(typeof a=="string"&&a)return a}catch{}let r;try{r=await t.request({method:"eth_requestAccounts"})}catch(i){throw new v(je(i,`${e} rejected the connection`))}let s=Array.isArray(r)?r[0]:void 0;if(typeof s!="string"||!s)throw new v("wallet returned no accounts");return s}async function F(n,t,e){let r=e??qe();if(!r)throw new v("no Ethereum wallet found in this browser");try{let s=await r.request({method:"personal_sign",params:[n,t]});if(typeof s!="string")throw new v("wallet returned no signature");return{type:"signature",signature:s}}catch(s){throw s instanceof v?s:new v(je(s,"signature was rejected"))}}async function B(n){let t=await ge();if(!t)throw new v(`no Nostr signer answered (looked at ${ze().join(", ")})`);let e;try{e=JSON.parse(n)}catch{throw new v("server sent an unreadable Nostr challenge")}e.created_at??=Math.floor(Date.now()/1e3);try{let r=await t.signEvent(e);return{type:"nostr_event",event:JSON.stringify(r)}}catch(r){throw new v(je(r,"signing was rejected"))}}var Yt=6e4;async function He(n,t,e={}){let r;try{r=JSON.parse(n)}catch{throw new v("server sent an unreadable Nostr challenge")}let[{BunkerSigner:s,parseBunkerInput:i},{generateSecretKey:a}]=await Promise.all([import("./nip46-PMGLFUAT.js"),import("./pure-F6KPRDZ5.js")]),c=await i(t.trim()).catch(()=>null);if(!c)throw new v("that is not a bunker:// address or a NIP-05 name \u2014 copy the connection string from your signer app");let u=s.fromBunker(a(),c,{onauth:h=>e.onAuthUrl?.(h)});try{let h=await Qt((async()=>(await u.connect(),u.signEvent({kind:r.kind,content:r.content,tags:r.tags,created_at:r.created_at??Math.floor(Date.now()/1e3)})))(),e.timeoutMs??Yt,"the signer did not respond \u2014 check it is running and try again");return{type:"nostr_event",event:JSON.stringify(h)}}catch(h){throw h instanceof v?h:new v(h instanceof Error?h.message:"the remote signer refused")}finally{await u.close().catch(()=>{})}}function Qt(n,t,e){return new Promise((r,s)=>{let i=setTimeout(()=>s(new v(e)),t);n.then(a=>{clearTimeout(i),r(a)},a=>{clearTimeout(i),s(a)})})}function je(n,t){if(n==null)return t;if(typeof n=="string")return gt(n)?t:n;if(typeof n=="object"){let r=n;if(r.code===4001)return t;if(r.code===-32002)return"Your wallet already has a request waiting. Open the wallet, finish or dismiss it, then try again.";let s=r.message??r.reason;if(s)return gt(s)?t:s;if(r.code!==void 0)return`${t} (code ${r.code})`}let e=String(n);return e&&e!=="[object Object]"?e:t}function gt(n){return/\b(reject|denied|declin|cancel)/i.test(n)}var k=class extends f{constructor(){super(...arguments);this.me=null;this.enabled=null;this.signerTimeout=2e3;this.variant="inline";this.heading="Sign in to OpenApps";this.description="One account for every app in the suite. Optional \u2014 the apps work without it.";this.mark="O";this.wallets=null;this.nostrFallback="none";this.nostrHint=null;this.authUrl=null}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){let e=await this.run(()=>this.sdk.auth.completeRedirect());if(e&&(R(),this.emit("openapps-login",e),$()),this.enabled||(this.enabled=await this.run(()=>this.sdk.auth.methods())??null),!this.sdk.isLoggedIn){this.me=null;return}this.me=await this.run(()=>this.sdk.auth.me())??null}async beginWalletLogin(){let e=await be();if(e.length>1){this.wallets=e;return}await this.loginWithWallet(e[0])}async loginWithWallet(e){this.wallets=null,await this.run(async()=>{let r=await G(e?.provider),s=await this.sdk.auth.challenge("eip155",r),i=await F(s.message,r,e?.provider),a=await this.sdk.auth.verify(s.challenge_id,i,{referralCode:se()});R(),this.emit("openapps-login",a),$()})}async loginWithNostr(){if(!await ge(this.signerTimeout)){this.nostrFallback="bunker",this.nostrHint=`No signer extension answered. Checked ${ze().join(" and ")}. On a phone, or without an extension, connect a remote signer below.`;return}await this.run(async()=>{let e=await this.sdk.auth.challenge("nostr"),r=await B(e.message),s=await this.sdk.auth.verify(e.challenge_id,r,{referralCode:se()});R(),this.emit("openapps-login",s),$()})}async loginWithBunker(e){e.preventDefault();let s=this.renderRoot.querySelector("#bunker")?.value.trim()??"";s&&(this.authUrl=null,await this.run(async()=>{let i=await this.sdk.auth.challenge("nostr"),a=await He(i.message,s,{onAuthUrl:u=>{this.authUrl=u}}),c=await this.sdk.auth.verify(i.challenge_id,a,{referralCode:se()});this.nostrFallback="none",this.authUrl=null,R(),this.emit("openapps-login",c),$()}))}async loginWithNsec(e){e.preventDefault();let r=this.renderRoot.querySelector("#nsec"),s=r?.value.trim()??"";s&&await this.run(async()=>{try{let i=await this.sdk.auth.challenge("nostr"),a=await De(i.message,s),c=await this.sdk.auth.verify(i.challenge_id,a,{referralCode:se()});this.nostrFallback="none",R(),this.emit("openapps-login",c),$()}finally{r&&(r.value="")}})}loginWithGoogle(){let e=`${location.origin}${location.pathname}${location.search}`;window.location.href=this.sdk.auth.googleStartUrl(e,se())}async logout(){await this.run(()=>this.sdk.auth.logout()),this.me=null,this.emit("openapps-logout",null),$()}render(){if(this.me)return this.renderSignedIn(this.me);let e=this.enabled?.google??!1,r=this.enabled?.eip155??!1,s=this.enabled?.nostr??!1;if(this.enabled&&!e&&!r&&!s)return this.frame(o`
        <p class="muted">This server has no login methods configured.</p>
        ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
      `);let i=this.variant==="panel"?"block":"";return this.frame(o`
      <div class="stack">
        ${e?o`<button
              class="provider ${i}"
              ?disabled=${this.busy}
              @click=${this.loginWithGoogle}
            >
              ${ft}<span>Continue with Google</span>
            </button>`:d}
        ${r&&this.wallets?this.wallets.map(a=>o`<button
                class="provider ${i}"
                ?disabled=${this.busy}
                @click=${()=>this.loginWithWallet(a)}
              >
                ${Ie}<span>Continue with ${a.name}</span>
              </button>`):r?o`<button
                class="provider ${i}"
                ?disabled=${this.busy}
                @click=${()=>this.beginWalletLogin()}
              >
                ${Ie}<span>Continue with a wallet</span>
              </button>`:d}
        ${s?o`
              <button
                class="provider ${i}"
                ?disabled=${this.busy}
                @click=${this.loginWithNostr}
              >
                ${mt}<span>Continue with Nostr</span>
              </button>
              ${this.renderNostrFallback()}
            `:d}
        ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
      </div>
    `)}frame(e){return this.variant!=="panel"?e:o`
      <div class="panel">
        <div class="head">
          <span class="mark" aria-hidden="true">${this.mark}</span>
          <h1 class="title">${this.heading}</h1>
          ${this.description?o`<p class="desc">${this.description}</p>`:d}
        </div>
        <div class="body">${e}</div>
      </div>
    `}renderNostrFallback(){return this.nostrFallback==="bunker"?this.renderBunkerForm():this.nostrFallback==="nsec"?this.renderNsecForm():o`
      <button
        class="link"
        ?disabled=${this.busy}
        @click=${()=>{this.nostrFallback="bunker",this.nostrHint=null}}
      >
        No extension? Use a remote signer
      </button>
    `}renderBunkerForm(){return o`
      <form class="nsec" @submit=${this.loginWithBunker}>
        ${this.nostrHint?o`<p class="muted small">${this.nostrHint}</p>`:d}
        <p class="muted small">
          Paste the connection string from your signer — Amber, nsec.app, or your
          own bunker. It looks like <code>bunker://…</code>, or you can use a
          NIP-05 name. <strong>Your key never leaves the signer</strong>; only the
          request to sign travels, and you approve it there.
        </p>
        <div class="field">
          <label for="bunker">Remote signer</label>
          <input
            id="bunker"
            type="text"
            placeholder="bunker://… or you@example.com"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ?disabled=${this.busy}
          />
          <span class="hint">
            A bunker URI, or the NIP-05 address your signer is reachable at.
          </span>
        </div>
        ${this.authUrl?o`<p class="muted small">
              Your signer needs approval:
              <a href=${this.authUrl} target="_blank" rel="noreferrer noopener"
                >open it</a
              >, then come back.
            </p>`:d}
        <div class="row">
          <button class="primary" type="submit" ?disabled=${this.busy}>
            ${this.busy?"Waiting for your signer\u2026":"Connect signer"}
          </button>
          <button
            type="button"
            ?disabled=${this.busy}
            @click=${()=>this.nostrFallback="none"}
          >
            Cancel
          </button>
        </div>
        <button
          class="link"
          type="button"
          ?disabled=${this.busy}
          @click=${()=>{this.nostrFallback="nsec",this.nostrHint=null}}
        >
          I only have a private key
        </button>
      </form>
    `}renderNsecForm(){return o`
      <form class="nsec" @submit=${this.loginWithNsec}>
        ${this.nostrHint?o`<p class="muted small">${this.nostrHint}</p>`:d}
        <p class="warn">
          <strong>Only do this on a key you can afford to lose.</strong>
          An <code>nsec</code> is your whole Nostr identity — it cannot be changed
          without abandoning the account, and any script on this page can read it
          while you paste it. A signer extension exists so a website never sees
          your key.
        </p>
        <div class="field">
          <label for="nsec">Secret key</label>
          <input
            id="nsec"
            type="password"
            placeholder="nsec1…"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ?disabled=${this.busy}
          />
        </div>
        <p class="muted small">
          The key is used in this browser to sign one message. It is not sent to
          the server and not saved anywhere.
        </p>
        <div class="row">
          <button class="primary" type="submit" ?disabled=${this.busy}>
            Sign in
          </button>
          <button type="button" ?disabled=${this.busy} @click=${()=>this.nostrFallback="none"}>
            Cancel
          </button>
        </div>
      </form>
    `}renderSignedIn(e){let r=e.display_name??e.linked_accounts[0]?.caip10??e.id;return o`
      <div class="row">
        <span class="identity" title=${r}>${Zt(r)}</span>
        <button ?disabled=${this.busy} @click=${this.logout}>Sign out</button>
      </div>
      ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `}};k.styles=[f.baseStyles,w`
      /* Mark on the left, label centred in the space that remains — so the
         three labels line up with each other rather than each sitting a
         different distance from its own icon. */
      button.provider {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
      }
      button.provider svg {
        flex: none;
      }
      button.provider.block span {
        flex: 1;
        text-align: center;
        /* Balance the mark so the label is centred on the button, not on
           the space beside the mark. */
        margin-right: 26px;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.75em;
      }
      .identity {
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button.link {
        border: none;
        background: none;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        padding: 0.1em 0;
        font-size: 0.85em;
        text-align: left;
      }
      .nsec {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: 0.8em;
      }
      /* Everything else comes from .field. Only the family is overridden:
         a key is a literal, and mono carries literals. */
      .nsec input {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
      }
      /* Semantic tokens, so a host forcing dark gets the dark warning —
         the hardcoded pair here used its own media query and so ignored
         the host entirely. */
      .warn {
        font-size: 0.8rem;
        margin: 0;
        padding: 0.5em 0.6em;
        border-radius: var(--radius-lg, 12px);
        background: var(--warning-bg, #fef3c7);
        color: var(--warning-fg, #92400e);
      }
      .small {
        font-size: 0.78rem;
      }
      .row {
        display: flex;
        gap: 0.5em;
      }
    `],l([p()],k.prototype,"me",2),l([p()],k.prototype,"enabled",2),l([g({type:Number,attribute:"signer-timeout"})],k.prototype,"signerTimeout",2),l([g({type:String})],k.prototype,"variant",2),l([g({type:String})],k.prototype,"heading",2),l([g({type:String})],k.prototype,"description",2),l([g({type:String})],k.prototype,"mark",2),l([p()],k.prototype,"wallets",2),l([p()],k.prototype,"nostrFallback",2),l([p()],k.prototype,"nostrHint",2),l([p()],k.prototype,"authUrl",2),k=l([x("openapps-login")],k);function Zt(n,t=10,e=6){return n.length<=t+e+1?n:`${n.slice(0,t)}\u2026${n.slice(-e)}`}function se(){return le()??ke()}var Ge={google:"Google",eip155:"Wallet",nostr:"Nostr"},P=class extends f{constructor(){super(...arguments);this.me=null;this.enabled=null;this.pending=null;this.notice=null;this.blocked=null;this.wallets=null}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){if(await Promise.resolve(),this.handleLinkRedirect(),this.enabled||(this.enabled=await this.run(()=>this.sdk.auth.methods())??null),!this.sdk.isLoggedIn){this.me=null;return}this.me=await this.run(()=>this.sdk.auth.me())??null}linked(e){return(this.me?.linked_accounts??[]).some(r=>r.namespace===e)}get connectable(){return["eip155","nostr"].filter(e=>this.enabled?.[e]&&!this.linked(e))}get canConnectGoogle(){return(this.enabled?.google??!1)&&!this.linked("google")}async connectGoogle(e=!1){await this.run(async()=>{let r=`${location.origin}${location.pathname}${location.search}`,s=await this.sdk.auth.googleLinkStart(r,{merge:e});window.location.href=s})}handleLinkRedirect(){let e;try{e=this.sdk.auth.completeLinkRedirect()}catch{return}if(e)switch(e.status){case"linked":this.notice=e.merged?`Accounts combined \u2014 ${e.credits.toLocaleString()} credits moved across.`:"Google connected.",this.emit("openapps-identity-linked",e),$();break;case"conflict":this.pending={namespace:"google",other:{id:"",balance:e.balance}};break;case"blocked":this.blocked=e.message;break;case"error":this.error=e.message;break}}async beginEthereumConnect(){this.blocked=null;let e=await be();if(e.length>1){this.wallets=e;return}await this.connect("eip155",e[0])}async connect(e,r){this.blocked=null,this.wallets=null,await this.run(async()=>{let s=e==="eip155"?await G(r?.provider):void 0,i=await this.sdk.auth.linkChallenge(e,s),a=e==="eip155"?await F(i.message,s,r?.provider):await B(i.message);try{let c=await this.sdk.auth.linkVerify(i.challenge_id,a);this.afterLink(c)}catch(c){if(c instanceof y&&(c.detail?.code==="merge_blocked_by_duplicate_namespace"||c.detail?.code==="namespace_already_linked")){this.blocked=c.message;return}if(c instanceof y&&c.detail?.code==="identity_belongs_to_another_account"){this.pending={namespace:e,other:c.detail.other_account};return}throw c}})}async confirmMerge(){let e=this.pending;if(e){if(e.namespace==="google"){this.pending=null,await this.connectGoogle(!0);return}await this.run(async()=>{let r=e.namespace==="eip155"?await G():void 0,s=await this.sdk.auth.linkChallenge(e.namespace,r),i=e.namespace==="eip155"?await F(s.message,r):await B(s.message),a=await this.sdk.auth.linkVerify(s.challenge_id,i,{merge:!0});this.pending=null,this.afterLink(a)})}}afterLink(e){this.notice=e.merged?`Accounts combined \u2014 ${(e.credits_transferred??0).toLocaleString()} credits moved across.`:"Connected.",this.emit("openapps-identity-linked",e),$(),this.load()}async unlink(e){await this.run(async()=>{await this.sdk.auth.unlink(e),this.notice="Disconnected.",this.emit("openapps-identity-unlinked",{caip10:e}),await this.load()})}render(){if(!this.sdkOrNull)return o`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return o`<p class="muted">Sign in to manage your account.</p>`;if(!this.me)return o`<p class="muted">Loading…</p>`;if(this.pending)return this.renderMergePrompt(this.pending);let e=this.me.linked_accounts;return o`
      <div class="card">
        <div class="head">
          <div>
            <div class="muted small">Account</div>
            <code class="id">${this.me.id}</code>
          </div>
          <div class="right">
            <div class="balance">${this.me.balance.toLocaleString()}</div>
            <div class="muted small">credits</div>
          </div>
        </div>

        <h3>Sign-in methods</h3>
        <ul class="identities">
          ${e.map(r=>o`
              <li>
                <span class="tag">${Ge[r.namespace]??r.namespace}</span>
                <code title=${r.caip10}
                  >${Xt(r.label??r.caip10)}</code
                >
                ${e.length>1?o`<button
                      class="link"
                      ?disabled=${this.busy}
                      @click=${()=>this.unlink(r.caip10)}
                    >
                      Disconnect
                    </button>`:o`<span class="muted small">only method</span>`}
              </li>
            `)}
        </ul>

        ${this.connectable.length||this.canConnectGoogle?o`
              <h3>Add another</h3>
              <div class="row">
                ${this.canConnectGoogle?o`<button ?disabled=${this.busy} @click=${()=>this.connectGoogle()}>
                      Connect Google
                    </button>`:d}
                ${this.connectable.map(r=>r==="eip155"&&this.wallets?this.wallets.map(s=>o`
                          <button ?disabled=${this.busy} @click=${()=>this.connect(r,s)}>
                            Connect ${s.name}
                          </button>
                        `):o`
                        <button
                          ?disabled=${this.busy}
                          @click=${()=>r==="eip155"?this.beginEthereumConnect():this.connect(r)}
                        >
                          Connect ${Ge[r]}
                        </button>
                      `)}
              </div>
              <p class="muted small">
                Connecting a method that is already on another account will offer to
                combine them, so you keep one balance and one history.
              </p>
            `:o`<p class="muted small">Every available method is connected.</p>`}

        ${this.blocked?o`<p class="warn" role="alert">${this.blocked}</p>`:d}
        ${this.notice?o`<p class="notice">${this.notice}</p>`:d}
        ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
      </div>

    `}renderMergePrompt(e){return o`
      <div class="card">
        <h3>Combine two accounts?</h3>
        <p>
          That ${Ge[e.namespace]??e.namespace} identity already
          belongs to another account holding
          <strong>${e.other.balance.toLocaleString()} credits</strong>.
        </p>
        <p class="muted small">
          Combining moves its credits, payment history and referral earnings onto
          this account, and signs it out everywhere. It cannot be undone.
        </p>
        <div class="row">
          <button class="primary" ?disabled=${this.busy} @click=${this.confirmMerge}>
            Combine them
          </button>
          <button ?disabled=${this.busy} @click=${()=>this.pending=null}>
            Cancel
          </button>
        </div>
        ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `}};P.styles=[f.baseStyles,w`
      .card {
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: 1rem 1.1rem;
        background: var(--surface-card, var(--fb-card));
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        border-bottom: 1px solid var(--border-hairline, var(--fb-hairline));
        padding-bottom: 0.75rem;
      }
      .right {
        text-align: right;
      }
      .balance {
        font-size: 1.5rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .id {
        font-size: 0.8rem;
        overflow-wrap: anywhere;
      }
      h3 {
        font-size: 0.9rem;
        margin: 1rem 0 0.5rem;
      }
      .identities {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .identities li {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.9rem;
      }
      .identities code {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tag {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: 999px;
        padding: 0.1em 0.6em;
      }
      button.link {
        border: none;
        background: none;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        padding: 0;
        font-size: 0.85em;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .small {
        font-size: 0.8rem;
      }
      .notice {
        font-size: 0.85rem;
        margin-top: 0.6rem;
      }
      /* Semantic tokens rather than a hardcoded pair with its own media
         query: that combination ignored the host entirely, so a page
         forcing dark kept a bright yellow warning. */
      .warn {
        font-size: 0.85rem;
        margin-top: 0.6rem;
        padding: 0.5em 0.7em;
        border-radius: var(--radius-lg, 12px);
        background: var(--warning-bg, #fef3c7);
        color: var(--warning-fg, #92400e);
      }
    `],l([p()],P.prototype,"me",2),l([p()],P.prototype,"enabled",2),l([p()],P.prototype,"pending",2),l([p()],P.prototype,"notice",2),l([p()],P.prototype,"blocked",2),l([p()],P.prototype,"wallets",2),P=l([x("openapps-account")],P);function Xt(n,t=18,e=8){return n.length<=t+e+1?n:`${n.slice(0,t)}\u2026${n.slice(-e)}`}var V,A=class extends f{constructor(){super(...arguments);this.pollSeconds=0;this.label="Credits";this.balance=null;ae(this,V)}connectedCallback(){super.connectedCallback(),this.refresh(),this.pollSeconds>0&&oe(this,V,setInterval(()=>{this.refresh()},this.pollSeconds*1e3))}disconnectedCallback(){I(this,V)&&clearInterval(I(this,V)),super.disconnectedCallback()}onSessionChange(){this.refresh()}async refresh(){let e=this.sdkOrNull;if(!e?.isLoggedIn){this.balance=null;return}let r=await this.run(()=>e.credits.balance());r!==void 0&&(this.balance=r)}render(){return this.sdkOrNull?this.sdk.isLoggedIn?o`
      <span class="wrap">
        <span class="label muted">${this.label}</span>
        <span class="value" aria-live="polite"
          >${this.balance===null?"\u2026":this.balance.toLocaleString()}</span
        >
      </span>
      ${this.error?o`<span class="error" role="alert">${this.error}</span>`:d}
    `:o`<span class="muted">Not signed in</span>`:o`<span class="muted">…</span>`}};V=new WeakMap,A.styles=[f.baseStyles,w`
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
    `],l([g({type:Number,attribute:"poll-seconds"})],A.prototype,"pollSeconds",2),l([g({type:String})],A.prototype,"label",2),l([p()],A.prototype,"balance",2),A=l([x("openapps-credits")],A);var _=class extends f{constructor(){super(...arguments);this.pageSize=25;this.appId="";this.noSummary=!1;this.entries=[];this.cursor=null;this.complete=!1;this.loaded=!1}connectedCallback(){super.connectedCallback(),this.refresh()}onSessionChange(){this.refresh()}async refresh(){this.entries=[],this.cursor=null,this.complete=!1,this.loaded=!1,await this.loadMore()}async loadMore(){let e=this.sdkOrNull;if(!e?.isLoggedIn){this.loaded=!0;return}let r=await this.run(()=>e.credits.history({cursor:this.cursor??void 0,limit:this.pageSize}));this.loaded=!0,r&&(this.entries=[...this.entries,...r.entries],this.cursor=r.next_cursor,this.complete=r.next_cursor===null)}get visible(){return this.appId?this.entries.filter(e=>e.app_id===this.appId):this.entries}get spending(){let e=new Map;for(let r of this.visible){if(r.amount>=0)continue;let s=Fe(r),i=e.get(s);i?(i.credits+=-r.amount,i.count+=1):e.set(s,{label:s,credits:-r.amount,count:1})}return[...e.values()].sort((r,s)=>s.credits-r.credits)}render(){if(!this.sdkOrNull)return o`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return o`<p class="muted">Sign in to see where your credits went.</p>`;if(!this.loaded)return o`<p class="muted">Loading…</p>`;let e=this.visible;if(e.length===0)return o`
        <p class="muted">
          Nothing yet. Credits you buy and spend both appear here, with what
          each one was for.
        </p>
        ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
      `;let r=this.noSummary?[]:this.spending,s=r.reduce((i,a)=>i+a.credits,0);return o`
      ${r.length?o`
            <div class="summary">
              <div class="eyebrow">
                ${this.complete?"Spent, all time":"Spent, recent activity"}
              </div>
              <ul class="groups">
                ${r.map(i=>o`
                    <li>
                      <span class="what" title=${i.label}>${i.label}</span>
                      <span class="times muted"
                        >${i.count===1?"once":`${i.count}\xD7`}</span
                      >
                      <span class="mono amount">${i.credits.toLocaleString()}</span>
                      <!-- The bar is proportional to the largest row, not to
                           the total: with one dominant item every other bar
                           would round to nothing and the comparison people
                           actually want — this against that — disappears. -->
                      <span
                        class="bar"
                        style=${`--w:${Math.round(i.credits/r[0].credits*100)}%`}
                      ></span>
                    </li>
                  `)}
              </ul>
              <p class="caption">
                ${s.toLocaleString()} credits across ${e.length}
                ${e.length===1?"entry":"entries"}${this.complete?"":" so far"}.
              </p>
            </div>
          `:d}

      <div class="eyebrow rule">Activity</div>
      <ul class="entries">
        ${e.map(i=>o`
            <li>
              <span class="when muted">${er(i.created_at)}</span>
              <span class="what" title=${vt(i)}
                >${vt(i)}</span
              >
              <span class="mono amount ${i.amount<0?"debit":"credit"}">
                ${i.amount>0?"+":"\u2212"}${Math.abs(i.amount).toLocaleString()}
              </span>
              <span class="mono after muted" title="Balance after"
                >${i.balance_after.toLocaleString()}</span
              >
            </li>
          `)}
      </ul>

      ${this.cursor!==null?o`<button
            class="block"
            ?disabled=${this.busy}
            @click=${()=>{this.loadMore()}}
          >
            ${this.busy?"Loading\u2026":"Show earlier"}
          </button>`:d}
      ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `}};_.styles=[f.baseStyles,w`
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
    `],l([g({type:Number,attribute:"page-size"})],_.prototype,"pageSize",2),l([g({type:String,attribute:"app-id"})],_.prototype,"appId",2),l([g({type:Boolean,attribute:"no-summary"})],_.prototype,"noSummary",2),l([p()],_.prototype,"entries",2),l([p()],_.prototype,"cursor",2),l([p()],_.prototype,"complete",2),l([p()],_.prototype,"loaded",2),_=l([x("openapps-history")],_);function Fe(n){let t=n.app_name??n.app_id??null,e=n.ref_id??null;return t&&e?`${t} \xB7 ${e}`:t||e||"Spent"}function vt(n){switch(n.kind){case"debit":return Fe(n);case"topup":return"Credits purchased";case"referral_bonus":return"Referral bonus";case"adjustment":return n.ref_id?`Adjustment \u2014 ${n.ref_id}`:"Adjustment";case"refund":return n.amount<0?"Payment reversed":"Refund";default:return Fe(n)}}function er(n){let t=new Date(n*1e3);return Number.isNaN(t.getTime())?"":t.toLocaleDateString(void 0,{month:"short",day:"numeric"})}function yt(n){return new Date(n*1e3).toLocaleDateString(void 0,{day:"numeric",month:"short"})}var S=class extends f{constructor(){super(...arguments);this.appId="";this.info=null;this.earnings=null;this.referees=null;this.tab="link";this.copied=!1}connectedCallback(){super.connectedCallback(),this.load()}onSessionChange(){this.load()}async load(){let e=this.sdkOrNull;if(!e?.isLoggedIn){this.info=null,this.earnings=null,this.referees=null;return}this.info=await this.run(()=>e.referral.code(this.appId||void 0))??null,this.earnings=await this.run(()=>e.referral.earnings())??null,this.referees=await this.run(()=>e.referral.referees())??null}updated(e){e.has("appId")&&this.load()}get link(){if(this.info?.invite_url)return this.info.invite_url;let e=this.inviteUrl??(typeof location>"u"?"":`${location.origin}${location.pathname}`);if(!this.info)return e;let r=e.includes("?")?"&":"?";return`${e}${r}ref=${encodeURIComponent(this.info.code)}`}async copy(){try{await navigator.clipboard.writeText(this.link),this.copied=!0,setTimeout(()=>this.copied=!1,2e3)}catch{this.error="Could not copy. Select the link and copy it manually."}}render(){if(!this.sdkOrNull)return o`<p class="muted">Loading…</p>`;if(!this.sdk.isLoggedIn)return o`<p class="muted">Sign in to get your invite link.</p>`;if(!this.info)return o`<p class="muted">${this.error??"Loading\u2026"}</p>`;let e=this.referees?.referees??[],r=this.earnings?.entries??[],s=[["link","Your link"],["referees",`Referees${e.length?` (${e.length})`:""}`],["earnings",`Earnings${r.length?` (${r.length})`:""}`]];return o`
      <div class="stack">
        <div class="tabs" role="tablist">
          ${s.map(([i,a])=>o`
              <button
                role="tab"
                aria-selected=${this.tab===i}
                class="tab ${this.tab===i?"on":""}"
                @click=${()=>this.tab=i}
              >
                ${a}
              </button>
            `)}
        </div>
        ${this.tab==="link"?this.renderLink():this.tab==="referees"?this.renderReferees(e):this.renderEarnings(r)}
        ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
      </div>
    `}renderLink(){let e=this.earnings?.total??0,r=this.earnings?.entries.length??0;return o`
      <p class="desc">
        Share this link. When someone signs up through it and buys credits,
        you earn <strong>${this.info?.bonus_percent}%</strong> of what they
        buy, as credits.
      </p>
      <code class="payload">${this.link}</code>
      <div class="row">
        <button @click=${this.copy}>${this.copied?"Copied":"Copy link"}</button>
        <span class="muted mono">${this.info?.code}</span>
      </div>
      <div class="earned">
        <span class="eyebrow">Earned</span>
        <span class="total mono">${e.toLocaleString()}</span>
        <span class="caption">
          ${r===0?"No referred purchases yet.":`credits from ${r} purchase${r===1?"":"s"}`}
        </span>
      </div>
    `}renderReferees(e){return e.length===0?o`<p class="muted">
        Nobody has signed up through your link yet.
      </p>`:o`
      <p class="caption">
        Handles only — signing up through a link does not share someone's
        identity with you.
      </p>
      <div class="list">
        ${e.map(r=>o`
            <div class="item">
              <span class="mono handle">${r.handle}</span>
              <span class="grow caption">
                joined ${yt(r.joined_at)} ·
                ${r.purchases===0?"no purchases yet":`${r.purchases} purchase${r.purchases===1?"":"s"}`}
              </span>
              <span class="mono amount ${r.earned>0?"good":""}">
                ${r.earned>0?`+${r.earned.toLocaleString()}`:"\u2014"}
              </span>
            </div>
          `)}
      </div>
    `}renderEarnings(e){return e.length===0?o`<p class="muted">
        No referral earnings yet. A bonus is credited when a referee's
        purchase settles.
      </p>`:o`
      <p class="caption">
        Each row is one bonus, credited in the same transaction as the
        referee's purchase — so this list and your balance cannot disagree.
      </p>
      <div class="list">
        ${e.map(r=>o`
            <div class="item">
              <span class="mono date">${yt(r.created_at)}</span>
              <span class="grow caption">
                ${r.referee??"unknown"}
                ${r.referee_credits?o` bought ${r.referee_credits.toLocaleString()} credits`:d}
              </span>
              <span class="mono amount good">+${r.amount.toLocaleString()}</span>
            </div>
          `)}
      </div>
    `}};S.styles=[f.baseStyles,w`
      .stack {
        display: grid;
        gap: 12px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .tabs {
        display: flex;
        gap: 4px;
        border-bottom: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      /* Underline tabs sitting on the hairline, with a 2px near-black
         indicator — not a filled pill, and never a coloured bar. The
         indicator is drawn on the tab itself and pulled down over the rule
         so the selected tab reads as continuous with its panel. */
      .tab {
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--text-muted, var(--fb-muted));
        margin-bottom: -1px;
        padding: 0 10px;
      }
      .tab.on {
        border-bottom-color: var(--text-strong, var(--fb-strong));
        color: var(--text-strong, var(--fb-strong));
      }
      .tab:hover:not(.on) {
        color: var(--text-strong, var(--fb-strong));
        background: transparent;
      }
      .list {
        display: grid;
        border: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        overflow: hidden;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
      }
      .item + .item {
        border-top: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .grow {
        flex: 1;
      }
      .date,
      .handle {
        font-size: var(--text-2xs, 11px);
        color: var(--text-faint, var(--fb-faint));
        min-width: 3.4em;
      }
      .amount {
        font-size: var(--text-sm, 13px);
        font-weight: var(--weight-medium, 500);
        color: var(--text-muted, var(--fb-muted));
      }
      .amount.good {
        color: var(--success-fg, #0b8a68);
      }
      .earned {
        display: grid;
        gap: 4px;
        padding: 14px 16px;
        border: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        background: var(--surface-card, var(--fb-card));
      }
      /* A balance is a quantity, so it is mono — same rule as the credit
         badge and the ledger. */
      .total {
        font-size: var(--text-3xl, 40px);
        font-weight: var(--weight-medium, 500);
        line-height: 1;
        letter-spacing: var(--tracking-display, -0.035em);
        color: var(--text-strong, var(--fb-strong));
      }
    `],l([g({type:String,attribute:"app-id"})],S.prototype,"appId",2),l([g({type:String,attribute:"invite-url"})],S.prototype,"inviteUrl",2),l([p()],S.prototype,"info",2),l([p()],S.prototype,"earnings",2),l([p()],S.prototype,"referees",2),l([p()],S.prototype,"tab",2),l([p()],S.prototype,"copied",2),S=l([x("openapps-referral")],S);var U=class extends f{constructor(){super(...arguments);this.label="Sign out";this.signedIn=!1}connectedCallback(){super.connectedCallback(),this.refresh()}refresh(){this.signedIn=this.sdkOrNull?.isLoggedIn??!1}onSessionChange(){this.refresh()}async signOut(){await this.run(()=>this.sdk.auth.logout()),this.signedIn=!1,this.emit("openapps-logout",null),$()}render(){return this.signedIn?o`
      <button ?disabled=${this.busy} @click=${this.signOut}>${this.label}</button>
      ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `:d}};U.styles=[f.baseStyles,w`
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
    `],l([g({type:String})],U.prototype,"label",2),l([p()],U.prototype,"signedIn",2),U=l([x("openapps-signout")],U);var D,C=class extends f{constructor(){super(...arguments);this.rails="";this.returnTo="";this.packages=null;this.selected=null;this.instruction=null;this.topup=null;this.waiting=!1;ae(this,D)}connectedCallback(){super.connectedCallback(),this.load()}disconnectedCallback(){I(this,D)?.abort(),super.disconnectedCallback()}onSessionChange(){if(!this.packages){this.load();return}this.requestUpdate()}async load(){if(!this.sdkOrNull)return;let e=await this.run(()=>this.sdk.payments.packages());e&&(this.packages=e)}get offeredRails(){if(!this.packages)return[];let e=["stripe","ethereum","lightning"].filter(s=>this.packages?.rails?.[s]),r=this.rails.split(",").map(s=>s.trim()).filter(Boolean);return r.length?e.filter(s=>r.includes(s)):e}async start(e){let r=this.selected;r&&await this.run(async()=>{let s;switch(e){case"stripe":{let i=await this.sdk.payments.stripeCheckout(r.id,{returnTo:this.returnTo==="none"?null:this.returnTo||void 0});this.instruction={kind:"redirect"},!this.dispatchEvent(new CustomEvent("openapps-checkout",{detail:{url:i.checkout_url,packageId:r.id},cancelable:!0,bubbles:!0,composed:!0}))||(window.location.href=i.checkout_url);return}case"ethereum":{let i=await this.sdk.payments.ethDepositAddress(r.id);s=i.topup_id,this.instruction={kind:"address",chain:i.chain,address:i.address,amount:i.expected_amount};break}case"lightning":{let i=await this.sdk.payments.lightningInvoice(r.id);s=i.topup_id,this.instruction={kind:"invoice",bolt11:i.bolt11,amountMsat:i.amount_msat};break}}this.watch(s,rr[e])})}async watch(e,r){I(this,D)?.abort();let s=new AbortController;oe(this,D,s),this.waiting=!0;try{let i=await this.sdk.payments.waitFor(e,{timeoutMs:r,signal:s.signal,onPoll:a=>{this.topup=a}});this.topup=i,i.status==="confirmed"&&(this.emit("openapps-topup",i),$())}catch(i){i instanceof Error&&i.name==="AbortError"||(this.error=ar(i))}finally{this.waiting=!1}}reset(){I(this,D)?.abort(),this.selected=null,this.instruction=null,this.topup=null,this.error=null}render(){return this.sdkOrNull?this.sdk.isLoggedIn?this.packages?this.instruction?this.renderInstruction(this.instruction):this.selected?this.renderRails(this.selected):this.renderPackages(this.packages.packages??[]):o`<p class="muted">${this.error??"Loading packages\u2026"}</p>`:o`<p class="muted">Sign in to buy credits.</p>`:o`<p class="muted">Loading…</p>`}renderPackages(e){return e.length===0?o`<p class="muted">No credit packages are configured.</p>`:o`
      <div class="grid">
        ${e.map(r=>o`
            <button class="package" @click=${()=>this.selected=r}>
              <span class="credits">
                ${r.credits.toLocaleString()} credits
              </span>
              <span class="perunit caption">${sr(r)}</span>
              <span class="price">${wt(r.usd_price)}</span>
            </button>
          `)}
      </div>
      ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `}renderRails(e){let r=this.offeredRails;return o`
      <p>
        <strong>${e.credits.toLocaleString()} credits</strong> —
        ${wt(e.usd_price)}
      </p>
      <div class="stack">
        ${r.map(s=>o`
            <button class="primary" ?disabled=${this.busy} @click=${()=>this.start(s)}>
              ${tr[s]}
            </button>
          `)}
        ${r.length===0?o`<p class="muted">No payment methods are enabled.</p>`:d}
        <button @click=${this.reset}>Back</button>
      </div>
      ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `}renderInstruction(e){let r=this.topup?.status??"pending";return r==="confirmed"?o`
        <span class="badge success"><span class="dot"></span>Confirmed</span>
        <p class="ok">Payment confirmed — credits added.</p>
        <button @click=${this.reset}>Buy more</button>
      `:r==="failed"||r==="expired"?o`
        <span class="badge danger"><span class="dot"></span>${r==="failed"?"Failed":"Expired"}</span>
        <p class="error" role="alert">This top-up ${r}. Nothing was charged.</p>
        <button @click=${this.reset}>Try again</button>
      `:o`
      ${e.kind==="redirect"?o`<p class="muted">Redirecting to checkout…</p>`:d}
      ${e.kind==="address"?o`
            <p>Send exactly <strong>${ir(e.amount,6)}</strong> USDC or
            USDT on <code>${e.chain}</code> to:</p>
            <code class="payload">${e.address}</code>
          `:d}
      ${e.kind==="invoice"?o`
            <p>Pay this Lightning invoice
            (<strong>${Math.ceil(e.amountMsat/1e3).toLocaleString()} sats</strong>):</p>
            <code class="payload">${e.bolt11}</code>
          `:d}
      ${e.kind!=="redirect"?o`
            <div class="row">
              <button @click=${()=>this.copy(nr(e))}>Copy</button>
              <button @click=${this.reset}>Cancel</button>
            </div>
            ${this.renderWaiting()}
          `:d}
      ${this.error?o`<p class="error" role="alert">${this.error}</p>`:d}
    `}renderWaiting(){if(!this.waiting)return o`<p class="muted" aria-live="polite">Not watching for payment.</p>`;let e=this.topup?.confirmations;if(e===void 0)return o`<p class="muted" aria-live="polite">Waiting for payment…</p>`;let r=this.topup?.confirmations_required;if(r==null)return o`
        <p class="muted" aria-live="polite">
          Payment received — waiting for the network to finalise it.
        </p>
      `;let s=Math.min(e,r);return o`
      <p class="muted" aria-live="polite">
        Payment received — confirming (${s} of ${r}).
      </p>
      <progress
        class="confirms"
        max=${r}
        value=${s}
        aria-label="Confirmations"
      ></progress>
    `}async copy(e){try{await navigator.clipboard.writeText(e)}catch{this.error="Could not copy \u2014 select the text and copy it manually."}}};D=new WeakMap,C.styles=[f.baseStyles,w`
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
    `],l([g({type:String})],C.prototype,"rails",2),l([g({type:String,attribute:"return-to"})],C.prototype,"returnTo",2),l([p()],C.prototype,"packages",2),l([p()],C.prototype,"selected",2),l([p()],C.prototype,"instruction",2),l([p()],C.prototype,"topup",2),l([p()],C.prototype,"waiting",2),C=l([x("openapps-buy")],C);var tr={stripe:"Pay by card",ethereum:"Pay with USDC / USDT",lightning:"Pay with Lightning"},rr={stripe:void 0,lightning:void 0,ethereum:1800*1e3};function nr(n){return n.kind==="address"?n.address:n.kind==="invoice"?n.bolt11:""}function wt(n){return`$${(n/100).toFixed(2)}`}function sr(n){if(n.credits<=0)return"";let t=n.usd_price/n.credits;return`${t<1?t.toFixed(2):t.toFixed(1)}\xA2 each`}function ir(n,t){let e=10**t;return(n/e).toFixed(t).replace(/\.?0+$/,"")}function ar(n){let t=n instanceof Error?n.message:String(n);return t.includes("still pending")?"Still waiting on the network. Your credits will appear once the payment settles.":t}export{P as OpenAppsAccount,C as OpenAppsBuy,A as OpenAppsCredits,f as OpenAppsElement,_ as OpenAppsHistory,k as OpenAppsLogin,S as OpenAppsReferral,U as OpenAppsSignout,v as WalletError,Jt as availableNamespaces,we as captureReferral,R as clearReferral,Je as configure,G as connectEthereum,Oe as findNostrProvider,Pt as getClient,$ as notify,xe as onChange,le as referralInUrl,B as signNostr,He as signNostrWithBunker,De as signNostrWithSecretKey,F as signSiwe,ke as storedReferral,ge as waitForNostrProvider};
//# sourceMappingURL=openapps-ui.js.map
