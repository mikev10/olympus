/**
 * The Vault: the runtime-only store for everything an agent must not be able
 * to alter. I1: no agent writes here, at every level, in every role. Enforced at
 * the mount layer (sandbox MountTable), not in application code.
 *
 * VaultRef and VaultRefKind live in core (run/types.ts) because run state
 * holds them; IntegrityViolation lives in integrity because it produces them.
 * The Vault stores both.
 */
import type {
  AgentClaim, ApprovalKey, AutonomyLevel, BaseRefusalPart, CompiledRole, DraftCondition, DraftRef, DraftStation, IndependenceGrade, ModelIdentity, ModelTier, Policy, PolicyRefusal,
  RejectionReason, RoleId, Run, RunId, RunState, StationId, StationRefusal, TaskId, TaskResult, VaultRef,
  AuthorTrust, CandidateId, FieldDefect, SchemaKind, TemplateId, TriggerAdmissionCause, TriggerLineage,
} from '@olympus-ai/core';
import type { CheckResult, IntegrityViolation, TamperReport } from '@olympus-ai/integrity';
import type { EgressConnection, MeterReading } from '@olympus-ai/sandbox';

/**
 * I3: an agent may not be judged by an artifact it can write. Specs and
 * acceptance tests are hashed into a LockManifest before `build` and
 * re-verified at every station transition; a mismatch is a failing
 * LockVerdict, never a warning.
 */
export interface LockEntry {
  path: string;
  sha256: string;
  lockedAt: string;
  lockedBy: StationId;        // 'spec' or 'test-design'
}

export interface LockManifest { runId: RunId; entries: LockEntry[]; }

export type LockVerdict =
  | { ok: true }
  | { ok: false; tampered: Array<{ path: string; expected: string; actual: string }> };

/** A required or optional check that produced no result, and why. No exit code is invented for it (A-P6-02). */
export interface UnstartedCheck {
  readonly checkId: string;
  readonly reason: string;
}

/**
 * One path the task changed, as the runtime collected it by comparing the tree
 * it handed the task with the tree the task left. `sha256` is the content
 * after the change, or null for a removal (A-P6-03).
 */
export interface DiffEntry {
  readonly path: string;
  readonly change: 'added' | 'removed' | 'modified';
  readonly sha256: string | null;
}

/**
 * The declared checks (D-R15-02) as the runtime ran them over the base, at the
 * `test-design` exit and before any driver was invoked (D-A-BF-01). Written
 * once per run and draft: a resume reads this rather than running them again,
 * so the base a run or a draft was judged against is the one it was first
 * judged against. I2: every field is the runtime's.
 */
export interface BaseRunRecord {
  readonly runId: RunId;
  /**
   * The hash of the test draft whose checks ran over the base plus its files,
   * or null for checks the run was admitted with (R19). A record written
   * before R19 carries none, and is read as null.
   */
  readonly draft: string | null;
  /** The digest of the tree the checks ran over: the base the runtime snapshotted at admission. */
  readonly baseTreeSha256: string;
  /** One result per declared check that produced one, in the manifest's order. */
  readonly checks: readonly CheckResult[];
  /** Every declared check that produced no result, and why; never counted as a failure. */
  readonly unstarted: readonly UnstartedCheck[];
  readonly collectedBy: 'runtime';
}

export interface EvidenceBundle {
  runId: RunId;
  taskId: TaskId;
  baseCommit: string;                 // evidence is void if the base moves
  /** The digest of the tree admitted as base. `baseCommit` alone does not name it: a working copy can differ from its commit (A-P6-03). */
  baseTreeSha256: string;
  /** The declared checks as they ran over the base before build, so review sees each fail before the change and pass after it. */
  baseRun: VaultRef;
  /** What the checks ran over: base, every diff accepted before this task, and this one. */
  diff: readonly DiffEntry[];
  diffSha256: string;
  checks: CheckResult[];
  /** Every check that produced no result. A required one here has failed the gate. */
  unstarted: readonly UnstartedCheck[];
  claim: AgentClaim;                  // stored beside evidence, never merged into it
  claimEvidenceDiff: string[];        // I2: where the model's story and the facts differ
  /**
   * The runtime's reading of this task's diff, over the tree it was handed and
   * the tree it was verified in. Every finding escalates the `integrate` exit;
   * none decides the task's status (A-P7-03).
   */
  tamper: TamperReport;
  /**
   * What the task wrote under `node_modules`, by package directory, none of
   * it carried into the tree the checks ran over: they ran over the base's
   * dependency trees, so the change could not replace the runner judging it
   * (D-R15-05). Every entry escalates the `integrate` exit.
   */
  notCarried: readonly string[];
  collectedBy: 'runtime';             // literal type: no other value is representable
  driverProvenanceId: string;
  contractVersion: string;
}

