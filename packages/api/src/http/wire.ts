/**
 * What crosses the HTTP surface, in both directions. The CLI reads these
 * types and nothing else from this package: it is a client of the wire, not of
 * the runtime (I9).
 *
 * Every body is JSON and every field is data. A run's state and outcome are
 * what the runtime derived and recorded (I2); nothing a model wrote is
 * presented as status, and nothing here is ever placed in a prompt (I7).
 */
import type { ApprovalKey, AutonomyLevel, CandidateId, RejectionReason, RunId, RunState } from '@olympus-ai/core';
import type { CandidateRecord } from '@olympus-ai/vault';
import type { DeliveryOutcome } from '../intake.js';
import type { WorstCaseCost } from '../cost.js';
import type { RequestedArtifacts, RunOutcome, RunStanding } from '../run.js';

/** `POST /runs`. The components and the policy are the server's own; a request names neither (D-P9-01). */
export interface CreateRunBody {
  /** Absolute, on the server's host. */
  readonly workspace: string;
  readonly baseCommit: string;
  readonly requestedLevel: AutonomyLevel;
  readonly artifacts: RequestedArtifacts;
  /** The worst-case figure approved, or null to be told it. Above L0 a run is refused until it matches. */
  readonly approvedCostUsd: number | null;
  /**
   * The person's intent a drafted spec is drafted from, or absent (R19). This
   * route is the human principal's channel, the only one an intent comes
   * through (I7).
   */
  readonly intent?: string;
  /** The intake candidate the run is admitted from (R22): the person writes the intent, and the candidate supplies the trigger. */
  readonly candidate?: CandidateId;
}

/** `POST /runs/:id/approve`. Who approved is the token's principal, never a field (D-P9-06). */
export interface ApproveBody {
  readonly key: ApprovalKey;
  /** The hash of the draft approved, at a drafted exit (R19). */
  readonly draft?: string;
}

/**
 * `POST /runs/:id/reject`: a person's rejection of the draft waiting (R19).
 * Notes at `spec`; a reason from the fixed set at `test-design`, and no text.
 */
export interface RejectBody {
  readonly key: ApprovalKey;
  readonly draft: string;
  readonly notes?: string;
  readonly reason?: RejectionReason;
}

/** 201 from `POST /runs`: admitted and recorded; the line is driving it. */
export interface CreatedRun {
  readonly runId: RunId;
  readonly worstCase: WorstCaseCost;
  readonly state: RunState;
}

/** `GET /runs/:id`, and the body of every successful lifecycle call. */
export interface RunView {
  readonly runId: RunId;
  readonly state: RunState;
  readonly standing: RunStanding;
  /** Whether this server is driving the run now. */
  readonly driving: boolean;
  /**
   * How the last drive this server ran ended, or null if it ran none. Held in
   * memory only: a restarted server has none, and `standing`, read from the
   * Vault, is the authority.
   */
  readonly lastOutcome: DriveEnd | null;
}

export type DriveEnd =
  | { readonly kind: 'outcome'; readonly outcome: RunOutcome }
  | { readonly kind: 'error'; readonly message: string };

/** One server-sent event on `GET /runs/:id/events`: its `event:` name and its JSON `data:`. */
export type RunEvent =
  | { readonly event: 'state'; readonly data: RunState }
  | { readonly event: 'standing'; readonly data: RunStanding }
  | { readonly event: 'end'; readonly data: DriveEnd | null };

export type ErrorCode =
  | 'unauthorized'
  | 'not-found'
  | 'method-not-allowed'
  | 'bad-request'
  | 'too-large'
  | 'refused'
  | 'conflict'
  /** A run whose records may still change is not exported (D-R12-04). */
  | 'not-finished'
  | 'internal';

/** Every non-2xx body. `refusal` carries the runtime's typed outcome where there is one, so a client reads fields, never prose. */
export interface ErrorBody {
  readonly error: ErrorCode;
  readonly message: string;
  readonly refusal?: unknown;
}

/**
 * One candidate on `GET /intake`, with no body: the kind, the schema's fields,
 * and where it stands (R22). Every field is the runtime's or the schema's;
 * nothing here is the payload's free text (I7).
 */
export interface CandidateSummary {
  readonly id: CandidateId;
  readonly kind: CandidateRecord['kind'];
  readonly template: CandidateRecord['template'];
  readonly extracted: CandidateRecord['extracted'];
  readonly authorTrust: CandidateRecord['authorTrust'];
  readonly lineage: CandidateRecord['lineage'];
  readonly recordedAt: string;
  readonly admittedAs: RunId | null;
  readonly expiredAt: string | null;
}

/** `GET /intake/:id`: the candidate, its raw body for the principal to read, and the hash of the decision that recorded it. */
export interface CandidateView extends CandidateSummary {
  readonly body: CandidateRecord['body'];
  readonly signedAt: string | null;
  readonly decisionSha256: string;
}

/** 202 from `POST /events/:subscription`: what the delivery came to. A refusal is a 4xx with the cause, and no body text. */
export type DeliveryAnswer = DeliveryOutcome;
