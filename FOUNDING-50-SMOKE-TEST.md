# Founding 50 smoke test

1. Deploy v0.34.0 and confirm `/health` reports `0.34.0`.
2. Open `/alpha/admin`, connect, then open **Founding 50**. It should show `0 / 50` (or the current count) and **Active**.
3. Use the squad owner account on PC A and a second account on PC B. Start Sloth Sync and make sure both replay buffers are ready.
4. Save one Moment and wait until both POVs are ready in the Moment.
5. Refresh Alpha Admin. The squad owner should appear as the next Founding 50 position with a two-year Sloth+ expiry.
6. On the owner account, call/refresh the normal entitlement flow. Effective plan should be `SLOTH_PLUS` unless a higher `SLOTH_PRO` plan is active.
7. Save another successful Moment with the same host. The Founding 50 count must not increase.
8. Pause the reward in Alpha Admin, then complete a qualifying Moment with a different squad owner. The count must not increase.
9. Resume the reward and complete another qualifying Moment with that owner. Exactly one new spot should be claimed.
10. Confirm a failed or one-POV Moment does not claim a spot.

Existing paid subscriptions and creator grants should remain unchanged throughout the test.