/**
 * What one driver call cost, as the runtime collected it: the reading the
 * sandbox's relay took after the sandbox stopped (A-P13-03). One per call —
 * every build attempt, a failed one included, and every review seat — so a
 * call that spent money and produced nothing still appears.
 *
 * I2: never taken from the driver's `TaskResult.usage`, which is the CLI's own
 * account from inside the sandbox. `collectedBy` is a literal for the reason
 * `EvidenceBundle`'s is. A call whose sandbox had no relay is `unmetered`, and
 * a total over it says so rather than counting it as free.
 */
export interface UsageRecord {
  runId: RunId;
  taskId: TaskId;
  station: StationId;
  /** The task's `starts` count for this call: which invocation of the task it was. */
  attempt: number;
  /**
   * The model the runtime resolved the call's tier to before it made the call
   * (A-I1a-01). I2: never `TaskResult.model`, the driver's account of itself.
   */
  model: ModelIdentity;
  /**
   * The role the call ran under, as admission pinned it: its id and the hash
   * of the version the run was admitted with (D-A-RC-04). A review seat runs
   * under `reviewer` whatever role its task names. I2: the runtime's, from the
   * admission record, never anything the driver returned.
   */
  role: RoleVersion;
  reading: UsageReading;
  /**
   * When the call ran, by the runtime's clock: `startedAt` before the driver
   * was called, `endedAt` after its sandbox was torn down and read, null on a
   * `pending` record alone (A-R12-01). `not-recorded` is how a record written
   * before R12 is read; the Vault refuses to write one.
   */
  timing: CallTiming | 'not-recorded';
  collectedBy: 'runtime';
}

/** A driver call's start and end, by the runtime's clock (A-R12-01). */
export interface CallTiming {
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** One role at one version: what a call ran under. */
export interface RoleVersion {
  readonly id: RoleId;
  readonly sha256: string;
}

/**
 * What the relay counted, or `lost`: the call was made and its sandbox could
 * not be destroyed and read, so what it cost is unknown (A-I1a-04). A run
 * holding a lost reading is not resumed (D-P13-20).
 *
 * `pending` is written before the call is made, and a terminal reading for the
 * same task and attempt follows it. A `pending` with no terminal reading is a
 * call a process stop took before anything could be read, and is lost
 * (D-I1a-12).
 */
export type UsageReading = MeterReading | { readonly kind: 'lost'; readonly detail: string } | { readonly kind: 'pending' };

/**
 * A refusal returned before a run's first state, as admission returned it
 * (A-P14-01). Each arm keeps the typed fields a reader counts by; nothing here
 * is text a caller sent. An invalid request keeps each problem's path and
 * code and not its message, because a message can quote the request
 * (D-P14-06).
 */
export type AdmissionRefusal =
  | { readonly reason: 'invalid-request'; readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }> }
  | { readonly reason: 'unsafe-above-l1'; readonly requestedLevel: AutonomyLevel; readonly components: readonly string[] }
  | { readonly reason: 'cost-unapproved'; readonly requestedLevel: AutonomyLevel; readonly worstCaseUsd: number; readonly approvedCostUsd: number | null }
  | { readonly reason: 'controls-unavailable'; readonly requestedLevel: AutonomyLevel; readonly unavailable: readonly string[] }
  | { readonly reason: 'policy-refused'; readonly station: StationId; readonly role: RoleId | null; readonly refusal: PolicyRefusal }
  /**
   * The roles directory did not compile (D-A-RC-02). Each entry it refused,
   * by its name in the directory and the compiler's code, and not its
   * message; `.` is the directory itself.
   */
  | { readonly reason: 'roles-refused'; readonly refused: ReadonlyArray<{ readonly entry: string; readonly code: string }> }
  /** A seat with no role: every role the task graph names, and `reviewer`, that the directory does not define (D-A-RC-06). */
  | { readonly reason: 'role-undefined'; readonly roles: readonly RoleId[] }
  | { readonly reason: 'refused'; readonly at: StationId; readonly refusal: StationRefusal }
  /** The trigger policy refused the run's trigger, for any kind, `human` included (A-R22-05, D-R22-06). */
  | { readonly reason: 'trigger-refused'; readonly cause: TriggerAdmissionCause }
  /** The candidate the run was asked from waited past the policy's window, and is recorded as expired (D-R22-04). */
  | { readonly reason: 'candidate-expired'; readonly candidate: CandidateId };

