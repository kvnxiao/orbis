# Planning tool retries

Pi baseline: 0.85.1.

Custom extension entries persist on the active session branch. Pi can append an entry in memory
before its disk write completes, and it defers initial persistence until the first assistant
message. A retry record therefore needs disk confirmation before another operation depends on it.
Completed tool history does not cause Pi to rerun a tool automatically; a subsequent model call is a
separate invocation and may use a different tool-call ID.

JSON objects are unordered collections of members; arrays preserve element order.
[JSON data structures](https://www.rfc-editor.org/rfc/rfc8259.html#section-1).

Sources:
[Pi session format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md),
[tool execution](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).
These are installed-source findings; source inspection does not establish runtime retry behavior.
