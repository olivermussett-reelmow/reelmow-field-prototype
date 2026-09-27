# REELMOW UX 1.0 — Product Experience Standard

## North star

REELMOW should feel like a purpose-built field tool, not a database wrapped in a web interface.

A groundsman should be able to answer three questions immediately:

1. What needs my attention?
2. What can I do right now?
3. What happened to the machine?

The interface should reduce cognitive load while preserving operational depth.

## Design principles

### 1. Clarity before decoration
Every screen has one primary job. Hierarchy, spacing and contrast make the important thing obvious.

### 2. Action follows context
Show the next useful action beside the information that creates the need for it. Avoid making users navigate through menus to complete obvious work.

### 3. Progressive disclosure
Expose operational essentials first. Detailed specifications, history and administrative metadata remain available without dominating the working view.

### 4. Field-first interaction
Design for phones, sunlight, gloves, movement, imperfect connectivity and one-handed use. Touch targets are generous and destructive actions are deliberate.

### 5. Physical-world mental model
Machines, mowing jobs, service tasks and faults are treated as real-world objects and events. The UI should describe work in groundsman's language rather than database terminology.

### 6. Calm status
Colour communicates state, not decoration. Green means ready/healthy, amber means attention, red means fault, neutral means unknown/history. Status must never rely on colour alone.

### 7. Fast path for frequent work
Mowing, recording hours, recording service and reporting a problem should be reachable immediately. Rare administrative functions should stay out of the primary path.

### 8. Feedback is part of the interaction
Every meaningful action needs an immediate, understandable response: pressed state, progress, success, failure or pending-sync state.

### 9. Trust through precision
Numbers, dates, units, maintenance state and machine status must be unambiguous. Never claim the fleet is healthy when the system does not have enough history to know.

### 10. Remove before adding
When a screen becomes crowded, simplify hierarchy and remove low-value content before adding another component.

## Visual direction

- Restrained deep green foundation with a fresh field accent.
- Warm/neutral surfaces rather than clinical white everywhere.
- Large, confident typography for primary information.
- Softer geometry, but fewer gratuitous cards.
- Strong alignment and consistent spacing.
- Subtle motion only where it communicates state.
- System-native typography and familiar interaction patterns.
- Icons should be consistent and meaningful; avoid emoji as UI controls.

## Navigation model

Primary mobile navigation:

- Today — what matters now
- Garage — machines
- Activity — operational history
- Profile — workspace/account

Mow Mode is a task mode, not a destination. It should be launched contextually and take over the interface while active.

## Screen standards

### Today
Purpose: decide what to do next.

Priority:
1. Attention / operational risk
2. Start or continue today's work
3. Quick actions
4. Fleet snapshot
5. Secondary history

### Garage
Purpose: understand fleet state.

Priority:
1. Fleet availability
2. Machines needing action
3. Search/filter
4. Machine cards

### Machine
Purpose: operate and understand one physical asset.

Priority:
1. Machine identity + availability
2. Primary actions: Mow, Hours, Service, Report problem
3. Health / maintenance
4. Faults
5. History
6. Evidence and documents
7. Catalogue specifications

### Mow Mode
Purpose: record the job without distracting the operator.

Priority:
1. Tracking state / GPS quality
2. Time
3. Distance
4. Speed
5. Pattern
6. Map/track
7. Pause / Finish

## UX quality bar

A change is not accepted because it works technically.

It should also pass:

- Can a first-time groundsman understand the screen without explanation?
- Is the primary action obvious within two seconds?
- Can the task be completed with minimal typing?
- Does the UI remain usable outdoors?
- Does every important state have a clear visual and textual representation?
- Does the interaction behave consistently with the rest of REELMOW?
- Does the change reduce or increase cognitive load?
- Does it make REELMOW feel more like a specialist product rather than a generic CRUD application?

## Inspiration principles

REELMOW borrows principles, not visual copies: Apple's clarity, hierarchy, platform conventions and interaction feedback; Linear's context-sensitive actions and command-oriented thinking; modern field-service products' emphasis on operational status and rapid task completion.

The product should have its own identity.