/**
 * The admission checks a resume repeats before the line runs, refused there
 * (D-P14-11), and the one only a resume makes: a call whose cost was lost is
 * not replayed on top of it (A-I1a-06).
 */
export type ResumeRefusal =
  | Extract<AdmissionRefusal, { reason: 'unsafe-above-l1' | 'refused' }>
  | { readonly reason: 'meter-lost'; readonly tasks: readonly TaskId[] };

/**
 * What a control decided, and which control it was. `decidedBy` is fixed by
 * the cause wherever one component alone can make it, so a decision cannot
 * be attributed to a component that does not make it. The runtime writes
 * every one of them on the decider's behalf: the station machine is pure and
 * the proxy is a container with no route to the Vault (D-P14-09).
 */
export type DecisionCause =
  | { readonly cause: 'admission-refused'; readonly decidedBy: 'admission'; readonly refusal: AdmissionRefusal }
  | { readonly cause: 'resume-refused'; readonly decidedBy: 'admission'; readonly refusal: ResumeRefusal }
  /** `station-machine` for a refusal `nextStep` or a capability check returned, `line` for one the line made itself. */
  | { readonly cause: 'station-refused'; readonly decidedBy: 'station-machine' | 'line'; readonly refusal: StationRefusal }
  /** `principal` is what the caller authenticated, as `ApprovalGrant.approvedBy` records it; `draft` the draft it approved, or null (R19). */
  | { readonly cause: 'approval-granted'; readonly decidedBy: 'approval'; readonly key: ApprovalKey; readonly principal: string; readonly draft: DraftRef | null }
  /** `key` is null when what the caller sent was not an approval key; it is not stored, since it is the caller's text. */
  | {
      readonly cause: 'approval-refused';
      readonly decidedBy: 'approval';
      readonly key: ApprovalKey | null;
      /**
       * `draft-mismatch`: the approval named another draft than the one
       * waiting. `draft-invalid`: the draft waiting carries problems the
       * runtime would refuse to lock, so it can be rejected and not
       * approved (R19).
       */
      readonly reason: 'invalid-request' | 'not-awaiting' | 'draft-mismatch' | 'draft-invalid';
    }
  /**
   * A person's rejection of a draft (R19). `notes` says whether the rejection
   * carried notes, which are the approver's text and are kept with the attempt
   * in run state, not here; `reason` is the fixed-set reason at `test-design`.
   */
  | {
      readonly cause: 'approval-rejected';
      readonly decidedBy: 'approval';
      readonly key: ApprovalKey;
      readonly draft: DraftRef;
      readonly principal: string;
      readonly reason: RejectionReason | null;
      readonly notes: boolean;
    }
  /**
   * A draft sent back to its drafter, decided by the line from what the
   * runtime recorded (R19): an independent critic's findings, the base run's
   * refusal of its checks, or the runtime's own problems with it.
   */
  | {
      readonly cause: 'draft-sent-back';
      readonly decidedBy: 'line';
      readonly draft: DraftRef;
      readonly sentBack:
        | { readonly by: 'critic'; readonly critic: VaultRef; readonly findings: number }
        | { readonly by: 'base-run'; readonly baseRun: VaultRef; readonly checks: readonly BaseRefusalPart[] }
        | { readonly by: 'runtime'; readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }> };
    }
  /** The drafted floor raised a drafted exit to a person, naming each condition that failed (R19, D-A-DS-04). */
  | { readonly cause: 'draft-floor-applied'; readonly decidedBy: 'line'; readonly draft: DraftRef; readonly level: AutonomyLevel; readonly failed: readonly DraftCondition[] }
  /** One connection the egress proxy decided, read from its log after it stopped. `host` is the agent's choice: data, never a prompt (I7). */
  | { readonly cause: 'egress-connection'; readonly decidedBy: 'egress-proxy'; readonly connection: EgressConnection }
  /** A violation already recorded; the decision points at it rather than copying it (D-P14-08). */
  | { readonly cause: 'violation-recorded'; readonly decidedBy: 'line'; readonly violation: VaultRef }
  /** A driver call whose relay refused anything, pointing at its usage record (D-P14-05). */
  | {
      readonly cause: 'relay-refused';
      readonly decidedBy: 'model-relay';
      readonly usage: VaultRef;
      readonly refused: number;
      readonly exhausted: Extract<MeterReading, { kind: 'metered' }>['exhausted'];
    }
  /**
   * A task's next iteration raised one tier under an escalation grant,
   * decided by the line from the failed gates run state counts, never from
   * anything a model returned (A-R14-02, I2).
   */
  | {
      readonly cause: 'tier-escalated';
      readonly decidedBy: 'line';
      readonly from: ModelTier;
      readonly to: ModelTier;
      readonly failedGates: number;
    }
  /**
   * `verify` found that a path `task` changed was also changed by the accepted
   * work of each task in `with` after `task` started. Decided by the line from
   * the trees the runtime built, before the conflict is committed, as a park
   * is; the task is rebuilt, or parks past the policy's bound (A-R4-03, I5).
   */
  | {
      readonly cause: 'task-conflict';
      readonly decidedBy: 'line';
      readonly task: TaskId;
      readonly with: readonly [TaskId, ...TaskId[]];
      readonly paths: readonly [string, ...string[]];
    };

