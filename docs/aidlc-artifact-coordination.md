# AI-DLC Artifact Coordination: Problem Analysis and Proposed Solutions

## 1. Problem Statement

When using the AI-DLC methodology, all workflow artifacts (user stories, NFRs, risks, unit decompositions, bolt plans, domain designs, etc.) are stored as markdown files in an `aidlc-docs/` folder checked into the project git repository. This replaces traditional tracking tools like Azure DevOps Boards.

The white paper's primary execution model is **Mob Construction** — the whole team on one call with a single facilitator driving the AI. In this model, work assignment happens verbally in real-time during the session, so there's no coordination problem.

However, when teams move to **independent async work** (which is inevitable — the analysis doc itself mentions "developers work independently on remaining Bolts"), a critical gap emerges:

**Scenario:** Mob Elaboration is complete. All artifacts are committed to the repo. All developers pull the latest. The `aidlc-docs/` folder shows UNIT-001 through UNIT-004, all with status "pending" (no Bolts started). Developer 1 decides to start UNIT-001. Developer 2 also starts UNIT-001. Neither developer knows the other has started because:
- There is no real-time shared state (like a board where you drag a card to "In Progress")
- Git artifacts only become visible to others after commit + push
- There is nothing in the `aidlc-docs/` folder structure that signals "someone is working on this"

In Scrum with Azure DevOps, this is trivially solved: Developer 1 moves the card to "In Progress" and Developer 2 sees it immediately. With repository-based artifact tracking, hours of duplicated work could happen before anyone notices.

**The white paper does not address this problem.** It relies on:
1. Mob Construction being the default (synchronous coordination)
2. Bolts being short (hours, reducing the collision window)
3. Small teams (5-10 people) where informal Slack messages suffice

None of these are explicit solutions — they're structural properties that make the problem less likely but don't eliminate it.

## 2. Core Insight

The problem is NOT about syncing artifact file contents in real-time. Git handles file content synchronization adequately — artifacts are written during Mob sessions (one writer) or during Bolt execution (isolated by Unit path).

The actual problem is narrower: **"Who is working on what right now?"** This is a **presence and assignment** problem requiring:
1. A way to **claim** a Unit/Bolt ("I'm taking UNIT-001")
2. A way to **see** who's claimed what, ideally in real-time

## 3. Options Considered

### Option 1: Use an Existing Tool for Assignment (Simplest, No Engineering)

Keep `aidlc-docs/` as the source of truth for artifact content. Use GitHub Projects, Linear, or Azure DevOps **only** for Unit/Bolt assignment visibility. Each Unit becomes an Issue. Developers self-assign. Everyone sees assignment status immediately.

```
aidlc-docs/          → source of truth for CONTENT (git)
GitHub Projects       → source of truth for ASSIGNMENT (real-time)
```

**Pros:**
- Works today with zero engineering effort
- Leverages existing real-time collaboration tools
- Familiar UX for teams coming from Scrum

**Cons:**
- Two systems to maintain — developers must check both
- Feels like re-introducing the board that AI-DLC was supposed to replace
- Assignment state and artifact state can drift apart

### Option 2: Lightweight Status File + Olympus CLI Command (Selected)

Add a `status.json` file to `aidlc-docs/` that tracks Unit/Bolt assignment:

```json
{
  "units": {
    "UNIT-001": {
      "assignee": "mike",
      "status": "in_progress",
      "started": "2026-02-18T10:30:00Z",
      "bolt": "BOLT-001"
    },
    "UNIT-002": {
      "assignee": null,
      "status": "pending",
      "started": null,
      "bolt": null
    }
  }
}
```

Olympus CLI commands for coordination:
- `olympus claim UNIT-001` — writes to status.json, commits, pushes
- `olympus release UNIT-001` — releases the claim
- `olympus status` — shows who's working on what

Before starting work, developers run `olympus status` (or it runs automatically at session start). If a Unit is already claimed, they see it and pick a different one.

**Pros:**
- Single system — everything lives in the repo
- Fits naturally into the Olympus CLI workflow
- No external infrastructure needed
- Status file is human-readable and version-controlled
- Can be extended later (auto-claim on Bolt start, auto-release on Bolt complete)

**Cons:**
- Not truly real-time — there's a small race condition window between `git pull` and `git push`
- Developers must remember to run `olympus status` before starting (can be mitigated by auto-check on session start)
- Git conflicts on `status.json` are possible if two developers claim simultaneously (resolvable but annoying)

**Mitigations for the race condition:**
- The window is small (seconds) and the team is small (5-10 people)
- An automatic `git pull` before `olympus claim` reduces the window further
- If a conflict is detected on push, the CLI can abort and notify: "UNIT-001 was just claimed by Sarah. Run `olympus status` to see available units."

### Option 3: VS Code Extension with Live Coordination Panel (Most Ambitious)

Build a VS Code panel that shows real-time Unit/Bolt assignment:

```
┌─────────────────────────────────────┐
│  AIDLC Workflow: Customer Portal    │
├─────────────────────────────────────┤
│  UNIT-001: Invoice Mgmt            │
│    ● Mike (active now)              │
│    BOLT-001: ██████░░ 60%           │
│                                     │
│  UNIT-002: Subscription Mgmt       │
│    ○ Unclaimed                      │
│                                     │
│  UNIT-003: Payment Methods          │
│    ● Sarah (active now)             │
│    BOLT-006: ████████ Done          │
│                                     │
│  [Claim Unit]  [Release Unit]       │
└─────────────────────────────────────┘
```

Backend: shared JSON on Firebase Realtime Database, Supabase, or a polled GitHub Gist. No WebSocket server needed. Poll every 30 seconds; refresh on VS Code window focus.

**Pros:**
- True real-time visibility — no git race conditions
- Best developer experience — see status without running commands
- Could show richer information (progress bars, active time, blockers)

**Cons:**
- Requires external infrastructure (Firebase/Supabase account)
- Significantly more engineering effort
- New dependency to maintain
- Authentication and team management needed

## 4. Decision

**Selected: Option 2** — Lightweight status file with Olympus CLI commands.

**Rationale:** It's the simplest solution that solves the actual problem, requires no infrastructure, and fits naturally into the Olympus workflow. If the race condition or "forgot to check status" problem proves significant in practice, we can graduate to Option 3 with real usage data about what coordination information developers actually need.

## 5. Prerequisites

Before implementing Option 2, Olympus needs refactoring work to support the new coordination features. This refactoring should be planned and executed first.

## 6. Future Considerations

- Auto-claim when a developer starts a Bolt via Olympus workflow
- Auto-release when a Bolt completes or a session ends
- Integration with the `/workflow-status` command to show assignment alongside workflow progress
- Notification hooks (Slack/Teams) when a Unit is claimed or released
- Graduation path to Option 3 if needed
