# @fire/common

This package is dedicated to **types** and **small utilities** shared across the monorepo.

## Guidelines

- **No External Dependencies**: This package should remain lightweight and dependency-free
- **No Complex Logic**: Keep business logic in the services. Only pure functions and simple helpers should reside here.
- **Types First**: The primary purpose is to share TypeScript interfaces and types (e.g., `IS` for Incident State).