export type DecidingComponent = DecisionCause['decidedBy'];

/**
 * One decision a control made, recorded by the runtime beside run state and
 * never in it (A-P14-01, D-P14-02). Write-once and content-addressed like
 * evidence. I2: every field is the runtime's; nothing a model returned is an
 * input. `taskId` and `station` are null where the decision had none — an
 * admission refusal has neither.
 */
export interface EnforcementDecision {
  readonly runId: RunId;
  readonly taskId: TaskId | null;
  readonly station: StationId | null;
  readonly decidedAt: string;
  /**
   * A random id the runtime gives each decision it makes, so two decisions
   * alike in every other field are two entries, not one: a record is
   * content-addressed, and a count of entries is a count of decisions
   * (external review of P14, codex-5).
   */
  readonly occurrence: string;
  readonly decision: DecisionCause;
  readonly collectedBy: 'runtime';
}

/**
 * What `integrate` did on the git remote, as the runtime did it (A-I1b-01).
 * Write-once and content-addressed under the run, like a decision, and
 * carrying no time of the runtime's clock, so the same act recorded again by
 * a resume is the same entry. `opened` is written when the pull request exists at `commit`;
 * `merged` when it was merged at that commit. I2: every field is the
 * runtime's or GitHub's answer to the runtime, never a model's.
 */
export interface IntegrationOpened {
  readonly runId: RunId;
  readonly kind: 'opened';
  /** `owner/name` on GitHub. */
  readonly repository: string;
  readonly baseBranch: string;
  /** The commit the run was admitted at; the pushed commit's only parent. */
  readonly baseCommit: string;
  readonly branch: string;
  /** The commit the runtime built: `baseCommit`'s tree with the accepted diff applied. */
  readonly commit: string;
  readonly pullRequest: number;
  readonly url: string;
  readonly collectedBy: 'runtime';
}

export interface IntegrationMerged extends Omit<IntegrationOpened, 'kind'> {
  readonly kind: 'merged';
  readonly mergeCommit: string;
  /**
   * When the pull request merged, as GitHub reports it: the end of a run's
   * cycle time (A-R2-01). GitHub's time, not the runtime's clock, so the same
   * merge recorded again by a resume is the same entry.
   */
  readonly mergedAt: string;
}

export type IntegrationRecord = IntegrationOpened | IntegrationMerged;

/** An artifact as admitted: where it sits in the workspace, and the SHA-256 of its bytes at admission. */
export interface AdmittedArtifact {
  readonly path: string;
  readonly sha256: string;
}

/**
 * A set of artifacts as admitted: supplied with the run, or drafted on the
 * line (R19). Drafting is an explicit state, never an empty list: a reader
 * that has not handled it does not compile.
 */
