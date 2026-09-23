import{j as s}from"./vendor-query-B0cgLqZO.js";import{c as a,g as x,a3 as d,T as l,C as u,ah as y,ai as E}from"./index-1sYK0Imv.js";import{u as o}from"./vendor-i18n-pD3589dJ.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=a("CircleDot",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=a("CirclePause",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=a("Clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=a("Wrench",[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",key:"cbrjhi"}]]),T={neutral:"bg-muted text-muted-foreground border-border",success:"bg-success-muted text-success border-success/35",warning:"bg-warning-muted text-warning border-warning/35",danger:"bg-destructive-muted text-destructive border-destructive/35",info:"bg-info-muted text-info border-info/35",primary:"bg-primary-muted text-primary border-primary/35"};function i({tone:n="neutral",icon:e,children:c,className:t,size:r="md"}){return s.jsxs("span",{className:x("inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold",r==="sm"?"px-2 py-0.5 text-xs":"px-2.5 py-1 text-xs",T[n],t),children:[e&&s.jsx(e,{className:"size-3.5 shrink-0","aria-hidden":!0}),s.jsx("span",{className:"truncate",children:c})]})}const N={AVAILABLE:{tone:"success",icon:u},ON_TRIP:{tone:"info",icon:f},MAINTENANCE:{tone:"warning",icon:p},OUT_OF_SERVICE:{tone:"danger",icon:d}};function _({status:n,className:e}){const{t:c}=o(),{tone:t,icon:r}=N[n];return s.jsx(i,{tone:t,icon:r,className:e,children:c(`status.bus.${n}`)})}const C={DRAFT:{tone:"neutral",icon:m},STARTED:{tone:"info",icon:I},COMPLETED:{tone:"success",icon:u},REVIEW_REQUIRED:{tone:"warning",icon:l},CANCELLED:{tone:"neutral",icon:d}};function j({status:n,className:e}){const{t:c}=o(),{tone:t,icon:r}=C[n];return s.jsx(i,{tone:t,icon:r,className:e,children:c(`status.trip.${n}`)})}function k({status:n}){const{t:e}=o();return s.jsx(i,{tone:n==="ACTIVE"?"success":"neutral",icon:n==="ACTIVE"?u:m,size:"sm",children:e(`status.employment.${n}`)})}const h={HIGH:{tone:"danger",icon:E},MEDIUM:{tone:"warning",icon:l},LOW:{tone:"info",icon:y}};function D({severity:n,className:e,size:c="md"}){const{t}=o(),{tone:r,icon:g}=h[n];return s.jsxs(i,{tone:r,icon:g,className:e,size:c,children:[s.jsx("span",{className:"sr-only",children:t("a11y.severityIcon",{severity:t(`status.severity.${n}`)})}),s.jsx("span",{"aria-hidden":!0,children:t(`status.severity.${n}`)})]})}const O={OPEN:"warning",IN_REVIEW:"info",REVIEWED_OK:"success",NEEDS_INVESTIGATION:"danger",FALSE_POSITIVE:"neutral",READING_ERROR:"neutral"};function w({status:n}){const{t:e}=o();return s.jsx(i,{tone:O[n],size:"sm",children:e(`status.review.${n}`)})}const R={HIGH:{tone:"success",icon:u},MEDIUM:{tone:"warning",icon:l},LOW:{tone:"danger",icon:E}};function B({band:n,size:e="sm"}){const{t:c}=o(),{tone:t,icon:r}=R[n];return s.jsx(i,{tone:t,icon:r,size:e,children:c(`status.confidence.${n}`)})}export{D as A,i as B,I as C,k as E,w as R,j as T,_ as a,B as b};
//# sourceMappingURL=StatusBadge-Bi8A501e.js.map
