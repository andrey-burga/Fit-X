# Security Specification: Vigor Core (Firestore RBAC & ABAC)

## 1. Data Invariants & Zero-Trust Architecture
1. **User Ownership Invariant**: Every subcollection document (`mealLogs`, `groceries`, `workoutSessions`, `cardioSessions`, `notifications`, `biometrics`) belongs strictly to the authenticated user matching `{userId}` (`request.auth.uid == userId`).
2. **Cross-Tenant Lockdown**: An authenticated user `user_A` can never read, list, create, edit, or delete data under `/users/{user_B}/...`.
3. **Data Integrity & Schema Blueprint**: All writes must satisfy type constraints, mandatory fields, string length bounds (<= 150/500 chars), valid enums, and timestamp formats.
4. **Identity Spoofing Guard**: Document payloads cannot forge foreign `userId` fields.
5. **No Blanket Reads**: All read and list rules explicitly evaluate `request.auth.uid == userId`. No unbounded query scraping is allowed.
6. **Denial of Wallet Defense**: All single document path variables enforce `isValidId()` <= 128 characters matching `^[a-zA-Z0-9_\-]+$`.

---

## 2. The "Dirty Dozen" Adversarial Attack Payloads
The following 12 attack vectors are blocked by our fortress rules:

1. **Payload 1 (Ghost Field / Shadow Injection)**:
   Attempt to write `{ name: "Pollo", calories: 250, isSuperAdmin: true }` into `/users/{uid}/mealLogs/{id}`.
   *Result*: Blocked by `hasOnly()` key blueprint.

2. **Payload 2 (Cross-Tenant Steal)**:
   Authenticated user `uid_attacker` attempts `get` or `list` on `/users/uid_victim/mealLogs`.
   *Result*: Blocked (`request.auth.uid == userId` fails).

3. **Payload 3 (Foreign Ownership Spoofing)**:
   User `uid_attacker` writes a document with `{ userId: "uid_victim", title: "Cheat Meal" }`.
   *Result*: Blocked (`incoming().userId == request.auth.uid` fails).

4. **Payload 4 (Massive String / Denial of Wallet)**:
   Attempt to inject a 2MB string into `mealLog.description` or a 2KB junk string into `{mealLogId}`.
   *Result*: Blocked by `isValidId()` and `.size() <= 500`.

5. **Payload 5 (Invalid Enum Bypass)**:
   Attempt to write a grocery item with `"department": "explosives"`.
   *Result*: Blocked by strict enum validation helper.

6. **Payload 6 (Negative Nutritional Telemetry)**:
   Attempt to write a meal with `"calories": -5000` or `"protein": -200`.
   *Result*: Blocked by numeric positivity check `incoming().calories >= 0`.

7. **Payload 7 (Unauthenticated Read/Write)**:
   Attempt to fetch user biometrics with unauthenticated client (`request.auth == null`).
   *Result*: Blocked by `isSignedIn()`.

8. **Payload 8 (Malformed Document ID)**:
   Attempt to target document ID containing path traversal `../../etc/passwd` or non-alphanumeric characters.
   *Result*: Blocked by regex `'^[a-zA-Z0-9_\-]+$'`.

9. **Payload 9 (Role Escalation on User Profile)**:
   Standard user attempts to modify their role to `SystemAdmin` or bypass role allowlist.
   *Result*: Blocked by `role in ['Atleta Pro', 'Coach', 'Nutricionista']`.

10. **Payload 10 (Type Poisoning on Workout Set)**:
    Attempt to write `"weightKg": "not-a-number"` or a boolean into a weight field.
    *Result*: Blocked by `incoming().weightKg is number`.

11. **Payload 11 (Orphaned Subcollection Write)**:
    Attempt to write subcollection items without an established user root.
    *Result*: Blocked by relational check and root path verification.

12. **Payload 12 (Blanket Collection Scrape)**:
    Attempt to run a collectionGroup query over all `mealLogs` across the entire platform.
    *Result*: Blocked by default deny catch-all `match /{document=**} { allow read, write: if false; }`.
