/**
 * Nesting cap for any walk down a group's `data.children`. A chain a peer
 * wrote into the CRDT can be arbitrarily deep (or, through a concurrent edit,
 * cyclic), and a walk that blew the stack would be its own denial of service.
 * Every recursive element walk that reads stored content stops here, so they
 * agree on how deep a readable group goes; the REST content writer refuses
 * deeper trees at the same depth.
 */
export const MAX_GROUP_DEPTH = 32;
