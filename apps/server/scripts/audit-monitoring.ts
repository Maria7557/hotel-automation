import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../..");
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []))).flat();
}
const sources = [join(root, "apps/mobile/App.tsx"), ...await files(join(root, "apps/mobile/src"))];
const failures: string[] = [];
let controls = 0; let workflows = 0; let nativeChanges = 0; let webChanges = 0;
for (const file of sources) {
  if (file.includes("/monitoring/")) continue;
  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (node: ts.Node, message: string) => failures.push(`${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "react-native") {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (!item.isTypeOnly && /^(Pressable|Touchable.*|Switch|TextInput|RefreshControl|Button|Alert)$/.test(item.name.text)) report(item, `Use the monitored ${item.name.text} wrapper.`);
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (["onPress", "onLongPress", "onRefresh", "onValueChange", "onSubmitEditing", "onEndEditing"].includes(name)) {
          controls++;
          if (tag === "Text" && !attribute.getText(source).includes("actions.run")) report(attribute, "Text press must invoke an explicit action.");
        }
        if (name === "onValueChange") nativeChanges++;
        if (/^[a-z]/.test(tag) && ["onChange", "onClick", "onSubmit"].includes(name)) {
          webChanges++;
          if (!attribute.getText(source).includes("actions.run")) report(attribute, "DOM control needs an explicit safe action scope.");
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "monitoredAction") workflows++;
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer) && node.initializer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      if (node.initializer.getText(source).includes("apiClient.")) report(node, "Async API workflow needs monitoredAction and scopedApiClient.");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.info(`Action coverage audit passed: ${controls} control handlers, ${workflows} scoped async workflows, ${nativeChanges} switch handlers, ${webChanges} direct web controls. Public DOM/forms use the shared browser runtime.`);
