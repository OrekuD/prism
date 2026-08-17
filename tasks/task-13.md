# Task 13: Move workspaces to Better Auth Organizations

**Status:** In progress  
**Created:** 2026-08-16  
**Depends on:** Task 3 Better Auth migration, Task 10 ingest identity work  
**Scope:** API, web auth client, database schema/migrations, workspace/project
authorization, source-aware ingestion keys, and focused tests

## Goal

Make Better Auth's Organization plugin the single authority for Prism
workspaces, workspace membership, roles, invitations, active-workspace state,
and workspace profile metadata.

Prism continues to own its product domain:

- Projects belong to one Better Auth organization.
- A project represents one logical product in one environment, such as
  `Acme product - production`.
- Sources represent installations that send data to that project, such as a
  web app, iOS app, Android app, React Native app, or server API.
- Ingestion keys belong to one source and resolve to its parent project.
- Events, people, sessions, dashboards, and real-time connections remain
  project-scoped Prism data.

This replaces the legacy in-app `teams` implementation. In product copy and
UI, call an Organization a **workspace**. Do not introduce Better Auth's
optional nested Teams plugin: Prism has no need for nested workgroups yet.

## Why this work exists

The current code has Better Auth for identity, but a parallel Prism-owned
workspace system:

- `TeamsController` manages workspace CRUD, membership, and invitations.
- `teams`, `team_members`, `team_invites`, and `team_avatars` duplicate the
  Organization plugin's durable data model.
- Prism issues and validates its own invitation JWTs despite Better Auth having
  a supported invitation lifecycle.

Keeping both systems creates two sources of truth for access decisions. It
will also make the product sidebar's workspace switcher, project ownership,
and future observability modules harder to secure consistently.

This task intentionally supersedes Task 3's earlier decision to keep teams,
membership, and invites application-owned. That was appropriate before Better
Auth was adopted as the primary auth foundation. It is no longer the desired
architecture.

## Architecture decision

```text
Better Auth Organization plugin
  organization, member, invitation, active organization in session
                 │
                 ▼
Prism project domain
  projects.organization_id -> organization.id
  project_sources.project_id -> projects.id
  project_api_keys.source_id -> project_sources.id
                 │
                 ▼
Prism analytics domain
  events and sessions retain project_id and source_id; people remain shared
  across sources within the project
```

Rules:

- Better Auth is authoritative for workspace membership and roles. No Prism
  controller, route, table, or JWT may be a competing authority for them.
- Every project authorization decision derives the project organization and a
  Better Auth membership. Never trust a client-supplied organization ID.
- An ingestion key is valid for exactly one source, and therefore exactly one
  project. Its key row must not hold a redundant project or organization ID
  that could disagree with the source relationship.
- A source identifies the data producer and SDK configuration, not a user or
  permission boundary. It automatically supplies canonical source/platform
  context on accepted telemetry; client event properties cannot override it.
- Workspace administrators and owners manage membership through Better Auth.
  Prism's product authorization may map Better Auth roles to product actions,
  but it must not recreate membership or invitation state.
- Existing project and analytics table names stay Prism-owned. Only their
  tenant foreign key changes from `team_id` to `organization_id`.

## Pre-launch destructive migration policy

Prism is not launched and there is no production tenant data to preserve. This
task is therefore allowed to remove the obsolete workspace tables and reset
dependent development/test data instead of carrying a compatibility layer.

- Use a normal, checked-in forward Drizzle migration. Do not mutate schemas at
  runtime.
- The migration may clear pre-launch `projects`, `project_sources`, and
  `project_api_keys` before their tenant/key relationships are rebuilt. It may
  also clear local fixture data that references those project IDs.
- Remove `teams`, `team_members`, `team_invites`, `team_avatars`, their
  constraints/indexes, and the legacy invite-token implementation.
- Do not write a best-effort production data mapper or retain legacy tables
  "just in case." If this has not shipped when a deployment is prepared, stop
  and create a separate, reviewed live-data migration plan.
- Document the reset in the migration and local-development release notes so a
  contributor knows their local workspace/project fixtures are intentionally
  recreated.

## Target data model

Better Auth's generated Organization schema provides the canonical
organization, member, and invitation records. Its exact SQL must be generated
from the installed Better Auth version, reviewed, and committed with the
migration rather than handwritten from assumed column names.

Prism schema after migration:

