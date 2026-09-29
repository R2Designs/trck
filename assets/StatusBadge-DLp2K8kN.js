import{j as t}from"./vendor-query-B0cgLqZO.js";import{c as a,g as E,a2 as x,C as u,ah as g,T as l,ai as d}from"./index-BQm_uyMC.js";import{u as o}from"./vendor-i18n-pD3589dJ.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=a("CircleDot",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=a("CirclePause",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=a("Wrench",[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",key:"cbrjhi"}]]),p={neutral:"bg-muted text-muted-foreground border-border",success:"bg-success-muted text-success border-success/35",warning:"bg-warning-muted text-warning border-warning/35",danger:"bg-destructive-muted text-destructive border-destructive/35",info:"bg-info-muted text-info border-info/35",primary:"bg-primary-muted text-primary border-primary/35"};function i({tone:e="neutral",icon:n,children:r,className:s,size:c="md"}){return t.jsxs("span",{className:E("inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold",c==="sm"?"px-2 py-0.5 text-xs":"px-2.5 py-1 text-xs",p[e],s),children:[n&&t.jsx(n,{className:"size-3.5 shrink-0","aria-hidden":!0}),t.jsx("span",{className:"truncate",children:r})]})}const N={AVAILABLE:{tone:"success",icon:u},ON_TRIP:{tone:"info",icon:y},MAINTENANCE:{tone:"warning",icon:I},OUT_OF_SERVICE:{tone:"danger",icon:x}};function j({status:e,className:n}){const{t:r}=o(),{tone:s,icon:c}=N[e];return t.jsx(i,{tone:s,icon:c,className:n,children:r(`status.bus.${e}`)})}function R({status:e}){const{t:n}=o();return t.jsx(i,{tone:e==="ACTIVE"?"success":"neutral",icon:e==="ACTIVE"?u:f,size:"sm",children:n(`status.employment.${e}`)})}const h={HIGH:{tone:"danger",icon:d},MEDIUM:{tone:"warning",icon:l},LOW:{tone:"info",icon:g}};function S({severity:e,className:n,size:r="md"}){const{t:s}=o(),{tone:c,icon:m}=h[e];return t.jsxs(i,{tone:c,icon:m,className:n,size:r,children:[t.jsx("span",{className:"sr-only",children:s("a11y.severityIcon",{severity:s(`status.severity.${e}`)})}),t.jsx("span",{"aria-hidden":!0,children:s(`status.severity.${e}`)})]})}const C={OPEN:"warning",IN_REVIEW:"info",REVIEWED_OK:"success",NEEDS_INVESTIGATION:"danger",FALSE_POSITIVE:"neutral",READING_ERROR:"neutral"};function _({status:e}){const{t:n}=o();return t.jsx(i,{tone:C[e],size:"sm",children:n(`status.review.${e}`)})}const O={HIGH:{tone:"success",icon:u},MEDIUM:{tone:"warning",icon:l},LOW:{tone:"danger",icon:d}};function w({band:e,size:n="sm"}){const{t:r}=o(),{tone:s,icon:c}=O[e];return t.jsx(i,{tone:s,icon:c,size:n,children:r(`status.confidence.${e}`)})}export{S as A,i as B,w as C,R as E,_ as R,j as a};
//# sourceMappingURL=StatusBadge-DLp2K8kN.js.map