export type AdmittedSet =
  | { readonly source: 'supplied'; readonly files: readonly AdmittedArtifact[] }
  | { readonly source: 'drafted' };

/**
 * The acceptance manifest: the checks of the acceptance tests, beside the
 * rest of the verification manifest (R19). Supplied as a file, drafted with
 * drafted tests, or `none` where the verification manifest holds every check
 * as it did before R19.
 */
export type AdmittedManifest =
  | { readonly source: 'supplied'; readonly file: AdmittedArtifact }
  | { readonly source: 'drafted' }
  | { readonly source: 'none' };

/** A rubric a person wrote for one drafting station's critic, as admission read and recorded it (R19). */
export interface RubricVersion {
  readonly station: DraftStation;
  readonly sha256: string;
  readonly ref: VaultRef;
}

/** The intent a spec-less run was admitted with: a person's text, from the principal's channel alone (R19, I7). */
export interface IntentRecord {
  readonly runId: RunId;
  readonly text: string;
  readonly from: 'principal';
  readonly collectedBy: 'runtime';
}

/** A rubric's text and hash, recorded for the run at admission (R19). */
export interface RubricRecord {
  readonly runId: RunId;
  readonly station: DraftStation;
  readonly text: string;
  readonly sha256: string;
  readonly collectedBy: 'runtime';
}

/** One file of a draft: its path, the SHA-256 of the bytes the runtime read, and those bytes, base64. */
export interface DraftFile {
  readonly path: string;
  readonly sha256: string;
  readonly base64: string;
}

/**
 * A draft as the runtime read it from the drafter's workspace (R19). `sha256`
 * binds everything about it: the critic reads these bytes, the base run runs
 * over them, and an approval names this hash. A claim until it is approved and
 * locked (I2).
 */
export interface DraftRecord {
  readonly runId: RunId;
  readonly station: DraftStation;
  readonly attempt: number;
  /** The SHA-256 of the canonical list of each file's path and hash, sorted by path. */
  readonly sha256: string;
  readonly files: readonly DraftFile[];
  /** Paths the drafter wrote outside its draft's paths, discarded with its workspace and never read. */
  readonly discarded: readonly string[];
  /** The runtime's own problems with the draft, as paths and codes; non-empty sends it back. */
  readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }>;
  /** The model the runtime resolved the drafter's call to (I2). */
  readonly model: ModelIdentity;
  readonly role: RoleVersion;
  readonly collectedBy: 'runtime';
}

/**
 * A critic's result for one draft (R19). `findings` is the list the critic
 * returned, with no severity; a result the runtime could not read is one
 * finding, and `readable` says so (I5). `binding` is false unless the critic
 * is of another family than the drafter: such findings are recorded and
 * shown, and send nothing back (D-A-DS-06).
 */
export interface CriticRecord {
  readonly runId: RunId;
  readonly station: DraftStation;
  readonly attempt: number;
  readonly draft: string;
  readonly drafter: ModelIdentity;
  readonly critic: ModelIdentity;
  readonly grade: IndependenceGrade;
  readonly binding: boolean;
  readonly readable: boolean;
  readonly findings: readonly string[];
  /** The hash of the rubric the critic was given. */
  readonly rubric: string;
  readonly role: RoleVersion;
  readonly collectedBy: 'runtime';
}

/**
 * An approved draft written into the artifact root and the base, and locked
 * (R19). `approval` says who approved it: a person, or policy with every
 * condition held, so a later refusal or revert is attributable (R2, R8).
 * `baseTreeSha256` is the base's digest with the draft in it, which every
 * later tree is built from and a resume checks the store against.
 */
export interface DraftLockRecord {
  readonly runId: RunId;
  readonly station: DraftStation;
  readonly draft: DraftRef;
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
  readonly approval: { readonly by: 'principal'; readonly principal: string } | { readonly by: 'policy' };
  readonly baseTreeSha256: string;
  readonly collectedBy: 'runtime';
}

/**
 * What a run was admitted as. Written once, before the run's first state, and
 * never again: a resume reads the requested level, the policy, and the
 * artifacts from here, so its caller has no way to restate them (I5).
 *
 * `policy` is the resolved Policy, not the document it came from, so an
 * auditor reads the effective table. Each artifact carries the hash it had at
 * admission; the station that locks it refuses a lock whose hash differs,
 * so what a station locks is what was admitted (I3).
 */
