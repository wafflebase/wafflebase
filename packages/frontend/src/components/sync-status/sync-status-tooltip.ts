import type { DurabilityLapse } from '@/lib/durable-document-context';
import type { SyncState } from './sync-state';

/**
 * The chip's tooltip text.
 *
 * A module of its own so it can be tested directly: Radix renders tooltip
 * content only once the tooltip is open, so asserting this through the DOM
 * would be asserting the tooltip library — and this sentence is what the
 * design has a requirement about, not the popover that carries it.
 */

/**
 * Why durability lapsed, in the user's words.
 *
 * `docs/design/offline-local-persistence.md` § What the user sees gives a row
 * per cause and then requires it of this state: "Its tooltip must name which
 * case applies." Every row collapses to the same chip, so the sentence below is
 * the only thing that distinguishes an oversized document from a second tab
 * from a browser that cannot store anything — three situations with three
 * different things to do about them.
 *
 * `not-enabled` is absent on purpose: that row is a call to action, and the
 * offer sentence below says it better than a diagnosis would. `not-permitted`
 * is absent too — a share link was never going to be saved to the visitor's
 * device, and saying so would describe the feature to somebody who does not
 * have it.
 *
 * There is likewise no sentence for a build that cannot carry a client key.
 * That is not a fault of the user's browser, it is our dependency pin, and on
 * the pin this shipped with it would be the sentence *every* stranded user
 * read — so no lapse is published there at all and this map has nothing to
 * say about it. See `lib/durable-document-context.ts`.
 */
const LAPSE_REASONS: Partial<Record<DurabilityLapse, string>> = {
  'another-tab':
    'This document is open in another tab, and that tab is the one saving it to this device.',
  dropped:
    'Earlier changes could not be reconciled, so this document is no longer being saved to this device.',
  'too-large': 'This document is too large to save on this device.',
  'out-of-space': 'This device is out of local storage space.',
  'write-failed': 'This device could not be written to.',
  unreportable:
    'This browser cannot confirm that changes are being saved to this device, so it is not promising that they are.',
};

/**
 * The one sentence the chip shows on hover or focus, per state.
 */
export function tooltipFor(
  state: SyncState,
  pendingSince: Date | null,
  connected: boolean,
  offerOffline: boolean,
  lapse: DurabilityLapse | undefined,
): string {
  switch (state) {
    case 'saved':
      return 'All changes are on the server.';
    case 'saving':
      return 'Sending your recent changes to the server.';
    case 'reconnecting':
      return 'The connection dropped. Nothing of yours is waiting to be sent.';
    case 'saved-locally': {
      const since = pendingSince
        ? `Changes since ${pendingSince.toLocaleTimeString()}`
        : 'Recent changes';
      // The counterpart of `not-saved`'s wording, and the reason this state
      // exists: those edits are on the disk, so closing the tab no longer ends
      // them. It still says they are not on the server, because they are not.
      //
      // "when syncing resumes", not "when the connection returns": this state
      // is also reached while connected, with the server rejecting the push.
      // Naming a connection outage would describe the wrong problem to the one
      // user in that case who looks.
      return (
        `${since} are saved on this device and will be sent when syncing ` +
        `resumes. They are not on the server yet.`
      );
    }
    case 'not-saved': {
      const since = pendingSince
        ? `Changes since ${pendingSince.toLocaleTimeString()}`
        : 'Recent changes';
      // `Not saved` is reached two ways and they call for different advice —
      // the same split the toast already makes. Telling somebody whose
      // connection is fine that it dropped sends them to debug the wrong
      // thing, and the reverse hides the only thing they can act on.
      const why = connected
        ? `${since} were rejected by the server, so they haven't been saved.`
        : `${since} haven't reached the server because the connection dropped.`;
      // Deliberately names the tab as the only copy. Yorkie keeps the change
      // queue in memory, so anything that ends this tab ends these edits —
      // wording that implied local storage would be a false promise.
      const risk =
        'They exist only in this tab, so closing or reloading it will lose them.';
      // The one row of the design's table that is a call to action rather than
      // a fault: this is where somebody is standing when they find out they
      // wanted the setting, so the offer belongs here and not only in Settings.
      //
      // What it must not say is that clicking saves *these* edits. The
      // durability decision is made when a document opens and held until it
      // closes — deliberately, since re-deciding would remount the editor and
      // discard the very queue at risk — so the preference reaches documents
      // opened after it and never this one. Somebody who read the older
      // wording could reasonably click, then reload, and lose exactly the work
      // the sentence promised to keep.
      const offer = offerOffline
        ? ' Click to save documents you open later on this device. These changes stay in this tab.'
        : '';
      // `Not saved` is a *designed* state now rather than the only one — a
      // second tab, an oversized document, a store that will not take a write —
      // so it carries weight that used to come from it simply always being
      // true. Naming the cause is what the design requires of it, and what
      // keeps the sentence above from reading as the whole story.
      const why_not = lapse ? ` ${LAPSE_REASONS[lapse] ?? ''}`.trimEnd() : '';
      return `${why} ${risk}${why_not}${offer}`;
    }
  }
}
