import type { DtcgResult, TokenLeaf } from "./dtcg";
import { memberName, typeName } from "./identifier";
import { byCategory, colorHex, members, numberText, quote, valueText, type Member } from "./native";

const INDENT = "    ";

/** A dimension uses TextUnit in typography and Dp elsewhere. */
function kotlinType(member: Member): string {
  if (member.type === "color") return "Color";
  if (member.type === "fontFamily" || member.type === "string") return "String";
  if (member.type === "boolean") return "Boolean";
  if (member.type === "number") return "Float";
  return member.category === "typo" ? "TextUnit" : "Dp";
}

function formatterFor(member: Member): (leaf: TokenLeaf) => string {
  const type = kotlinType(member);
  if (type === "Color") return (leaf) => `Color(${colorHex(leaf)})`;
  if (type === "String") return (leaf) => quote(leaf, true);
  if (type === "Boolean") return (leaf) => String(leaf.$value);
  if (type === "Float") return (leaf) => `${numberText(leaf)}f`;
  return (leaf) => `${numberText(leaf)}.${type === "TextUnit" ? "sp" : "dp"}`;
}

function declaration(member: Member): string {
  const name = memberName(member.path);
  const type = kotlinType(member);
  const format = formatterFor(member);
  const base = valueText(member.value, format);
  if (member.dark === undefined) return `${INDENT}val ${name}: ${type} = ${base}`;
  // isSystemInDarkTheme() is composable, so dynamic values require a custom getter.
  return [
    `${INDENT}val ${name}: ${type}`,
    `${INDENT}${INDENT}@Composable get() = if (isSystemInDarkTheme()) ${valueText(member.dark, format)} else ${base}`,
  ].join("\n");
}

/** Emit only used imports in code-unit order, without a package declaration. */
function imports(list: Member[]): string[] {
  const used = new Set<string>();
  if (list.some((m) => m.dark !== undefined)) {
    used.add("androidx.compose.foundation.isSystemInDarkTheme");
    used.add("androidx.compose.runtime.Composable");
  }
  const types = new Set(list.map(kotlinType));
  if (types.has("Color")) used.add("androidx.compose.ui.graphics.Color");
  if (types.has("Dp")) { used.add("androidx.compose.ui.unit.Dp"); used.add("androidx.compose.ui.unit.dp"); }
  if (types.has("TextUnit")) { used.add("androidx.compose.ui.unit.TextUnit"); used.add("androidx.compose.ui.unit.sp"); }
  return [...used].sort().map((i) => `import ${i}`);
}

export function emitKotlin(dtcg: DtcgResult): string {
  const list = members(dtcg);
  const lines = imports(list);
  const blocks: string[] = lines.length === 0 ? [] : [lines.join("\n")];
  for (const [category, group] of byCategory(list)) {
    const body = group.map(declaration).join("\n");
    blocks.push(`object ${typeName(category)} {\n${body}\n}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
