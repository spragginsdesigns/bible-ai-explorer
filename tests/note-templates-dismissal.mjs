import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = ts.transpileModule(readFileSync("mobile/src/features/notes/components/CreateItemSheet.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
function harness(platform = "android") {
 const slots = []; let cursor = 0; let effects = []; let userId = "owner-a"; let focus; let visible = true; let actions = 0; const order = [];
 const same = (a,b) => a && b && a.length === b.length && a.every((x,i) => Object.is(x,b[i]));
 const react = {
  useRef(initial) { const i=cursor++; return slots[i] ??= {current:initial}; },
  useState(initial) { const i=cursor++; slots[i] ??= {value:initial}; return [slots[i].value, value=>{slots[i].value=value;}]; },
  useCallback(fn,deps) { const i=cursor++; if (!slots[i] || !same(slots[i].deps,deps)) slots[i]={value:fn,deps}; return slots[i].value; },
  useEffect(fn,deps) { const i=cursor++; if (!slots[i] || !same(slots[i].deps,deps)) effects.push(()=>{slots[i]?.cleanup?.(); slots[i]={deps,cleanup:fn()};}); },
 };
 const mocks = {
  react,
  "react-native": { Platform:{OS:platform}, AppState:{addEventListener(name,fn){assert.equal(name,"focus");order.push("subscribe");focus=fn;return {remove(){focus=undefined;order.push("unsubscribe");}};}}, Pressable:"Pressable", View:"View", StyleSheet:{create:x=>x,hairlineWidth:1} },
  "react/jsx-runtime":{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  "@/components/AppText":{AppText:"Text",AppTextInput:"Input"}, "@/components/ui":{AccentButton:"Button"},
  "@/theme":{radius:{},spacing:{},typography:{}},
  "@/features/settings/settingsStore":{useTheme:()=>({colors:{}}),useThemedStyles:fn=>fn({})},
  "@clerk/expo":{useAuth:()=>({userId,getToken:async()=>"token"})},
  "@/features/church/api":{fetchChurch:async()=>({church:null})}, "../types":{PRESET_TAG_COLORS:["gold"]}, "./primitives":{BottomSheet:"BottomSheet"},
  "../noteTemplates":{buildNoteTemplate:()=>({title:"Verse study"}),NOTE_TEMPLATE_OPTIONS:[{id:"verse-study",label:"Verse study",description:"Study"}]},
 };
 const mod={exports:{}};new Function("require","module","exports",source)(id=>{if (!(id in mocks)) throw new Error(id);return mocks[id];},mod,mod.exports);
 let tree;
 function render() { cursor=0;effects=[];tree=mod.exports.CreateItemSheet({visible,kind:"note",onSubmit:()=>{},onClose:()=>{order.push("close");visible=false;},onSelectTemplate:async()=>{order.push("persist");return ()=>{actions++;order.push("navigate");};}});effects.forEach(fn=>fn());return tree; }
 function find(node) { if (!node || typeof node!=="object")return null;if(node.props?.accessibilityLabel==="Verse study")return node;for(const child of [node.props?.children].flat(Infinity)){const result=find(child);if(result)return result;}return null; }
 render();
 return {order,get actions(){return actions;},get visible(){return visible;},render,async pick(){find(tree).props.onPress();await new Promise(resolve=>setImmediate(resolve));},focus(){focus?.();},dismiss(){tree.props.onDismiss?.();},switchOwner(){userId="owner-b";render();},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
test("Android persists then subscribes before closing, waits for hidden native focus, and navigates once",async()=>{
 const h=harness();await h.pick();assert.deepEqual(h.order,["persist","subscribe","close"]);assert.equal(h.actions,0);
 h.focus();assert.equal(h.actions,0); // visible=false has not committed to React yet
 h.render();h.focus();h.focus();assert.equal(h.actions,1);assert.deepEqual(h.order,["persist","subscribe","close","unsubscribe","navigate"]);
});
test("pending Android navigation cannot cross account changes or unmount",async()=>{
 const account=harness();await account.pick();account.switchOwner();account.focus();assert.equal(account.actions,0);
 const unmounted=harness();await unmounted.pick();unmounted.render();unmounted.unmount();unmounted.focus();assert.equal(unmounted.actions,0);
});
test("iOS waits for native onDismiss and consumes the action once",async()=>{
 const h=harness("ios");await h.pick();assert.deepEqual(h.order,["persist","close"]);assert.equal(h.actions,0);
 h.render();h.dismiss();h.dismiss();assert.equal(h.actions,1);
});
