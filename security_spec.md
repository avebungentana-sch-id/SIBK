# Security Specification & ABAC Hardening for SIAC-BK

## 1. Data Invariants
1. **Administrative Boundary**: Only verified administrators (`request.auth.token.email_verified == true` with email `avebungentana@gmail.com` or registered in `/admins/{uid}`) can create, edit, or delete students, categories, point transactions, or counseling records.
2. **Student Identity & Relational Integrity**: Point logs in `/students/{studentId}/points/{pointId}` MUST verify that the parent student document exists via `exists(/databases/$(database)/documents/students/$(studentId))`.
3. **Score & Calculation Guard**: Student scores are non-negative bounded integers (`score >= 0 && score <= 1000`).
4. **Temporal Integrity**: Create and update actions preserve immutable audit IDs and strictly validate string lengths to prevent payload injection and "Denial of Wallet" resource exhaustion.
5. **No Blind Blanket Reads**: All read queries must require authenticated admin privileges.

---

## 2. The Dirty Dozen Malicious Payloads

1. **Unauthenticated Read Attack**: Anonymous user attempting `get` or `list` on `/students` or `/counseling`. Expect: `PERMISSION_DENIED`.
2. **Unverified Email Spoofing**: User with unverified email `avebungentana@gmail.com` (`email_verified: false`) trying to write to `/config/school`. Expect: `PERMISSION_DENIED`.
3. **Ghost Field Injection (Shadow Update)**: Admin update payload to `/students/{studentId}` injecting an undocumented root privilege key `{ "role": "superadmin" }`. Expect: `PERMISSION_DENIED`.
4. **Huge ID Buffer Poisoning**: Attempting to write document with 2KB junk string ID `students/{2KB_string}`. Expect: `PERMISSION_DENIED` via `isValidId()`.
5. **Score Underflow/Corruption**: Attempting to set student score to invalid type or out-of-range integer `{ "score": -9999 }` or `{ "score": "A+" }`. Expect: `PERMISSION_DENIED`.
6. **Orphan Point Log Injection**: Creating a point record under non-existent student path `/students/fake_student_999/points/p1`. Expect: `PERMISSION_DENIED`.
7. **Invalid Point Category Type**: Attempting to create category with invalid type `{ "type": "arbitrary_hack" }` instead of `"punishment" | "reward"`. Expect: `PERMISSION_DENIED`.
8. **Massive Payload String (Denial of Wallet)**: Counseling description containing 10MB string exceeding `desc.size() <= 3000`. Expect: `PERMISSION_DENIED`.
9. **Admin Document Self-Promotion**: Non-admin authenticated user creating `/admins/{request.auth.uid}` with role `superadmin`. Expect: `PERMISSION_DENIED`.
10. **Terminal Case Tampering**: Updating a counseling session with illegal status transition or modified student name. Expect: `PERMISSION_DENIED`.
11. **Client Timestamp Manipulation**: Client supplying manipulated future timestamp on point creation instead of bounded format. Expect: `PERMISSION_DENIED`.
12. **Blanket Query Scraping**: Malicious client running open query across all school documents without auth. Expect: `PERMISSION_DENIED`.

---

## 3. Security Rules Architecture
- Catch-all default deny: `match /{document=**} { allow read, write: if false; }`.
- Centralized helper functions: `isSignedIn()`, `isVerified()`, `isAdmin()`, `isValidId(id)`, `incoming()`, `existing()`.
- Validations for each entity matching `firebase-blueprint.json` keys and size constraints.
