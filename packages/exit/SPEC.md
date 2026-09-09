# @orbis/exit specification

Status: Defined contract.

This document specifies a Pi extension for users who want `/exit` to quit Pi.
An independent implementation must satisfy the requirements below through Pi's
public extension API.

## Command contract

- **REQ-001:** The extension registers `/exit`. Invoking the command requests
  graceful shutdown through the command context's `shutdown()` method.
- **REQ-002:** The extension delegates shutdown timing and cleanup events to Pi.
  It does not terminate the host process directly. When Pi is busy, Pi determines
  when shutdown proceeds.
- **REQ-003:** The command ignores additional arguments and has no configuration
  or package-owned persistent state.

## Conformance

Conformance requires all requirements. These checks define expected outcomes;
their presence does not establish that an implementation has passed them.

- **REQ-001:** Loading the extension registers an `exit` command. Invoking its
  handler requests shutdown once and resolves.
- **REQ-002:** Invoking the handler does not terminate the test process directly.
  In a real interactive Pi session, invoking `/exit` follows Pi's graceful
  shutdown lifecycle, including session cleanup and Pi's behavior while busy.
- **REQ-003:** Supplying command arguments preserves the same shutdown behavior.
  Code inspection confirms that the extension does not require configuration or
  write package-owned persistent state.

Internal organization and command description wording are implementation choices.
