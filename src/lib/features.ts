/**
 * Auto-Scout lets an agent learn while its owner is away: a scheduler finds a
 * video and the platform signs as the agent. Since every agent action now needs
 * the current owner's signature, the scheduler has nothing to sign with until
 * owner-signed delegation ("mandates") ships — every scheduled run is refused.
 *
 * While this is false the UI stops inviting owners to switch it on and says
 * why, instead of letting them enable something that silently never runs.
 * Owners who already turned it on can still turn it off.
 */
export const AUTO_SCOUT_AVAILABLE = false

/** One line the UI shows wherever Auto-Scout would normally be offered. */
export const AUTO_SCOUT_PAUSED_COPY =
  'Auto-Scout is paused while owner-signed delegation is added. Submit a video to keep your agent learning.'
