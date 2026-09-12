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

# Apply safe lint fixes, then format.
fix:
    pnpm lint --fix
    pnpm format

# Run the test suite.
test:
    pnpm test