| Table | Required ownership rule |
| --- | --- |
| `projects` | `organization_id` is non-null, references Better Auth `organization.id`, and participates in tenant queries. |
| `project_sources` | Each source has a non-null `project_id`, display name, and supported platform/SDK kind. It is deleted with its project. |
| `project_api_keys` | `source_id` is non-null, references `project_sources.id`, and `key` remains globally unique. Remove legacy `team_id` and direct `project_id`; do not add `organization_id`. |
| Analytics tables | Retain `project_id` and persist trusted `source_id` on source-originated events and sessions. They inherit tenancy from the project and must be removed when a project is removed. |

Use the following source/key contract:

| Source | Key visibility | Capability |
| --- | --- | --- |
| Web, iOS, Android, React Native | Publishable | Write telemetry only. It cannot read data, administer a project, or impersonate a dashboard user. |
| Server API | Secret | Write telemetry only. It remains outside client bundles and may be rotated independently. |

A source can have multiple active keys only to support safe rotation. Every
key has a name, creation metadata, last-used metadata, status, and an explicit
key type. Creating a source creates the correct initial key, which Prism shows
once. Revoking a key never changes another source's installation.

Use the plugin's supported role model initially: `owner`, `admin`, and
`member`. Establish a single server-side product-action mapping, at minimum:

| Action | Owner | Admin | Member |
| --- | :---: | :---: | :---: |
| Read workspace/project analytics | Yes | Yes | Yes |
| Create, rename, or delete projects | Yes | Yes | No |
| Create, revoke, or reveal source ingestion keys | Yes | Yes | No |
| Invite/remove members and change roles | Yes | Yes, subject to Better Auth policy | No |
| Delete workspace / transfer ownership | Yes | No | No |

If Better Auth's supported role policy needs a deliberate override to express
this matrix, configure it once in the Organization plugin and cover it with
tests. Do not preserve `permission_id` as a shadow authorization system.

## Required implementation work

### 1. Enable the Better Auth Organization plugin

- [x] Add the Organization plugin to `apps/api/src/auth/options.ts` with the
      supported configuration for workspace creation, invitations, roles, and
      trusted origins.
- [x] Add the matching `organizationClient()` plugin to
      `apps/web/src/lib/authClient.ts`.
- [x] Generate and review the Better Auth schema/migration for the installed
      package version. Ensure the new organization tables are available to the
      existing Drizzle database schema without hand-maintained duplicate types.
- [x] Decide and implement one supported personal-workspace provisioning path:
      a new user receives one owner organization without direct client control
      of its owner ID. Prefer Better Auth's server API/hook path over direct
      ad-hoc inserts into its plugin tables.
- [x] Support active-workspace selection through Better Auth and expose it to
      the web app. It must survive a normal session refresh.

### 2. Replace the legacy workspace schema

- [x] Add a forward pre-launch migration that installs the generated Better
      Auth organization schema and removes the legacy team schema.
- [x] Reset the pre-launch projects/key fixtures as needed, then make
      `projects.organization_id` non-null with a foreign key to the Better
      Auth organization table.
- [x] Create the `project_sources` table before `project_api_keys`. Its
      platform value must select the appropriate install instructions and key
      visibility without letting callers choose arbitrary capabilities.
- [x] Remove `project_api_keys.team_id` and direct `project_id`; make
      `source_id` non-null; retain a unique key index and source foreign key.
- [x] Replace the currently uncommitted Task 13 migration with this source
      schema. Do not add a follow-up migration solely to preserve the
      superseded pre-launch project-key shape.
- [x] Persist trusted source IDs on accepted events and source-originated
      sessions. Existing client payload fields must not override their source
      or platform identity.
- [x] Delete the legacy Drizzle team schemas and update all schema exports,
      fixtures, and type references.
- [x] Verify fresh database creation and migration from the current pre-launch
      database state. The migration must not depend on a manually prepared
      local database.

### 3. Replace controllers and authorization boundaries

- [x] Remove `TeamsController`, `TeamsRouter`, custom workspace invitation
      routes, invitation JWT signing/verification, and tests that define their
      old contract.
- [x] Use Better Auth Organization APIs/client methods for workspace creation,
      listing, switching, member management, invitations, acceptance, and
      cancellation. Prism may supply UI composition but not a second
      persistence/controller layer for these entities.
- [x] Refactor `ProjectsController` from team checks to a focused
      organization-membership authorization helper backed by Better Auth's
      canonical tables/API.
- [x] Refactor `PeopleController`, WebSocket subscription authorization, and
      every other project-to-team query to resolve `project.organization_id`
      and Better Auth membership instead.
