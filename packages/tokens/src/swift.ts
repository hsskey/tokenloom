import type { DtcgResult, TokenLeaf } from "./dtcg";
import { memberName, typeName } from "./identifier";
import { byCategory, colorHex, members, numberText, quote, valueText, type Member } from "./native";

const INDENT = "    ";

/** Emit only when a color token exists; `private` prevents exposing it outside the file. */
const COLOR_HELPER = `private extension UIColor {
${INDENT}convenience init(hex: UInt32) {
${INDENT}${INDENT}self.init(
${INDENT}${INDENT}${INDENT}red: CGFloat((hex >> 16) & 0xff) / 255,
${INDENT}${INDENT}${INDENT}green: CGFloat((hex >> 8) & 0xff) / 255,
${INDENT}${INDENT}${INDENT}blue: CGFloat(hex & 0xff) / 255,
${INDENT}${INDENT}${INDENT}alpha: CGFloat((hex >> 24) & 0xff) / 255
${INDENT}${INDENT})
${INDENT}}
}`;

function swiftType(member: Member): string {
  if (member.type === "color") return "UIColor";
  if (member.type === "fontFamily" || member.type === "string") return "String";
  if (member.type === "boolean") return "Bool";
  return "CGFloat";
}

function formatterFor(member: Member): (leaf: TokenLeaf) => string {
  if (member.type === "color") return (leaf) => `UIColor(hex: ${colorHex(leaf)})`;
  if (member.type === "fontFamily" || member.type === "string") return (leaf) => quote(leaf, false);
  if (member.type === "boolean") return (leaf) => String(leaf.$value);
  return numberText;
}

function declaration(member: Member): string {
  const head = `${INDENT}static let ${memberName(member.path)}: ${swiftType(member)} = `;
  const format = formatterFor(member);
  const base = valueText(member.value, format);
  if (member.dark === undefined) return `${head}${base}`;
  // UIColor(dynamicProvider:) resolves traits at draw time, so the declaration can remain constant.
  return [
    `${head}UIColor { trait in`,
    `${INDENT}${INDENT}trait.userInterfaceStyle == .dark ? ${valueText(member.dark, format)} : ${base}`,
    `${INDENT}}`,
  ].join("\n");
}

export function emitSwift(dtcg: DtcgResult): string {
  const list = members(dtcg);
  const blocks: string[] = ["import UIKit"];
  if (list.some((m) => m.type === "color")) blocks.push(COLOR_HELPER);
  for (const [category, group] of byCategory(list)) {
    const body = group.map(declaration).join("\n");
    blocks.push(`enum ${typeName(category)} {\n${body}\n}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
