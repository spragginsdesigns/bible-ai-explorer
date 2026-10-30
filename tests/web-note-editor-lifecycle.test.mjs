import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const React=require("react"), {act,create}=require("react-test-renderer"), ts=require("typescript");
function load(file,mocks={}) {
 const filename=path.resolve(file), module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 new Function("require","module","exports",source)(id=>id in mocks?mocks[id]:createRequire(filename)(id),module,module.exports);return module.exports;
}
const drafts=load("src/lib/notes/editor-draft.ts"), adoption=load("src/lib/notes/canonical-document.ts");
const plain=text=>({type:"doc",content:[{type:"paragraph",content:[{type:"text",text}]}]});
const bold=text=>({type:"doc",content:[{type:"paragraph",content:[{type:"text",text,marks:[{type:"bold"}]}]}]});
class Doc { constructor(json){this.json=json;} eq(other){return JSON.stringify(this.json)===JSON.stringify(other.json);} }
const editors=[];
class FakeEditor {
 constructor(options){this.options=options;this.json=plain("");this.isEditable=true;this.isDestroyed=false;this.schema={nodeFromJSON:value=>new Doc(value)};this.commands={setContent:value=>{this.json=typeof value==="string"?plain(value):structuredClone(value);},clearContent:()=>{this.json=plain("");}};editors.push(this);}
 get state(){return {doc:new Doc(this.json)};} getJSON(){return this.json;} getText(){const walk=node=>node.text??(node.content??[]).map(walk).join("");return walk(this.json);} getHTML(){const text=this.getText();return this.json.content?.[0]?.content?.[0]?.marks?.length?`<p><strong>${text}</strong></p>`:`<p>${text}</p>`;} setEditable(value){this.isEditable=value;}
 edit(json){this.json=structuredClone(json);this.options.onUpdate();}
}
const extension={configure:()=>({})};
const mocks={react:React,"@tiptap/react":{useEditor:options=>{const [editor]=React.useState(()=>new FakeEditor(options));React.useEffect(()=>()=>{editor.isDestroyed=true;},[editor]);return editor;},EditorContent:()=>null},"./EditorToolbar":{default:()=>null,__esModule:true},"./extensions/WikilinkDecoration":{WikilinkDecoration:extension},"./noteMarkdownExport":{noteHtmlToMarkdown:(_title,html)=>html},"@/lib/notes/editor-draft":drafts,"@/lib/notes/canonical-document":adoption};
for(const id of ["@tiptap/starter-kit","@tiptap/extension-placeholder","@tiptap/extension-highlight","@tiptap/extension-task-list","@tiptap/extension-task-item","@tiptap/extension-link","@tiptap/extension-underline","@tiptap/extension-text-align"]) mocks[id]=extension;
const TiptapEditor=load("src/components/notes/TiptapEditor.tsx",mocks).default;
function browser(){const data=new Map();const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};globalThis.window={localStorage:storage,addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};globalThis.IS_REACT_ACT_ENVIRONMENT=true;return storage;}
function props(owner,note,content,ref,canSave,onSave){return {key:`${owner}:${note}`,ref,draftOwner:{accountId:owner,noteId:note},content:JSON.stringify(content),noteId:note,canSave,onSave};}
test("mounted outgoing editor retains failed rich edits through switch and explicit recovery",async()=>{
 const storage=browser(), ref=React.createRef();let current="old",okay=false;const saved=[];
 const save=async(data,id)=>{saved.push({data,id});return okay;};let root;
 try {
  await act(async()=>{root=create(React.createElement(TiptapEditor,props("lifecycle-owner-a","old",plain("server old"),ref,()=>current==="old",save)));});
  await act(async()=>{editors.at(-1).edit(bold("unsaved original formatting"));});
  await act(async()=>{assert.equal(await ref.current.flush(),false);});
  assert.equal(drafts.readEditorDraft(storage,{accountId:"lifecycle-owner-a",noteId:"old"}).body.content,JSON.stringify(bold("unsaved original formatting")));
  current="new";
  await act(async()=>{root.update(React.createElement(TiptapEditor,props("lifecycle-owner-a","new",plain("other note"),ref,()=>current==="new",save)));});
  assert.deepEqual(editors.at(-1).getJSON(),plain("other note"));
  current="old";const before=saved.length;
  await act(async()=>{root.update(React.createElement(TiptapEditor,props("lifecycle-owner-a","old",plain("server old"),ref,()=>current==="old",save)));});
  assert.equal(saved.length,before,"Reopening must not automatically PATCH an unresolved draft");assert.equal(editors.at(-1).isEditable,false);
  assert.deepEqual(editors.at(-1).getJSON(),bold("unsaved original formatting"));
  okay=true;
  await act(async()=>{root.root.findAllByType("button").find(button=>button.props.children==="Restore local edits").props.onClick();});
  await act(async()=>{assert.equal(await ref.current.flush(),true);});
  assert.equal(drafts.readEditorDraft(storage,{accountId:"lifecycle-owner-a",noteId:"old"}),null);assert.equal(saved.at(-1).id,"old");assert.equal(saved.at(-1).data.htmlContent,"<p><strong>unsaved original formatting</strong></p>");
 } finally {if(root)await act(async()=>root.unmount());}
});
test("direct same-mounted note prop replacement journals the outgoing body before successor checks reject its save",async()=>{
 const storage=browser(),ref=React.createRef();let allowed=true,saves=0,root;
 const before={...props("lifecycle-owner-b","before",plain("saved"),ref,()=>allowed,async()=>{saves++;return false;}),key:"same-editor"};
 try {
  await act(async()=>{root=create(React.createElement(TiptapEditor,before));});
  await act(async()=>{editors.at(-1).edit(bold("dirty outgoing"));});allowed=false;
  await act(async()=>{root.update(React.createElement(TiptapEditor,{...before,noteId:"after",content:JSON.stringify(plain("next note")),draftOwner:{accountId:"lifecycle-owner-b",noteId:"after"}}));});
  assert.equal(saves,0,"A successor checking controller must not authorize an old full-body PATCH");
  assert.equal(drafts.readEditorDraft(storage,{accountId:"lifecycle-owner-b",noteId:"before"}).body.content,JSON.stringify(bold("dirty outgoing")));
  assert.deepEqual(editors.at(-1).getJSON(),plain("next note"));
 } finally {if(root)await act(async()=>root.unmount());}
});
test("retained local drafts never enter another account's mounted editor",async()=>{
 const storage=browser(),ref=React.createRef();let active=true,root;
 try {
  await act(async()=>{root=create(React.createElement(TiptapEditor,props("private-owner-one","same-id",plain("first"),ref,()=>active,async()=>false)));});
  await act(async()=>{editors.at(-1).edit(bold("private unsaved draft"));});active=false;
  await act(async()=>{root.update(React.createElement(TiptapEditor,props("private-owner-two","same-id",plain("second account saved"),ref,()=>true,async()=>true)));});
  assert.deepEqual(editors.at(-1).getJSON(),plain("second account saved"));assert.equal(drafts.readEditorDraft(storage,{accountId:"private-owner-two",noteId:"same-id"}),null);
  assert.equal(drafts.readEditorDraft(storage,{accountId:"private-owner-one",noteId:"same-id"}).body.content,JSON.stringify(bold("private unsaved draft")));
 } finally {if(root)await act(async()=>root.unmount());}
});
test("interrupted AI reconciliation adopts canonical content while retaining a separately restorable rich draft",async()=>{
 const storage=browser(),ref=React.createRef(), owner={accountId:"lifecycle-ai-owner",noteId:"both-pending"};
 const core=load("src/lib/notes/note-ai-operation.ts");
 drafts.retainEditorDraft(storage,owner,{content:JSON.stringify(bold("retained local formatting")),htmlContent:"<p><strong>retained local formatting</strong></p>",plainText:"retained local formatting",wordCount:3});
 let operationId=0;const canonical=JSON.stringify(plain("current canonical assistant result"));
 const dependencies={accountId:owner.accountId,noteId:owner.noteId,newId:()=>`00000000-0000-4000-8000-${String(++operationId).padStart(12,"0")}`,isCurrent:()=>true,storage,prepare:async()=>true,reserve:async body=>({id:body.operationId,state:"reserved"}),read:async id=>({id,state:"running"}),cancel:async id=>({id,state:"cancelled"}),canonical:async()=>canonical,adopt:async content=>ref.current.replaceCanonical(content),changed:(state)=>ref.current?.setReadOnly(state!=="editable")};
 const previous=core.createNoteAIOperation(dependencies);await previous.initialize();await previous.begin({messages:[{id:"user-one",role:"user",parts:[{type:"text",text:"rewrite"}]}]});previous.dispose();
 const current=core.createNoteAIOperation(dependencies);const writes=[];let root;
 try {
  await act(async()=>{root=create(React.createElement(TiptapEditor,{...props(owner.accountId,owner.noteId,plain("saved before assistant"),ref,current.canSave,async data=>{writes.push(data);return true;}),readOnly:true}));});
  assert.equal(editors.at(-1).isEditable,false);
  await act(async()=>{assert.equal(await current.initialize(),true);});
  await act(async()=>{root.update(React.createElement(TiptapEditor,{...props(owner.accountId,owner.noteId,JSON.parse(canonical),ref,current.canSave,async data=>{writes.push(data);return true;}),readOnly:false}));});
  assert.deepEqual(editors.at(-1).getJSON(),JSON.parse(canonical));assert.equal(writes.length,0);
  assert.equal(current.canEdit(),true);assert.equal(editors.at(-1).isEditable,false,"The unresolved local recovery choice still owns the editor lock");
  assert.equal(drafts.readEditorDraft(storage,owner).body.content,JSON.stringify(bold("retained local formatting")));
  await act(async()=>{root.root.findAllByType("button").find(button=>button.props.children==="Restore local edits").props.onClick();});
  await act(async()=>{assert.equal(await ref.current.flush(),true);});
  assert.equal(writes.length,1);assert.equal(writes[0].content,JSON.stringify(bold("retained local formatting")));
  assert.deepEqual(editors.at(-1).getJSON(),bold("retained local formatting"));assert.equal(drafts.readEditorDraft(storage,owner),null);
 } finally {current.dispose();if(root)await act(async()=>root.unmount());}
});
test("corrupt retained draft remains locked when operation checking becomes editable", async () => {
 const storage=browser(),ref=React.createRef(),owner={accountId:"corrupt-draft-owner",noteId:"corrupt-draft-note"};
 storage.setItem(`sureword.note-editor-draft.v1:${encodeURIComponent(owner.accountId)}:${encodeURIComponent(owner.noteId)}`,"{");
 let root,writes=0;const initial={...props(owner.accountId,owner.noteId,plain("saved canonical"),ref,()=>true,async()=>{writes++;return true;}),readOnly:true};
 try {
  await act(async()=>{root=create(React.createElement(TiptapEditor,initial));});
  assert.equal(editors.at(-1).isEditable,false);
  await act(async()=>{root.update(React.createElement(TiptapEditor,{...initial,readOnly:false}));});
  assert.equal(editors.at(-1).isEditable,false,"A later operation state must not bypass a failed recovery lock");
  await act(async()=>{ref.current.setReadOnly(false);assert.equal(await ref.current.flush(),false);});
  assert.equal(editors.at(-1).isEditable,false);assert.equal(writes,0);
  assert.equal(storage.getItem(`sureword.note-editor-draft.v1:${encodeURIComponent(owner.accountId)}:${encodeURIComponent(owner.noteId)}`),"{");
 } finally {if(root)await act(async()=>root.unmount());}
});
for(const state of ["checking","failed"]) test(`mounted panel and hook keep typed input when the operation is ${state}`,async()=>{
 browser();let sends=0,root;
 const stable={sendMessage:async()=>{sends++;},stop(){},clearError(){}};
 const actualHook=load("src/hooks/useNoteAI.ts",{react:React,"@/lib/ai-consent-gate":{consentFetch:async()=>Response.json([])},"@ai-sdk/react":{useChat:()=>{const [messages,setMessages]=React.useState([]);return {...stable,messages,setMessages,status:"ready",error:null};}},ai:{DefaultChatTransport:class{constructor(config){this.config=config;}}},"@/lib/chat/message-display":{isRenderableChatMessage:()=>true,streamingAssistantId:()=>undefined},"@/components/useChat":{dbMessageToUIMessage:value=>value,toViewMessage:value=>value},"@/lib/chat/chatErrors":{classifyChatError:()=>({title:"Error",message:"Could not send",retryable:true})},"@/lib/notes/note-ai-operation":load("src/lib/notes/note-ai-operation.ts")});
 const icons=Object.fromEntries(["X","Send","Sparkles","Trash2","ArrowLeft","RefreshCw"].map(name=>[name,()=>null]));
 const Panel=load("src/components/notes/NoteAIPanel.tsx",{react:React,"lucide-react":icons,"./NoteAIMessage":{default:()=>null,__esModule:true},"@/hooks/useNoteAI":actualHook,"@/lib/chat/slashCommands":{NOTE_SLASH_COMMANDS:[],matchSlashCommands:()=>[],parseSlashCommand:()=>null}}).default;
 const operation={canEdit:()=>false,isCurrent:()=>true,recover:async()=>false};
 try {
  await act(async()=>{root=create(React.createElement(Panel,{noteId:`locked-${state}`,operation,onClose:async()=>true,beforeNavigate:async()=>true}));});
  await act(async()=>{root.root.findByType("textarea").props.onChange({target:{value:"Keep my unsent question"}});});
  await act(async()=>{root.root.findByType("textarea").props.onKeyDown({key:"Enter",shiftKey:false,preventDefault(){}});});
  assert.equal(sends,0);assert.equal(root.root.findByType("textarea").props.value,"Keep my unsent question");
 } finally {if(root)await act(async()=>root.unmount());}
});
test("an unaccepted HTTP send preserves the question in the actual mounted panel",async()=>{
 browser();let root,transport,requests=0,latest;
 const actualHook=load("src/hooks/useNoteAI.ts",{react:React,"@/lib/ai-consent-gate":{consentFetch:async(input)=>String(input).endsWith("ai-messages")?Response.json([]):(requests++,new Response("not accepted",{status:503}))},"@ai-sdk/react":{useChat:options=>{const [messages,setMessages]=React.useState([]);const sendMessage=React.useCallback(async message=>{await transport.config.fetch("/api/note-ai",{body:JSON.stringify({messages:[message]})});},[]);latest={messages,setMessages};return {messages,setMessages,sendMessage,status:"ready",error:null,stop:stableStop,clearError:stableStop};}},ai:{DefaultChatTransport:class{constructor(config){this.config=config;transport=this;}}},"@/lib/chat/message-display":{isRenderableChatMessage:()=>true,streamingAssistantId:()=>undefined},"@/components/useChat":{dbMessageToUIMessage:value=>value,toViewMessage:value=>value},"@/lib/chat/chatErrors":{classifyChatError:()=>({title:"Error",message:"Could not send",retryable:true})},"@/lib/notes/note-ai-operation":load("src/lib/notes/note-ai-operation.ts")});
 const icons=Object.fromEntries(["X","Send","Sparkles","Trash2","ArrowLeft","RefreshCw"].map(name=>[name,()=>null]));
 const Panel=load("src/components/notes/NoteAIPanel.tsx",{react:React,"lucide-react":icons,"./NoteAIMessage":{default:()=>null,__esModule:true},"@/hooks/useNoteAI":actualHook,"@/lib/chat/slashCommands":{NOTE_SLASH_COMMANDS:[],matchSlashCommands:()=>[],parseSlashCommand:()=>null}}).default;
 const operation={canEdit:()=>true,isCurrent:()=>true,begin:async body=>({...body,noteId:"failed-http",operationId:"operation-one"}),recover:async()=>true};
 try {
  await act(async()=>{root=create(React.createElement(Panel,{noteId:"failed-http",operation,onClose:async()=>true,beforeNavigate:async()=>true}));});
  await act(async()=>{root.root.findByType("textarea").props.onChange({target:{value:"Question survives server refusal"}});});
  await act(async()=>{root.root.findByType("textarea").props.onKeyDown({key:"Enter",shiftKey:false,preventDefault(){}});});
  assert.equal(requests,1);assert.equal(root.root.findByType("textarea").props.value,"Question survives server refusal");assert.ok(latest);
 }finally{if(root)await act(async()=>root.unmount());}
});
function stableStop() {}
test("a deferred SDK transport cannot reserve an old question against the successor note",async()=>{
 browser();let root,transport,release,current,oldReservations=0,newReservations=0;
 const hold=new Promise(resolve=>{release=resolve;});
 const actualHook=load("src/hooks/useNoteAI.ts",{react:React,"@/lib/ai-consent-gate":{consentFetch:async()=>Response.json([])},"@ai-sdk/react":{useChat:()=>{const [messages,setMessages]=React.useState([]);const sendMessage=React.useCallback(async message=>{await hold;await transport.config.fetch("/api/note-ai",{body:JSON.stringify({messages:[message]})});},[]);return {messages,setMessages,sendMessage,status:"ready",error:null,stop:stableStop,clearError:stableStop};}},ai:{DefaultChatTransport:class{constructor(config){this.config=config;transport=this;}}},"@/lib/chat/message-display":{isRenderableChatMessage:()=>true,streamingAssistantId:()=>undefined},"@/components/useChat":{dbMessageToUIMessage:value=>value,toViewMessage:value=>value},"@/lib/chat/chatErrors":{classifyChatError:()=>({title:"Error",message:"Could not send",retryable:true})},"@/lib/notes/note-ai-operation":load("src/lib/notes/note-ai-operation.ts")});
 const previous={canEdit:()=>true,isCurrent:()=>true,begin:async()=>{oldReservations++;throw Error("must not reserve");},recover:async()=>true};
 const successor={...previous,begin:async()=>{newReservations++;throw Error("must not reserve");}};
 function Host({operation,noteId}){current=actualHook.useNoteAI(noteId,operation);return null;}
 try{
  await act(async()=>{root=create(React.createElement(Host,{operation:previous,noteId:"prior-note"}));});
  let accepted;await act(async()=>{accepted=current.sendMessage("belongs only to old note");});
  await act(async()=>{root.update(React.createElement(Host,{operation:successor,noteId:"next-note"}));});
  await act(async()=>{release();assert.equal(await accepted,false);});
  assert.equal(oldReservations,0);assert.equal(newReservations,0);
 }finally{release();if(root)await act(async()=>root.unmount());}
});
test("mounted NotesPage guards template and unresolved-link creation before the hook can change active note",async()=>{
 browser();window.history={pushState(){},replaceState(){},go(){}};let root,creates=0,guards=0;
 const old={id:"guarded-old-note",folderId:null};
 const no=()=>{};const state={notes:[old],allNotes:[old],activeNote:old,activeNoteId:old.id,folders:[],tags:[],hasLoaded:true,noteExists:id=>id===old.id,setActiveNoteId:no,clearMutationError:no,createNote:async()=>{creates++;return {id:"must-not-create"};}};
 const Page=load("src/components/notes/NotesPage.tsx",{react:React,"@clerk/nextjs":{useUser:()=>({user:{id:"guarded-owner"},isLoaded:true})},"next/navigation":{useSearchParams:()=>({get:()=>old.id})},"next/link":{default:()=>null,__esModule:true},"lucide-react":{X:()=>null},"@/components/AppSidebar":{default:()=>null,__esModule:true},"./NotesSidebar":{default:()=>null,__esModule:true},"./NotesSearch":{default:()=>null,__esModule:true},"./NotesListView":{default:()=>null,__esModule:true},"./NoteEditorView":{default:props=>React.createElement("note-editor",props),__esModule:true},"./NotesTopBar":{default:()=>null,__esModule:true},"./NoteTemplatePicker":{default:props=>React.createElement("template-picker",props),__esModule:true},"./noteTemplates":{buildNoteTemplate:()=>null},"@/lib/voice/web-departure":{confirmVoiceDeparture:async()=>{guards++;return false;}},"@/hooks/useNotes":{useNotes:()=>state}}).default;
 try{
  await act(async()=>{root=create(React.createElement(Page));});
  await act(async()=>{root.root.findByType("template-picker").props.onPick("blank");});
  await act(async()=>{await root.root.findByType("note-editor").props.onCreateLinkedNote("unresolved target");});
  assert.equal(guards,2);assert.equal(creates,0);assert.equal(root.root.findByType("note-editor").props.note.id,old.id);
 }finally{if(root)await act(async()=>root.unmount());}
});
