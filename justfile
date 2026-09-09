[private]
default: list

[private]
list:
    @just --list

# Install workspace dependencies.
install:
    pnpm install

# Scaffold a new extension package.
new name:
    pnpm new:extension {{ name }}

# Run formatting, linting, type checks, and tests.
check:
    pnpm check

# Format source files.
format:
    pnpm format

# Check source formatting without writing changes.
format-check:
    pnpm format:check

# Run lint checks.
lint:
    pnpm lint

# Run workspace type checks.
typecheck:
    pnpm typecheck

# Run the test suite.
test:
    pnpm test

# Run the test suite in watch mode.
test-watch:
    pnpm test:watch

# Check the root TypeScript project.
typecheck-root:
    pnpm typecheck:root
