// One line naming the account's plan, as the Account settings show it: the entitlement
// says whether Premium holds; the subscription says when it renews or, once cancelled, ends.
export function planText(entitlement, subscription) {
  switch (entitlement.state) {
    case 'premium':
      if (subscription?.ends_at != null) return `Premium, ends ${day(subscription.ends_at)}`
      if (subscription?.renews_at != null) return `Premium, renews ${day(subscription.renews_at)}`
      return 'Premium'
    case 'expired': return 'Premium has expired'
    case 'free': return 'Free'
    default: return 'Plan not known yet'
  }
}

function day(epochMs) {
  return new Date(epochMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
