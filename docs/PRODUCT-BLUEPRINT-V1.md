# REELMOW Product Blueprint V1

Status: Product direction / engineering blueprint
Date: 26 September 2026
Scope: Mobile-first field product + web management command centre

## 1. Product thesis
REELMOW is not primarily machinery-management software. It is a field operating system for grounds teams: a product connecting machinery, maintenance, mowing activity and ground history, then turning that information into the next useful action.

Product promise: REELMOW knows your machinery, knows your ground, and helps you keep both in order.

Field promise: make the work faster and easier.
Manager promise: make the operation visible and controllable.
Platform promise: connect the two without creating administration.

## 2. Product principles
1. Action before information.
2. Mobile first; the field experience is the primary product.
3. Desktop is for management, planning, analysis and administration.
4. Progressive disclosure: simple by default, specialist detail on demand.
5. Recognition over recall: reuse known machines, locations, intervals and values.
6. Capture once, reuse everywhere.
7. Minimal typing; favour camera, GPS, presets and remembered values.
8. Design for gloves, sunlight, rain, one-handed use and poor connectivity.
9. AI extracts evidence; users remain authoritative for canonical identity.
10. Calm software: useful alerts, little noise.
11. Immediate feedback after important actions.
12. Offline is a product requirement, not an afterthought.
13. Data model outlives the UI.
14. Do not build features simply because they are technically possible.

## 3. Target users
### Grounds operator
Primary mobile user. Needs to know what to do, update hours, service machines, report faults and capture evidence with minimal administration.
### Volunteer / occasional operator
Needs obvious actions and guided workflows with little training.
### Grounds / estates manager
Primarily web. Needs fleet health, service compliance, utilisation, faults, costs, activity and reports.
### Organisation administrator
Needs people, permissions, assets, documents, auditability and settings.
### Contractor
Potential later segment requiring multi-site customers, jobs, utilisation and reporting.

## 4. Core product loop
Open → understand → act → capture → update → recommend → return.
A single action should update history, schedules, KPIs, audit records and management views wherever appropriate.

## 5. Mobile architecture
Primary navigation: Today | Garage | Ground | Activity | Profile.
Persistent primary action: +.
Quick actions: Scan machine, Update hours, Record service, Start mowing, Report problem, Add machine, Capture evidence.

Today answers: What should I do now?
Garage answers: What machinery do we have?
Ground answers: What are we doing to the ground?
Activity answers: What happened?
Profile answers: Who am I and which organisation am I working in?

## 6. Web architecture
Web should not simply be a stretched mobile UI.
Recommended manager navigation: Overview, Fleet, Machines, Services, Grounds, Activity, Documents, Costs, Reports, People, Settings.
Optimise web for comparison, filtering, bulk actions, charts, reporting, planning and administration.

## 7. Machine experience
A machine is a persistent operational object, not a database record.
Machine profile should expose: image, identity, nickname, status, hours, service health, location, primary actions, specifications, service schedule, service history, documents, photos and timeline.
Preferred future add-machine flow: Take photo → identify → confirm → nickname/location → done.

## 8. Service experience
Service should feel like completing a task, not completing a form.
Record service: confirm task → show current hours → confirm date → optional notes → optional evidence → complete.
Completion should automatically update service history, next due position, activity, fleet health and audit history.

## 9. Mow Mode
Mow Mode is a strategic differentiator.
Start: choose ground, machine, cutting height and job/pattern.
During: show elapsed time, area, speed, GPS state, progress, pause and finish.
Finish: save area, duration, machine, ground, pattern, notes and evidence.
Future intelligence: typical duration, frequency, machine utilisation, pattern history and recommended next cut.

## 10. Ground as a first-class object
A ground should have area, map, last cut, machine, cutting height, pattern, duration, history, photos and notes.
Future: boundaries, GPS tracks, mowing templates, weather context, ground-condition observations and agronomic history.
Existing Pattern Studio work should be treated as a prototype asset until its user journey is validated.

## 11. Retention
Retention should come from accumulated utility, not artificial engagement.
Users return because machine history, ground history, service schedules, previous work and recommendations are increasingly valuable.
REELMOW should remember machine identity, nickname, location, hours, intervals, services, tasks, documents, photos, ground history and mowing history.

## 12. Notifications
Notifications should be contextual and sparse.
Good examples: service due, service overdue, assigned job, fault requiring attention, offline changes synced, scheduled job reminder.
Avoid generic engagement notifications.

## 13. Offline-first requirement
Before mature field release, the mobile client needs local operational data for assigned machines, latest hours, pending service actions, active mowing jobs, ground boundaries and queued evidence.
Write flow: user action → local commit → immediate UI update → sync queue → server → reconciliation.
Every queued mutation needs a client operation ID, entity ID, operation type, timestamp, payload, retry count and sync status.
Conflict rules must be designed before production Mow Mode.
The current service worker is not sufficient as the offline data layer.

## 14. Current technical assessment
### Strong
The backend is materially stronger than the current UI: catalogue, machine variants, specifications, service tasks/schedules, Garage organisations/memberships, machines, hours, service records, documents, photos, audit events and ingestion/AI extraction are present.
RLS is enabled across the current catalogue, Garage and ingestion tables.
Catalogue search is authenticated-only.
Private evidence is stored privately with signed access.
AI ingestion is separated from canonical catalogue publication.