export interface AdmissionRecord {
  readonly run: Run;
  readonly policy: Policy;
  /**
   * Every role the roles directory held at admission, compiled, with its
   * hash, sorted by id (D-A-RC-01). A run's tasks receive these and only
   * these: a role file edited after admission changes later runs, never this
   * one.
   */
  readonly roles: readonly CompiledRole[];
  readonly artifacts: {
    readonly spec: AdmittedSet;
    readonly acceptanceTests: AdmittedSet;
    /** Drafted exactly when the acceptance tests are (R19). */
    readonly acceptanceManifest: AdmittedManifest;
    readonly verificationManifest: AdmittedArtifact;
    readonly taskGraph: AdmittedArtifact;
    /**
     * Each part of a supplied spec, locked with it at `spec`, or `null` where
     * it was not admitted: `spec` then refuses a missing security part (R17).
     * All null for a drafted spec, whose parts are drafted with it (R19).
     */
    readonly specParts: {
      readonly security: AdmittedArtifact | null;
      readonly runRequirements: AdmittedArtifact | null;
      readonly questions: AdmittedArtifact | null;
    };
  };
  /** The intent a drafted spec is drafted from, or null for a run admitted with its spec (R19). */
  readonly intent: VaultRef | null;
  /** The rubric each drafting station's critic checks against, read at admission; empty for a run that drafts nothing (R19). */
  readonly rubrics: readonly RubricVersion[];
  /** The digest of the base tree the runtime snapshotted at admission; every workspace is built from it (A-P6-03). */
  readonly baseTreeSha256: string;
  /**
   * The controls the run's adapter set lacks, recorded so a resume reads them
   * rather than having them restated. An L3 run is refused at admission while
   * this is non-empty (I5).
   */
  readonly unavailableControls: readonly string[];
  /**
   * The stack the base's adapter set detected (`AdapterSet.stack`), so a rate
   * can be kept per stack (R18). Written by the runtime from the same
   * detection as `unavailableControls`, never a model's account (I2). A record
   * without one was written before R18, and is reported as `unrecorded`.
   */
  readonly stack: string;
  /**
   * The candidate the run was admitted from, and the SHA-256 of the stored
   * trigger decision that recorded it, so a run traces back to the delivery
   * that prompted it (A-R22-04, D-R22-03). Null for a person's own run;
   * absent on a record written before R22.
   */
  readonly candidate?: { readonly id: CandidateId; readonly decisionSha256: string } | null;
}

/**
 * Every cause a trigger refusal names (A-R22-05, D-R22-02). Admission's three
 * (`not-enabled`, `trust`, `depth`) are in the run's own P14 record as
 * `trigger-refused`; the others are a delivery's, kept beside the runs.
 */
export type TriggerRefusalCause =
  | 'not-subscribed' | 'unverified' | 'replayed' | 'stale' | 'oversize'
  | 'schema' | 'not-enabled' | 'depth' | 'budget' | 'trust';

/**
 * The causes counted rather than written one by one: a request refused before
 * its signature verified, and a verified body sent again. Anyone on the
 * internet can send the first three and anyone holding a captured body the
 * fourth, so none of them writes a record of its own (D-R22-03).
 */
export type CountedRefusalCause = Extract<TriggerRefusalCause, 'not-subscribed' | 'unverified' | 'oversize' | 'replayed'>;

/** The bucket every unnamed subscription shares, so a path a sender chose never names a record (D-R22-03). */
export const UNSUBSCRIBED_BUCKET = '(unsubscribed)';

/**
 * An event recorded for a person to read (D-A-TF-01). Nothing runs from it
 * until a person admits a run through the API, writing the intent. Its id is
 * the runtime's: the SHA-256 of its source and replay key.
 *
 * `body` is the exact bytes the route verified, base64, beside their hash,
 * readable by the principal through the API and never by a driver; a
 * scheduled firing has none. `extracted` is the kind's schema record, checked
 * whole (I7).
 */
