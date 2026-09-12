/** Build repeated containers with references resolved outside their source ranges. */
export function performanceMarkdown(sections: number): string {
  return (
    Array.from({ length: sections }, (_, index) =>
      [
        `## Section ${String(index)}`,
        "A paragraph with **emphasis**, [shared reference][target], and Unicode 界🙂.",
        "- Parent\n  - Child\n\n> Quoted text.\n>\n> Second paragraph.",
        "| Column | Value |\n| --- | --- |\n| A | B |",
        "```ts\nconst value = 1;\n```",
      ].join("\n\n"),
    ).join("\n\n") + "\n\n[target]: https://example.com\n"
  );
}
