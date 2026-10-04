import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Plugin } from 'vite';

// 只在独立总览引用此虚拟模块。逐层扫描 TSX，分支索引不靠手写页面登记。
const virtual = 'virtual:azcine-ui-inventory', resolved = '\0' + virtual;
const src = fileURLToPath(new URL('./src/', import.meta.url));
export interface UIEntry {file:string;line:number;kind:string;name:string;variant:string;condition:string;native:boolean}
function files(directory:string):string[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap(item=> {
    const path=resolve(directory,item.name);
    if(item.isDirectory()) return item.name==='ui-preview'||relative(src,path).replaceAll('\\','/')==='components/ui'?[]:files(path);
    return item.name.endsWith('.tsx')?[path]:[];
  });
}
function hasJSX(node:ts.Node):boolean {
  if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node))return true;
  return ts.forEachChild(node,child=>hasJSX(child)||undefined)===true;
}
function inventory() {
  const entries:UIEntry[]=[];
  for(const file of files(src).sort()) {
    const code=readFileSync(file,'utf8'), root=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const name=relative(src,file).replaceAll('\\','/');
    function add(node:ts.Node,kind:string,title:string,variant='',condition='',native=false) {
      entries.push({file:name,line:root.getLineAndCharacterOfPosition(node.getStart(root)).line+1,kind,name:title,variant,condition,native});
    }
    function walk(node:ts.Node) {
      if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
        const tag=node.tagName.getText(root), attributes=node.attributes.properties;
        const attr=(key:string)=>{const a=attributes.find(a=>ts.isJsxAttribute(a)&&a.name.getText(root)===key);return a&&ts.isJsxAttribute(a)?a.initializer?.getText(root).replace(/^"|"$/g,'')??'':'';};
        const label=[attr('aria-label'),attr('className'),tag].find(Boolean)!;
        if(['Button','Input','Textarea','NativeSelect','button','input','textarea','select'].includes(tag))add(node,'control',label,attr('variant')||'default','',/^[a-z]/.test(tag));
        if(['UILink','a'].includes(tag))add(node,'link',label,attr('variant')||'native','',tag==='a');
        if(['Disclosure','details'].includes(tag))add(node,'disclosure',label,attr('variant')||'default','',tag==='details');
        if(['Feedback','StatusBadge','ActionGroup','EmptyState'].includes(tag))add(node,'feedback',label,attr('tone')||attr('direction')||'default');
        if(['menu','dialog','listbox'].includes(attr('role'))||attr('popover'))add(node,'menu',label);
      }
      if(ts.isConditionalExpression(node)&&(hasJSX(node.whenTrue)||hasJSX(node.whenFalse)))add(node,'condition','条件显示','',node.condition.getText(root));
      if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)&&hasJSX(node.right))add(node,'condition','条件显示','',`${node.left.getText(root)} ${node.operatorToken.getText(root)}`);
      if(ts.isIfStatement(node)&&(hasJSX(node.thenStatement)||!!node.elseStatement&&hasJSX(node.elseStatement)))add(node,'condition','条件返回','',node.expression.getText(root));
      if(ts.isCaseClause(node)&&hasJSX(node))add(node,'condition','路由 / 状态分支','',node.expression.getText(root));
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='map'&&node.arguments.some(hasJSX))add(node,'collection','列表与重复控件','',node.expression.expression.getText(root));
      ts.forEachChild(node,walk);
    }
    walk(root);
  }
  return entries;
}
export function uiInventory():Plugin {
  return {name:'azcine-ui-inventory',
    resolveId(id){if(id===virtual)return resolved;},
    load(id){if(id===resolved)return `export default ${JSON.stringify(inventory())};`;},
    configureServer(server) {
      const changed=(file:string)=> {
        if(!file.replaceAll('\\','/').startsWith(src.replaceAll('\\','/'))||!file.endsWith('.tsx'))return;
        const module=server.moduleGraph.getModuleById(resolved);
        if(module){server.moduleGraph.invalidateModule(module);server.ws.send({type:'full-reload',path:'/ui.html'});}
      };
      server.watcher.on('add',changed);server.watcher.on('unlink',changed);
      server.httpServer?.once('close',()=>{server.watcher.off('add',changed);server.watcher.off('unlink',changed);});
    },
    handleHotUpdate(ctx){if(ctx.file.replaceAll('\\','/').startsWith(src.replaceAll('\\','/'))&&ctx.file.endsWith('.tsx')) {
      const module=ctx.server.moduleGraph.getModuleById(resolved);
      if(module){ctx.server.moduleGraph.invalidateModule(module);return [...ctx.modules,module];}
    }},
  };
}
