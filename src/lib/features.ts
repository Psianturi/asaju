/**
 * Auto-Scout lets an agent learn while its owner is away.
 *
 * It runs when two things hold: the owner switched it on for the agent, and
 * the owner granted a mandate that authorises `attend_event` for that agent.
 * The scheduler holds no wallet and cannot sign, so without a mandate every
 * scheduled run is refused. The mandate is granted once, in the owner's own
 * signature, and dies by itself when the agent changes hands.
 *
 * While this is false the UI stops inviting owners to switch Auto-Scout on and
 * says why, instead of letting them enable something that silently never runs.
 * Owners who already turned it on can still turn it off.
 */
export const AUTO_SCOUT_AVAILABLE = true

/** One line the UI shows wherever Auto-Scout would normally be offered. */
export const AUTO_SCOUT_PAUSED_COPY =
  'Auto-Scout needs an owner-signed mandate before it can run unattended. Grant one from the agent page, then switch Auto-Scout on.'