export interface CandidateRecord {
  readonly id: CandidateId;
  readonly kind: SchemaKind;
  readonly template: TemplateId;
  readonly extracted: Readonly<Record<string, string>>;
  readonly authorTrust: AuthorTrust;
  readonly lineage: TriggerLineage;
  /** The body's own time; null for a scheduled firing, whose time is the runtime's. */
  readonly signedAt: string | null;
  readonly body: { readonly sha256: string; readonly base64: string } | null;
  /** The runtime's clock when it was recorded. Expiry runs from here, never from `signedAt` (D-R22-04, I2). */
  readonly recordedAt: string;
  readonly collectedBy: 'runtime';
}

/**
 * The outcome of one verified delivery or one schedule's firing, written once
 * under its replay key in the same write as the candidate it records, if any
 * (D-R22-02, D-R22-03). A write that fails leaves no key, so a retry is
 * admitted; a second write under the same key is refused as a duplicate.
 *
 * `source` is a subscription id, or `schedule:<id>`. `key` is the body's
 * SHA-256, or `<UTC date>` for a firing. Nothing in it is the payload's text:
 * a refusal names its cause and, for a schema refusal, each field and rule.
 */
export interface TriggerDecision {
  readonly source: string;
  readonly key: string;
  readonly decidedAt: string;
  readonly outcome:
    | { readonly kind: 'candidate'; readonly candidate: CandidateId }
    /** Verified, and not the kind's event: a push to another branch, a check that passed. */
    | { readonly kind: 'ignored' }
    | { readonly kind: 'refused'; readonly cause: 'schema'; readonly defects: readonly FieldDefect[] }
    | { readonly kind: 'refused'; readonly cause: 'stale'; readonly signedAt: string }
    | { readonly kind: 'refused'; readonly cause: 'budget' | 'not-enabled' }
    /** Firings a stopped service missed, recorded and never run late (D-A-TF-08). */
    | { readonly kind: 'missed'; readonly first: string; readonly last: string };
  readonly collectedBy: 'runtime';
}

/** A decision as stored: the decision, the candidate it recorded, and the SHA-256 of the stored bytes. */
export interface IntakeEntry {
  readonly decision: TriggerDecision;
  readonly candidate: CandidateRecord | null;
  readonly sha256: string;
  /** The run admitted from the candidate, once; null until then. */
  readonly admittedAs: RunId | null;
  /** When the candidate was recorded as expired, by the runtime's clock; null if it has not been. */
  readonly expiredAt: string | null;
}

/** One hour's counted refusals for one bucket (D-R22-03). `hour` is the UTC hour, `YYYY-MM-DDTHH`. */
export interface RefusedDeliveryCount {
  readonly bucket: string;
  readonly hour: string;
  readonly counts: Readonly<Partial<Record<CountedRefusalCause, number>>>;
}

/**
 * The store holds no state for this run: refused at admission, or admitted and
 * not yet committed. A code, not a class, so a store module carries no value
 * import and still loads where its types are only stripped; `isNoRunState`
 * tells it from a fault.
 */
export interface NoRunState extends Error {
  readonly code: 'no-run-state';
  readonly runId: RunId;
}

/**
 * I1: no generic write(). Every mutator is a named, audited operation the runtime
 * calls. No method on this interface is reachable from inside a Workspace.
 */
