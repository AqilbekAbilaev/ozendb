//! The server's last word on Premium, kept so Premium survives a spell offline. The
//! server stays the authority (`/sync` refuses a lapsed account); this only lets the app
//! keep reporting Premium while it cannot ask. It is device state: it never syncs, and
//! signing out clears it. A lapse means pull-only access; nothing here touches data.

use crate::error::AppError;
use crate::json_store_wrapper;
use serde::{Deserialize, Serialize};

pub const GRACE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
// An automatic clock correction must not flip Premium to expired, but turning the clock
// back can't extend it: Premium still ends at the same time.
pub const CLOCK_DRIFT_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subscription {
    pub status: String,
    pub renews_at: Option<i64>,
    pub ends_at: Option<i64>,
}

/// The server's answer to `GET /me`. Times are epoch milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Account {
    pub email: String,
    pub premium: bool,
    pub subscription: Option<Subscription>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Answer {
    account: Account,
    received_at: i64,
}

/// Sent to the frontend as `{ "state": "premium", "until": … }`, or the state alone.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Entitlement {
    /// No answer from the server is recorded on this device.
    Unknown,
    /// The server's last answer said this account has no Premium.
    Free,
    /// The server's last answer said Premium, and it holds offline until `until`.
    Premium { until: i64 },
    /// The last Premium answer is past its grace period or its subscription's end.
    Expired,
}

impl Entitlement {
    pub fn has_premium(&self) -> bool {
        matches!(self, Entitlement::Premium { .. })
    }
}

impl Answer {
    pub fn entitlement(&self, now: i64) -> Entitlement {
        if !self.account.premium {
            return Entitlement::Free;
        }
        let until = self.premium_until();
        // A clock reading well before the answer cannot measure the grace period, so it
        // grants none rather than stretching it.
        if (self.received_at - CLOCK_DRIFT_MS..until).contains(&now) {
            Entitlement::Premium { until }
        } else {
            Entitlement::Expired
        }
    }

    // Any known end counts, whatever the status, so the cache never outlives one.
    fn premium_until(&self) -> i64 {
        let grace_end = self.received_at + GRACE_MS;
        match self.account.subscription.as_ref().and_then(|subscription| subscription.ends_at) {
            Some(ends_at) => grace_end.min(ends_at),
            None => grace_end,
        }
    }
}

json_store_wrapper!(EntitlementStorage, Option<Answer>);

impl EntitlementStorage {
    pub fn record(&self, account: Account, now: i64) -> Result<(), AppError> {
        self.inner.save(&Some(Answer { account, received_at: now }))
    }

    pub fn entitlement(&self, now: i64) -> Entitlement {
        match self.load() {
            Some(answer) => answer.entitlement(now),
            None => Entitlement::Unknown,
        }
    }

    /// The account the last answer described; `None` before any answer.
    pub fn account(&self) -> Option<Account> {
        self.load().map(|answer| answer.account)
    }

    pub fn clear(&self) -> Result<(), AppError> {
        self.inner.save(&None)
    }
}

#[cfg(test)]
#[path = "entitlement.test.rs"]
mod tests;