### Weak / risky
1. Frontend is still a large imperative single-file JavaScript application; UI, state, data access and domain logic are tightly coupled.
2. Mobile-first product architecture is not yet implemented.
3. Service-worker caching is too primitive; cache-first behaviour can serve stale application code after deployments.
4. Supabase JS is loaded from a floating major-version URL and should be pinned before production.
5. There is no formal typed domain/data layer.
6. There is no true offline mutation/sync architecture.
7. There is no comprehensive automated end-to-end test suite.
8. Frontend observability and structured error reporting need to be added.
9. ingest-document deliberately has JWT verification disabled and relies on a private ingestion token; this should receive an explicit threat model before production and ideally become a server-to-server path.
10. Supabase Security Advisor still reports three intentional SECURITY DEFINER Garage wrappers; keep them constrained and tested rather than weakening the architecture merely to silence the warning.
11. Performance Advisor reports unused indexes; revisit after real workload rather than deleting blindly.
12. Catalogue enrichment is incomplete; the LF3800 currently has verified facts but no attached catalogue document.

## 15. Security direction
Keep publishable keys in browser only. Never expose service-role or secret keys.
Keep RLS as the authorisation boundary.
Keep organisation membership and role checks explicit.
Keep evidence storage private and signed URLs short-lived.
Treat AI output as proposed evidence, not truth.
Before production, test organisation isolation, privilege escalation, object-level access, storage access, session expiry, replay, ingestion abuse and duplicate/offline mutations.

## 16. Data model direction
Keep the current model as the foundation.
Future domain objects should include Ground, Ground Job, Fault, Notification and Sync Operation, introduced only when their corresponding journeys are ready.

## 17. Product metrics
Activation: organisation + Garage + first machine + first meaningful action.
Core value: time to first machine, time to first service, time to first hours update, current-hours coverage, services completed, evidence captured and mowing sessions.
Retention: weekly active field users, active organisations, repeat machine actions, repeat mowing sessions and service compliance.
Quality: workflow completion rate, errors, sync failures, offline queue failures, time to complete core actions and startup/crash failure rate.
Candidate north-star metric: completed operational actions per active organisation, with a high percentage requiring no correction.

## 18. MVP boundary
Must have: authentication, organisation/membership, Garage, catalogue/search, machine creation, machine profile, hours, service, documents/photos, activity history, Today, mobile navigation, responsive manager web and audit trail.
Should have: plate scanning, AI-assisted identification, offline hours/service capture, fault reporting, ground records and a basic mowing session.
Later: live GPS mowing, stripe guidance, advanced utilisation analytics, cost intelligence, weather, parts/inventory, contractor multi-site management and advanced reporting.
Do not build yet: social feed, unnecessary gamification, marketplace, generic CRM, feature-heavy finance or an AI assistant before the underlying data is trustworthy.

## 19. UX quality bar
Clarity: the next action is obvious.
Speed: experienced users complete core actions in seconds.
Physical context: usable outdoors and one-handed.
Error prevention: prevent bad data rather than only rejecting it.
Recovery: recover from interruption, poor signal and mistakes.
Feedback: users know what happened.
Memory: the system remembers useful context.
Trust: users can understand where important information came from.

## 20. Design language
Premium, practical, calm, confident, outdoors-oriented, modern and trustworthy.
Avoid generic enterprise SaaS, excessive gradients, spreadsheet-first mobile layouts, excessive badges, cartoon gamification and fake AI magic.
Use strong typography, generous spacing, large touch targets, restrained brand green, clear severity colours, real machine/ground imagery and map context.

## 21. Development operating model
For every significant feature: Think → Design → Critique → Architect → Build → Test → Review → Release.
Do not move directly from idea to production code.

## 22. Roadmap
Phase 5: Product blueprint — current.
Phase 6: Design system + mobile shell.
Phase 7: Core field workflows.
Phase 8: Manager command centre.
Phase 9: Ground.
Phase 10: Mow Mode.
Phase 11: Offline + native capabilities.
Phase 12: Real-world beta.
Phase 13: App Store + Google Play.

## 23. Immediate next steps
1. Freeze the backend foundation while product UX is defined.
2. Pin frontend dependencies.
3. Replace the current service-worker cache strategy with a safe versioned update strategy.
4. Generate and commit database TypeScript types.
5. Separate data/domain services from UI rendering.
6. Establish mobile-first design tokens and navigation.
7. Build Today.
8. Build the Quick Action system.
9. Rebuild machine profile around actions.
10. Rebuild hours/service as fast field workflows.
11. Add automated E2E coverage.
12. Introduce Ground and Mow Mode only after the core field loop is reliable.

## 24. North star
REELMOW should make a grounds professional say: I don't have to think about managing the machinery. REELMOW just keeps it under control.
It should make a manager say: I can see what is happening across the operation without chasing anyone.

## 25. Definition of world-class
REELMOW is world-class when a new user understands it immediately, an experienced user operates it extremely quickly, it works in real field conditions, managers trust the information, the system remembers useful context, every action improves the next action, and complexity stays underneath the surface.