export interface Vault {
  read(ref: VaultRef): Promise<Uint8Array>;
  lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest>;
  verifyLocks(runId: RunId): Promise<LockVerdict>;
  writeEvidence(b: EvidenceBundle): Promise<VaultRef>;
  recordViolation(v: IntegrityViolation): Promise<VaultRef>;
  /** Refused when the run already has an admission record. */
  recordAdmission(a: AdmissionRecord): Promise<VaultRef>;
  /** The result exactly as the driver returned it. A claim a later station reads comes from here, never from memory. */
  recordTaskResult(runId: RunId, r: TaskResult): Promise<VaultRef>;
  /** What one driver call cost, as the runtime read it from the relay. Refused unless `collectedBy` is `'runtime'`. */
  recordUsage(r: UsageRecord): Promise<VaultRef>;
  /**
   * One enforcement decision, as the runtime recorded it for the component
   * that made it. Refused unless `collectedBy` is `'runtime'`. Needs no run
   * state: a refused admission is recorded under the run id it asked for, and
   * nothing else is written for it (D-P14-01).
   */
  recordDecision(d: EnforcementDecision): Promise<VaultRef>;
  /** Every decision recorded for a run, in no promised order; empty for a run with none (D-P14-02). */
  readDecisions(runId: RunId): Promise<readonly VaultRef[]>;
  /**
   * Every usage record stored for a run, in no promised order, whether or not
   * run state references it: a record stored before a crash took the commit
   * that would have referenced it is still found (A-I1a-05).
   */
  readUsage(runId: RunId): Promise<readonly VaultRef[]>;
  /**
   * A base record (D-A-BF-01). Refused unless `collectedBy` is `'runtime'`,
   * and refused where the run already has one for the same draft, or for its
   * admitted checks when `draft` is null: the base a run or a draft is judged
   * against is fixed by its first run, as an admission is (R19).
   */
  recordBaseRun(r: BaseRunRecord): Promise<VaultRef>;
  /** The base record for `draft`, or for the admitted checks when null; null when they have not run over the base. */
  readBaseRun(runId: RunId, draft: string | null): Promise<VaultRef | null>;
  /** The intent a spec-less run was admitted with. Refused unless it came from the principal and `collectedBy` is `'runtime'` (R19). */
  recordIntent(r: IntentRecord): Promise<VaultRef>;
  /** A rubric as admission read it. Refused unless its hash is its text's (R19). */
  recordRubric(r: RubricRecord): Promise<VaultRef>;
  /** A draft as the runtime read it. Refused unless its hash is the hash of its files (R19). */
  recordDraft(r: DraftRecord): Promise<VaultRef>;
  /** A critic's result for a draft, as the runtime read it (R19). */
  recordCriticResult(r: CriticRecord): Promise<VaultRef>;
  /** An approved draft as it was written into the artifact root and locked; once per run and station (R19). */
  recordDraftLock(r: DraftLockRecord): Promise<VaultRef>;
  /** The run's lock manifest as it stands, or null when nothing is locked: read, never written, here (R19). */
  readLocks(runId: RunId): Promise<LockManifest | null>;
  /** What `integrate` did on the remote. Refused unless `collectedBy` is `'runtime'` (A-I1b-01). */
  recordIntegration(r: IntegrationRecord): Promise<VaultRef>;
  /** Every integration record of a run, in no promised order; empty for a run that never integrated. */
  readIntegration(runId: RunId): Promise<readonly VaultRef[]>;
  /**
   * Every run the store holds any record for, admitted or refused at
   * admission, sorted by id (A-R2-02). The store names the set, never a
   * caller: a rate over runs a caller picked is a rate over a chosen sample.
   */
  listRuns(): Promise<readonly RunId[]>;
  /**
   * A trigger decision and the candidate it records, in one write under the
   * decision's source and key (A-R22-04, D-R22-02). `false` where that key
   * was written before: the delivery is a replay, and nothing is written.
   * Refused unless `collectedBy` is `'runtime'`, and unless a candidate is
   * given exactly when the outcome names one, under that id.
   */
  recordTriggerDecision(d: TriggerDecision, candidate: CandidateRecord | null): Promise<boolean>;
  /** Every trigger decision, sorted by source then key; kept beside the runs, so `listRuns` never names one. */
  readTriggerDecisions(): Promise<readonly IntakeEntry[]>;
  /** Whether a decision was written under this source and key: a replay is refused on it before its body is parsed (D-R22-02). */
  hasTriggerDecision(source: string, key: string): Promise<boolean>;
  /** The decision that recorded a candidate, or null where no candidate has the id. */
  readCandidate(id: CandidateId): Promise<IntakeEntry | null>;
  /** Marks a candidate admitted as a run, once; `false` where it already was (A-R22-04). */
  markCandidateAdmitted(id: CandidateId, runId: RunId): Promise<boolean>;
  /** Records a candidate as expired, on the runtime's clock; never deletes it. A second call keeps the first time (D-R22-04). */
  markCandidateExpired(id: CandidateId, at: string): Promise<void>;
  /** Adds one to a bucket's count for an hour and a cause (D-R22-03). */
  countRefusedDelivery(bucket: string, hour: string, cause: CountedRefusalCause): Promise<void>;
  /** Every bucket's counts, sorted by hour then bucket. */
  readRefusedDeliveryCounts(): Promise<readonly RefusedDeliveryCount[]>;
  /** Rejects with a `NoRunState` where the store holds no state for the run, and with anything else only on a fault. */
  readRunState(runId: RunId): Promise<RunState>;
  commitRunState(s: RunState, ifVersion: string): Promise<RunState>;
}
