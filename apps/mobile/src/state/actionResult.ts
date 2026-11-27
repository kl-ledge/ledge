import type { OperationReason } from '@ledge/protocol';

/**
 * The end of an operation the phone sent and waits on (a routine's command, a project's change, a note's answer, a decision):
 * applied, refused with its reason, failed, or the device's check cancelled or expired. It was the chat's card outcome before #40.
 */
export type ActionResult =
  | { status: 'failed' }
  /** `scheduled`: a model change that waits for the end of the turn. */
  | { status: 'applied'; scheduled?: true }
  | { status: 'rejected'; reason: OperationReason }
  | { status: 'cancelled' }
  | { status: 'expired' };
