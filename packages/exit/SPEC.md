# @orbis/exit specification

Status: Defined contract.

`@orbis/exit` adds `/exit` to quit Pi, the coding-agent host that loads the extension. This
specification is for independent implementers using Pi's public extension API. Graceful shutdown
means requesting that Pi end the session through its own shutdown lifecycle; Pi owns the timing and
cleanup.

## Command contract

### REQ-command-registration — Command registration

The extension registers `/exit`. Invoking the command requests graceful shutdown through the command
context's `shutdown()` method.

### REQ-shutdown-lifecycle — Shutdown lifecycle

The extension delegates shutdown timing and cleanup events to Pi. It does not terminate the host
process directly. When Pi is busy, Pi determines when shutdown proceeds.

### REQ-command-boundaries — Command boundaries

The command ignores additional arguments and has no configuration or package-owned persistent state.

Internal organization and command description wording are implementation choices.

## Conformance

Conformance requires all requirements. These checks define expected outcomes; their presence does
not establish that an implementation has passed them.

- **REQ-command-registration:** Loading the extension registers an `exit` command. Invoking its
  handler requests shutdown once and resolves.
- **REQ-shutdown-lifecycle:** Invoking the handler does not terminate the test process directly. In
  a real interactive Pi session, invoking `/exit` follows Pi's graceful shutdown lifecycle,
  including session cleanup and Pi's behavior while busy.
- **REQ-command-boundaries:** Supplying command arguments preserves the same shutdown behavior. Code
  inspection confirms that the extension does not require configuration or write package-owned
  persistent state.
