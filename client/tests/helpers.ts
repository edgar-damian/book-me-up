import { screen } from "@testing-library/react";
import { expect } from "vitest";

/** One h1, and no heading more than one level below the heading before it. */
export function expectHeadingOutline() {
  const headings = screen.getAllByRole("heading").map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: el.textContent,
  }));

  expect(headings.filter((h) => h.level === 1)).toHaveLength(1);

  const skips = headings
    .filter((h, i) => i > 0 && h.level > headings[i - 1].level + 1)
    .map((h) => `h${h.level} "${h.text}"`);
  expect(skips).toEqual([]);
}