- [x] Add source management and source-key management behind project
      organization authorization. A key lookup must resolve source first, then
      project, rather than accepting a project identifier from an SDK.
- [x] Update authentication middleware comments/types so they accurately state
      that Better Auth owns workspace authorization state.
- [x] Ensure organization/project deletion cascades or explicitly cleans up
      Prism project data. No orphan project, key, or analytics access may
      remain after access is removed.

### 4. Update the web application

- [x] Replace Team terminology with Workspace terminology where it describes
      the tenant, without renaming Prism's domain `project` concepts.
- [x] Build the workspace switcher on Better Auth's active organization state.
- [x] Build workspace member and invitation screens with Better Auth client
      APIs and user-safe errors/states; do not call removed `/teams` routes.
- [x] Add a project **Sources** page. It lists each source's platform, SDK,
      connection state, recent telemetry, and key status, then links to setup
      and rotation actions.
- [x] Put source-key setup and rotation inside the source detail. Do not use a
      standalone project **API keys** page as the primary workflow.
- [x] Show the source-specific SDK install/init snippet. It includes only the
      source's publishable or secret ingestion key and never asks the SDK user
      to supply a project or organization ID.
- [ ] Reconcile the product sidebar spec in `engineering/design-system.md`
      during its implementation: Workspace/Manage pages must use this new
      source of truth, while future Analyze/Diagnose/Ship groups remain hidden
      until their features exist.

### 5. Remove dead code and update documentation

- [x] Remove no-longer-used invite-token dependencies, environment variables,
      helpers, and test fixtures only after confirming they have no other use.
- [ ] Update the API/auth architecture docs and local development instructions
      with the workspace ownership decision and destructive pre-launch reset.
- [ ] Preserve Task 3 as historical context; add a concise cross-reference
      noting that Task 13 supersedes only its legacy workspace-ownership
      decision.

## Security and behavior requirements

- All organization/project actions require a verified Better Auth session.
- Project IDs alone never grant cross-workspace access. Test owner, admin,
  member, non-member, and unauthenticated cases.
- Never authorize from an organization ID supplied in a request body/query
  without proving membership to the project's organization server-side.
- Browser code holds no Organization admin secret. It uses Better Auth's
  session-bound client APIs.
- Invitation acceptance, expiry, cancellation, resend, role changes, and
  final-owner safeguards use Better Auth's supported behavior and are never
  rebuilt with a Prism-signed JWT.
- WebSocket authentication must prove membership before subscribing to a
  project channel; a valid session from another workspace is insufficient.
- Ingestion uses a source key, not a user session. The key maps to one source
  and, through that source, exactly one project; it cannot write to another
  source's or project's analytics.
- Publishable client keys are expected to be visible in browser and mobile
  binaries. They are telemetry-write-only, rate-limited, auditable, and
  revocable. Browser sources also enforce an explicit allowed-origin policy.
- Secret server keys never appear in client setup snippets, browser bundles,
  screenshots, fixtures, or logs.
- Errors must not reveal whether another workspace, project, or invite exists
  to an unauthorized user.

## Test plan

Write focused tests before each behavior change. Do not substitute a broad
repository run for these boundary tests.

### Database/migration

- [x] Fresh migrated database contains Better Auth organization tables and no
      legacy `teams`/membership/invite/avatar tables.
- [x] Migration from the current pre-launch schema completes after the
      documented reset and leaves valid project/key constraints.
- [x] A project cannot exist without an organization; a source cannot exist
      without a project; a key cannot exist without a source; duplicate raw
      keys are rejected.

### Organization and projects

- [x] New user gets an owner workspace through the supported provisioning
      path, and can make it active.
- [x] An owner/admin can create and manage a project in their workspace.
- [x] A member can read allowed project data but cannot perform restricted
      project/key changes.
- [x] A user outside the organization receives the correct non-disclosing
      response for every project route.
- [x] Switching active workspace never changes access to an explicitly scoped
      project without a membership check.
- [x] Organization invitations and role changes work through Better Auth; no
      legacy route or invitation token is reachable.

### Analytics and realtime

- [x] A source key records data only for its source's project and attaches the
      expected source/platform context despite a conflicting client payload.
- [x] A publishable web key accepts only its configured origins. A secret
      server key is never returned by a browser-facing API.
- [x] Rotating or revoking one source key does not interrupt another source.
- [x] Project dashboard/people queries cannot cross organization boundaries.
- [x] WebSocket subscribe succeeds for an authorized project member and fails
      for a non-member, even with a valid Better Auth session.
