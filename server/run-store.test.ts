import { describe, expect, it } from "vitest";
import { validatePageContext } from "./run-store";
import type { InteractiveElement, PageContext } from "../src/shared/types";

const createInteractiveElement = (
  index: number,
  label = `Nav ${index}`,
): InteractiveElement => ({
  id: `el_${index}`,
  tagName: "a",
  role: "link",
  label,
  rect: {
    x: 12,
    y: 32 + index * 24,
    width: 72,
    height: 18,
  },
  riskLevel: "medium",
  disabled: false,
});

const createPageContext = (
  interactiveElements: InteractiveElement[],
): PageContext => ({
  url: "https://git.example.com/group/project/-/commits/main",
  origin: "https://git.example.com",
  title: "Commits",
  selectedText: "",
  visibleTextSummary: "Commits 71f46416 Fix toolbar behavior",
  headings: [],
  tables: [],
  interactiveElements,
  collectedAt: "2026-05-12T00:00:00.000Z",
});

describe("validatePageContext", () => {
  it("preserves interactive elements beyond the old top navigation cutoff", () => {
    const elements = Array.from({ length: 24 }, (_, index) =>
      createInteractiveElement(index + 1),
    );
    const commitLink = createInteractiveElement(25, "71f46416");

    const validated = validatePageContext(
      createPageContext([...elements, commitLink]),
    );

    expect(validated.interactiveElements).toHaveLength(25);
    expect(validated.interactiveElements).toContainEqual(commitLink);
  });
});
