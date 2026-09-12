import type { ComponentSetT } from "@tokenloom/schema";

/** Choose the component containing the first declared value of every variant property. */
export function baseIndexOf(set: ComponentSetT): number {
  const first: Record<string, string> = {};
  for (const [key, values] of Object.entries(set.props)) {
    const value = values[0];
    if (value !== undefined) first[key] = value;
  }
  const index = set.components.findIndex((component) =>
    Object.entries(first).every(([key, value]) => component.props[key] === value));
  return index >= 0 ? index : 0;
}

export function visibleVariantCountOf(set: ComponentSetT): number {
  const baseIndex = baseIndexOf(set);
  const base = set.components[baseIndex];
  if (base === undefined || !base.root.visible) return 0;
  return set.components.filter((component, index) => index !== baseIndex && component.root.visible).length;
}
