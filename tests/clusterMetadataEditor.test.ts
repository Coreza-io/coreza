import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ClusterMetadataEditor } from "@/components/workflow/ClusterMetadataEditor";
import { updateClusterMetadataInDocument, type WorkflowDocument } from "@/domain/clusters/documentCommands";

const outer = "11111111-1111-4111-8111-111111111111";
const inner = "22222222-2222-4222-8222-222222222222";
const makeDocument = (): WorkflowDocument => ({
  nodes:[{id:"a",position:{x:0,y:0},data:{}},{id:"b",position:{x:300,y:0},data:{}}],edges:[],
  clusters:[{id:outer,title:"Outer",memberNodeIds:["b"]},{id:inner,title:"Inner",note:"note",parentClusterId:outer,memberNodeIds:["a"]}],
});

function mount() {
  let document = makeDocument();
  const history: WorkflowDocument[] = [];
  function Harness() {
    const [current, setCurrent] = React.useState(document);
    const [editingTitle,setEditingTitle] = React.useState(true);
    document=current;
    return React.createElement(ClusterMetadataEditor,{
      cluster:current.clusters[1],workflowSessionId:"metadata",editingTitle,disabled:false,
      onEditTitle:()=>setEditingTitle(true),onFinishTitle:()=>setEditingTitle(false),
      onCommit:(patch,intent)=>{
        const result=updateClusterMetadataInDocument(current,intent.clusterId,patch,intent);
        if (!result.ok) return false;
        if (result.changed) {history.push(current);setCurrent(result.document);}
        return true;
      },
    });
  }
  let renderer!: ReactTestRenderer;
  act(()=>{renderer=create(React.createElement(Harness));});
  const input = (field:string) => renderer.root.findAllByType("input").find(item=>item.props["aria-label"]?.endsWith(field))!;
  return {renderer,input,history,document:()=>document};
}

it("keeps typing local and commits a title once on Enter with hierarchy retained", () => {
  const editor=mount();
  act(()=>editor.input("title").props.onFocus());
  act(()=>editor.input("title").props.onChange({target:{value:"Renamed"}}));
  expect(editor.document().clusters[1].title).toBe("Inner");
  expect(editor.history).toHaveLength(0);
  act(()=>editor.input("title").props.onKeyDown({key:"Enter",preventDefault:jest.fn(),stopPropagation:jest.fn(),currentTarget:{blur:()=>editor.input("title").props.onBlur()}}));
  expect(editor.document().clusters[1]).toMatchObject({title:"Renamed",parentClusterId:outer,memberNodeIds:["a"]});
  expect(editor.history).toHaveLength(1);
  expect(editor.history[0]).toEqual(makeDocument());
  act(()=>editor.renderer.unmount());
});

it.each([" ","Outer"])("rejects an invalid title without changing canonical state or history: %p", title => {
  const editor=mount();
  act(()=>editor.input("title").props.onFocus());
  act(()=>editor.input("title").props.onChange({target:{value:title}}));
  act(()=>editor.input("title").props.onBlur());
  expect(editor.document()).toEqual(makeDocument());
  expect(editor.history).toHaveLength(0);
  act(()=>editor.renderer.unmount());
});

it("cancels drafts on Escape and skips normalized note no-ops", () => {
  const editor=mount();
  act(()=>editor.input("title").props.onFocus());
  act(()=>editor.input("title").props.onChange({target:{value:"Cancelled"}}));
  act(()=>editor.input("title").props.onKeyDown({key:"Escape",preventDefault:jest.fn(),stopPropagation:jest.fn(),currentTarget:{blur:()=>editor.input("title").props.onBlur()}}));
  act(()=>editor.input("note").props.onFocus());
  act(()=>editor.input("note").props.onChange({target:{value:" note "}}));
  act(()=>editor.input("note").props.onBlur());
  expect(editor.document()).toEqual(makeDocument());
  expect(editor.history).toHaveLength(0);
  act(()=>editor.renderer.unmount());
});

it("commits note drafts on blur as one undoable transaction", () => {
  const editor=mount();
  act(()=>editor.input("note").props.onFocus());
  act(()=>editor.input("note").props.onChange({target:{value:" New note "}}));
  expect(editor.document().clusters[1].note).toBe("note");
  expect(editor.history).toHaveLength(0);
  act(()=>editor.input("note").props.onBlur());
  expect(editor.document().clusters[1].note).toBe("New note");
  expect(editor.history).toHaveLength(1);
  expect(editor.history[0]).toEqual(makeDocument());
  act(()=>editor.renderer.unmount());
});