- [ ] Deleting a project or removing access leaves no usable key or live
      subscription for it.

### Verification gates

The current Task 13 gate is focused on application behavior and the checked-in
schema migration. Deployment-only checks remain pending under the deferred
work section below and must not block this task's focused implementation gate.

- [x] Run only the affected API, analytics API, and web tests while iterating.
- [ ] Before closure, run the repository's documented targeted typecheck,
      lint, build, and migration verification commands and record exact
      results here.
- [ ] Review migration SQL and the final diff for accidental tenant-data loss
      beyond the explicitly authorized pre-launch reset.

### Deferred future deployment work

These checks are intentionally outside the current Task 13 scope. Keep them
pending for the future deployment and release pass; do not use them as a
focused application-implementation blocker.

- [ ] **Deferred:** run the disposable Docker/nginx public-origin ingestion
      certification (`scripts/certify-v2-ingest.mjs`) after the deployment
      image and routing configuration stabilizes.
- [ ] **Deferred:** rebuild the deployment images and complete the public-origin
      release smoke test, including source-key authentication and trusted
      source/platform persistence.
- [ ] **Deferred:** review the pre-launch reset and any live-data migration
      plan before the first production deployment.

## Implementation sequence

1. Confirm the installed Better Auth Organization plugin/schema contract and
   record the generated SQL shape.
2. Add focused failing authorization/provisioning tests.
3. Enable matching server/client plugins and implement personal/active
   workspace behavior.
4. Add and test the destructive pre-launch schema migration.
5. Add source/key creation, source-aware ingestion, and source context
   persistence before publishing SDK setup instructions.
6. Refactor project, people, and websocket authorization to organization
   membership.
7. Remove the legacy team routes/controllers/tables/tokens and update the web
   workspace and source screens.
8. Run the targeted verification gates, inspect the final migration/diff, and
   record results in this task.

## Definition of done

- [x] Better Auth Organization is the only persistent authority for Prism
      workspaces, membership, roles, invitations, and active workspace.
- [x] The legacy team tables, controller/router, invitation JWT flow, and
      redundant key tenant/project columns are gone.
- [x] Projects, sources, and source keys have the target tenant/ingestion
      model. Organization boundaries are enforced server-side and over
      WebSockets.
- [x] Each supported SDK source has an isolated setup/rotation workflow and
      trusted source context in its accepted telemetry.
- [x] Workspace/project UI uses the Better Auth client and clear workspace
      language.
- [x] The destructive pre-launch reset is explicit, tested, and documented.
- [ ] Focused test coverage and final verification evidence are recorded.

## Progress log

### 2026-08-16 - task created

- Confirmed the current application has Better Auth identity/session support
  but does not enable its Organization plugin.
- Confirmed current project API keys are project-scoped in ingestion behavior,
  although the legacy schema redundantly stores `team_id` and allows multiple
  keys per project. This initial shape is superseded below by source keys.
- Chosen target: Better Auth Organization equals Prism workspace. Prism
  projects and project-scoped keys remain application-owned.
- Authorized by product owner: pre-launch legacy workspace tables and
  dependent local data may be removed/reset as part of a checked-in migration.

### 2026-08-16 - Better Auth organization contract confirmed

- Confirmed against the installed Better Auth version that the Organization
  plugin's base schema is `organization`, `member`, and `invitation`, and it
  adds `activeOrganizationId` to the `session` record.
- Confirmed the plugin's nested Teams support is optional. It will remain
  disabled: Better Auth Organization maps directly to Prism workspace.
- Confirmed the plugin supplies the default `owner`, `admin`, and `member`
  roles and a matching browser `organizationClient()` plugin.

### 2026-08-16 - Source-aware ingestion model added before implementation

- A Prism project is now the shared product/environment data boundary, not an
  SDK installation. Web, mobile, and server installations are sources beneath
  that project.
- The pending uncommitted migration and key work must use `project_sources`
  and source-bound ingestion keys. Do not complete the superseded direct
  `project_api_keys.project_id` design.
- The project sidebar's initial configuration destination is **Sources**.
  Source detail owns SDK setup, the ingestion key, allowed origins where
  applicable, and rotation.

### 2026-08-17 - Deployment and certification work deferred

- The current Task 13 scope excludes deployment-only verification and the
  public-origin certification. Those items remain explicitly pending for a
  future release pass.
- Focused API, analytics API, web, migration, typecheck, lint, and build work
  can proceed without treating the disposable deployment certification as a
  blocker.
