/**
 * A check, in three stages (23.09 audit, "code and architecture"):
 *
 *   observe    src/api/observe.ts        every read, and what it saw
 *   interpret  src/engine/interpret.ts   the rules over what was seen
 *   present    src/engine/interpret.ts   the sentence, evidence, diagram, card
 *
 * It used to be one 500-line function that did all three, so what was read
 * and what was concluded from it could not be told apart in code, and the
 * gallery re-explain had to do the last two again in a copy of its own.
 * Only the first stage does any I/O; the other two are what a rules change
 * re-runs over a stored observation.
 */
import type { VerdictResult } from '../engine/verdict';
import type { EvidenceItem } from '../engine/evidence';
import type { ShareCard } from '../engine/share';
import type { NansenContribution } from '../engine/nansenContribution';
import type { ExposureBreakdown } from '../engine/breakdown';
import type { Observation } from '../engine/observation';
import { interpret, present } from '../engine/interpret';
import { observe, type ObserveOptions } from './observe';

export { CHECK_DEADLINE_MS } from './observe';

export type CheckOptions = ObserveOptions;

/** An observation with one interpretation of it: what a check returns. */
export interface CheckResult extends Observation {
  verdict: VerdictResult;
  /** The rules that read all of this. See CLASSIFIER_VERSION. */
  classifierVersion: string;
  /** When the rules were run over the observation. A re-explain moves this
   * and never `observedAt`. */
  interpretedAt: string;
  /** Set on an entry kept from an older scan whose observation does not
   * carry what the current rules read. Its verdict is the one those older
   * rules gave it, and is shown as history rather than as a current answer. */
  historical?: { reason: string; missing: string[] };
  /** The reading this one replaced, where a re-explain replaced one. */
  previousInterpretation?: { verdict: string; classifierVersion: string; interpretedAt: string };
  /** One sentence built from the numbers that decided the verdict. */
  summary: string;
  /** Up to five numbers for the card, each with its source. */
  evidence: EvidenceItem[];
  /** What this card says once it leaves the page as a picture. Built
   * server-side so the page, the image and the API cannot drift apart. */
  share?: ShareCard;
  /** The position split into what stands against it, for the diagram. The
   * arithmetic is done here so the drawing has nothing to decide. */
  breakdown?: ExposureBreakdown;
}

/** What /api/check and the gallery serve: the result plus how many Nansen
 * calls producing it took, counted by the caller's recorder. */
export type CheckResponse = CheckResult & {
  nansenCalls: number;
  /** Where this exact reading can be opened again. See src/snapshot.ts.
   * Absent when the write that would have made it openable failed. */
  snapshotId?: string;
  /** Whether that write went through. The card used to be handed an id
   * whatever KV did with it, so "Copy link" could produce a link that has
   * never pointed at anything (audit R02). */
  snapshotSaved?: boolean;
  /** Set on a stored reading that has since been read again. It keeps its
   * id and its link - it is the other half of any comparison - but the
   * gallery lists the newer one in its place. */
  superseded?: boolean;
  supersededBy?: string;
  /** The reading this one replaced, where there is one. */
  supersedes?: string;
  /** The rule behind the verdict in plain words (src/engine/reasons.ts),
   * added wherever a reading is served; null where the rules that made it
   * have no words for its reason. */
  rule?: string | null;
  /** What this reading leaves open, to follow "Still open:"
   * (src/engine/openQuestion.ts). Added wherever a reading is served. */
  openQuestion?: string | null;
  /** What Nansen supplied to this reading and which of it the answer needed
   * (src/engine/nansenContribution.ts). Added wherever a reading is served. */
  nansen?: NansenContribution | null;
};

/** Reads one address and answers about it: observe, interpret, present.
 * The rules run at the moment of the check, so `interpretedAt` is its
 * `checkedAt`. */
export async function checkAddress(address: string, opts: CheckOptions): Promise<CheckResult> {
  const observation = await observe(address, opts);
  return present(interpret(observation, observation.checkedAt));
}
