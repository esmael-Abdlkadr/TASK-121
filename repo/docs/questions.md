# Questions and Ambiguities

1. **Template date formats for import vs HTML datetime controls**
   - Import requires `MM/DD/YYYY HH:mm` while browser datetime inputs emit ISO-local format.
   - Current implementation keeps import strict and uses ISO for UI-only entry fields.

2. **Cold query return type depth**
   - Cold tables store archive metadata (`originalId`, `archivedAt`) rather than full entity payloads.
   - Current cold query APIs return archive metadata records instead of fully reconstructed business entities.

3. **Order "standard flow" wording inconsistency**
   - Some iteration wording says standard order path includes Pending, while a later criterion says submit standard then paid.
   - Current implementation treats standard submit as directly `Approved` for simplified flow consistency.

4. **Notification retry execution in test/runtime environments**
   - Browser runtime uses delayed retry (`setTimeout(5000)`), while tests may not advance timers naturally.
   - Tests validate retry behavior and terminal states deterministically via controlled invocation.
