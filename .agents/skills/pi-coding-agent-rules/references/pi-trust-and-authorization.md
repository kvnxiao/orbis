# Pi trust and authorization

## Separate project trust, authorization, and enforcement (Required)

Project trust permits loading project resources. User authorization permits an operation within a
defined scope. A sandbox restricts what code can access. Keep these decisions separate; neither a
trusted project nor a successful permission prompt establishes filesystem or network isolation.

Pi v0.85.1 extensions execute with the host process's system permissions. Before honoring
project-local extension configuration that requires trust, check `ctx.isProjectTrusted()`. Do not
reconstruct effective trust from saved decisions alone; temporary decisions and CLI overrides also
contribute. A tool-call hook can gate the calls it observes, but does not confine an extension's
direct filesystem, subprocess, or network access. When confinement is required, enforce it at the
execution boundary and verify every supported execution path.
[Pi extension permissions](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#extension-locations),
[effective project trust](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#ctxisprojecttrusted).

## Bind approval to the operation it authorizes (Conditional)

When a workflow needs approval, distinguish accepting a plan from authorizing its execution unless
the interaction explicitly combines them. Present the concrete action and relevant target, account,
environment, and state version before execution. Reuse existing authorization within its scope; do
not ask again solely because work crossed a tool, command, or session boundary.

Before a delayed action executes, revalidate the approved inputs and applicable permission policy.
When a material change exceeds the authorization's scope, obtain authorization for the changed
action. Preserve the prior approval as a record; it does not authorize work outside its scope.
Denial, dismissal, timeout, and unavailable UI do not grant permission. Report an enforcement
failure without silently retrying through a less restricted execution path.

For unattended or scheduled work, define the permitted actions before starting. When execution
requires new approval, pause or return a blocked outcome through the available interface. Do not
wait indefinitely for input the execution mode cannot receive.

## Keep credentials within the integration that owns them (Conditional)

When an integration uses credentials, select them for the intended account and destination. Keep
secrets out of prompts, tool details, saved session entries, and diagnostic logs. Pass children only
the credentials their authorized work requires. On reconnect or endpoint changes, revalidate the
account and destination before sending data or executing queued actions.

## Verify authorization at the execution boundary (Required)

For permission-sensitive operations, test allowed execution, denial, unavailable approval UI, and a
target or state change between approval and execution. Verify that alternate tool and subprocess
paths enforce the same policy. For trusted configuration, exercise trusted and untrusted projects,
including a session switch to a different working directory.
