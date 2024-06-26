# Turborepo kitchen sink starter

This is an official starter Turborepo with multiple meta-frameworks all working in harmony and sharing packages.

This example also shows how to use [Workspace Configurations](https://turbo.build/repo/docs/core-concepts/monorepos/configuring-workspaces).

## Using this example

Run the following command:

```sh
npx create-turbo@latest -e kitchen-sink
```

## What's inside?

This Turborepo includes the following packages and apps:

### Apps and Packages

- `api`: an [Cloudflare Worker](https://workers.cloudflare.com/) server
- `web`: a [Vite](https://vitejs.dev/) single page app
- `docs`: a [Astro Starlight](https://starlight.astro.build/) blog
- `@repo/jest-presets`: Jest configurations
- `@repo/logger`: isomorphic logger (a small wrapper around console.log)
- `@repo/typescript-config`: tsconfig.json's used throughout the monorepo

Each package and app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Jest](https://jestjs.io) test runner for all things JavaScript
- [Prettier](https://prettier.io) for code formatting
