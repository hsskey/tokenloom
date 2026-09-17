import { describe, expect, it } from "vitest";
import { variantMarkers } from "../src/html-markers";

const REAL = '<div data-variant="a=1"></div>';

/**
 * Each case pairs generated HTML with the `data-variant` list the render page's DOM produces
 * (docs/reference/spec.md 9.5, F15). The expected list is a literal so no browser runs. A regex over
 * the HTML would count markers inside script strings, escaped text, and inert template content.
 */
describe("variantMarkers matches the DOM start-tag list (SPEC 9.5)", () => {
  const cases: { name: string; html: string; expected: string[] }[] = [
    { name: "a script string", html: `${REAL}<script>var s = '<div data-variant="b=2">';</script>`, expected: ["a=1"] },
    { name: "style text", html: `${REAL}<style>div[data-variant="b=2"] { color: red; }</style>`, expected: ["a=1"] },
    { name: "a comment", html: `<!-- <div data-variant="b=2"> -->${REAL}`, expected: ["a=1"] },
    { name: "escaped text with plain quotes", html: `${REAL}&lt;div data-variant="b=2"&gt;`, expected: ["a=1"] },
    { name: "escaped text with entity quotes", html: `&lt;div data-variant=&quot;b=2&quot;&gt;${REAL}`, expected: ["a=1"] },
    { name: "template content", html: `<template><div data-variant="b=2"></div></template>${REAL}`, expected: ["a=1"] },
    { name: "textarea content", html: `<textarea><div data-variant="b=2"></div></textarea>${REAL}`, expected: ["a=1"] },
    { name: "noscript content", html: `<noscript><div data-variant="b=2"></div></noscript>${REAL}`, expected: ["a=1"] },
    { name: "another attribute's value", html: `<div title="data-variant=b=2"><span data-variant="a=1"></span></div>`, expected: ["a=1"] },
    { name: "a > inside a quoted value", html: `<div title="x>y" data-variant="a=1"></div>`, expected: ["a=1"] },
    { name: "an unquoted value", html: `<div data-variant=a=1></div>`, expected: ["a=1"] },
    { name: "an uppercase attribute name", html: `<div DATA-VARIANT="a=1"></div>`, expected: ["a=1"] },
    { name: "a duplicate attribute", html: `<div data-variant="a=1" data-variant="b=2"></div>`, expected: ["a=1"] },
    { name: "an entity value", html: `<div data-variant="a=1&amp;b=2"></div>`, expected: ["a=1&b=2"] },
    { name: "a newline in the tag", html: `<div\n  data-variant="a=1"\n></div>`, expected: ["a=1"] },
    { name: "a self-closing tag", html: `<img data-variant="a=1"/>`, expected: ["a=1"] },
    { name: "an SVG child", html: `<svg><rect data-variant="a=1"/></svg>`, expected: ["a=1"] },
    { name: "a bare < in text", html: `${REAL}a < b data-variant=nope`, expected: ["a=1"] },
  ];

  it.each(cases)("ignores a marker in $name", ({ html, expected }) => {
    expect(variantMarkers(html)).toEqual(expected);
  });

  it("returns every real start-tag marker in document order", () => {
    const html = `<div data-variant="size=xs,state=default"></div><div data-variant="size=sm,state=hover"></div>`;
    expect(variantMarkers(html)).toEqual(["size=xs,state=default", "size=sm,state=hover"]);
  });
});
