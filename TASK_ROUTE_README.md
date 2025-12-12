# Task Routes & Controllers – High-Level Guide

This document explains the **task routes** and their related **controllers**, the **Redis keys/commands** that are used, how **Google Maps** is integrated, and why the main flows are designed to be **race‑free** and **industry‑level**.

---

## 1. Files in This Module

**Routes**
- `routes/taskRoute/taskRoute.js` – common task routes
- `routes/taskRoute/helpseekerTaskRoute.js` – routes used by helpseekers
- `routes/taskRoute/helperTaskRoute.js` – routes used by helpers

**Controllers**
- `controllers/taskController/helpseekerTaskController.js`
- `controllers/taskController/helperTaskController.js`
- `controllers/taskController/commonTaskController.js`

---

## 2. Route → Controller Mapping

### 2.1 Helpseeker task routes (helpseekerTaskRoute.js)

Base path: `/tasks`

- `POST /create` → `createTask`
- `PUT /:taskId` → `updateTask`
- `POST /:taskId/publish` → `publishTask`
- `POST /:taskId/schedule-publish` → `scheduleTaskPublish`
- `DELETE /:taskId/cancel-schedule` → `cancelScheduledPublish`
- `GET /my-tasks` → `getMyTasks`
- `GET /nearby-helpers` → `getNearbyHelpers`
- `DELETE /:taskId/cancel` → `cancelTask`
- `PATCH /:taskId/increase-reward` → `increaseReward`
- `POST /:taskId/regenerate-otp` → `regenerateOTP`

All are protected by authentication and user type checks.

### 2.2 Helper task routes (helperTaskRoute.js)

Base path: `/tasks`

- `GET /available` → `getAvailableTasks`
- `POST /:taskId/accept` → `acceptTask`
- `POST /:taskId/reject` → `rejectTask`
- `PATCH /:taskId/reject/reason` → `updateRejectionReason`
- `POST /:taskId/pass` → `passTask`
- `POST /:taskId/verify-otp` → `verifyOTPAndStartTask`
- `GET /helper/my-tasks` → `getMyAcceptedTasks`
- `GET /helper/my-tasks/:taskId` → `getMyTaskDetails`

### 2.3 Common task routes (taskRoute.js)

Base path: `/tasks`

- `GET /popular-jobs` → `getMostPopularJobsInArea`
- `GET /:taskId` → `getTaskById` (common read-only view)

---

## 3. Helpseeker Controller – Main Functions

File: `controllers/taskController/helpseekerTaskController.js`

### 3.1 `createTask`
- Creates a **draft** task for the current helpseeker.
- Validates:
  - Budget is a positive number.
  - Location (lat/lng/address) when `locationRequired` is true.
  - Steps array structure.
- Saves attachments uploaded via Supabase.
- **Status after create**: `draft` (not yet visible to helpers).

### 3.2 `updateTask`
- Edits an existing **draft** task (title, description, budget, location, steps, attachments).
- Only works when `status === 'draft'`.
- Parses JSON fields safely when they come from `multipart/form-data`.

### 3.3 `publishTask`
**Goal:** Move a draft task into the **queue**, index it in Redis, and start background matching.

Steps in simple words:
1. Start a **database transaction** with strong isolation (SERIALIZABLE).
2. Find the task by `id` and `helpseekerId`, and take a **row lock** on it.
3. If the task is not found → 404.
4. If it is not in `draft` state → 400 (only draft can be published).
5. Change status to `in_queue` and save **inside the transaction**.
6. Count existing queue rows, clean any old queue rows for this task, and insert **exactly one** new queue row.
7. Commit the transaction.
8. After commit, store the job in Redis and start background work:
   - Cache entry `job:{taskId}`.
   - Add ID to sorted set `jobs:published`.
   - Start matching helpers in background (distance + sockets + notifications).

Why this is race‑free and industry level:
- Two quick publish calls for the same task both try to lock the same row.
  - Only one transaction gets the lock first and changes `status` from `draft` → `in_queue`.
  - The second transaction sees the task no longer in `draft` and returns 400 without duplicating queue rows.
- Status change and queue row creation happen **atomically** inside one transaction.
- Expensive work (distance checks, notifications) runs in **background** using `setImmediate`, so user response stays fast.

### 3.4 `scheduleTaskPublish`
- Allows a helpseeker to choose a future date/time when the task should be auto-published.
- Converts from IST to UTC correctly, stores the **actual publish time** (1 hour before requested time) in `scheduledPublishAt` and `isScheduled = true`.

### 3.5 `cancelScheduledPublish`
- Cancels a scheduled publish for a draft task.
- Clears `scheduledPublishAt` and `isScheduled`.

### 3.6 `getMyTasks`
- Returns all tasks created by the logged-in helpseeker.
- Optional `status` filter.

### 3.7 `cancelTask`
- Cancels a task (if not already completed/cancelled).
- If a helper is assigned, sends a notification to that helper.
- Status becomes `cancelled` and any queue row is removed.

### 3.8 `increaseReward`
- Increases the reward/budget for a task that is currently in queue.
- Notifies approved helpers about the changed reward.

### 3.9 `regenerateOTP`
- For an `assigned` task where OTP is not yet verified.
- Creates a new OTP, updates the task, and sends notifications to helpseeker and helper.

### 3.10 `getNearbyHelpers`
- Uses the helpseeker’s address (lat/lng) and finds **online helpers** near them.
- Reads online helper IDs from Redis sorted set `helpers:available`.
- For each helper, reads `helper:online:{helperId}` from Redis to get profile + address.
- Uses **Google Maps Distance Matrix API** (see section 5) to calculate **road distance** and filters helpers within configured radius.

---

## 4. Helper Controller – Main Functions

File: `controllers/taskController/helperTaskController.js`

### 4.1 `getAvailableTasks`
**Goal:** Show a helper the tasks currently available **for them**.

Main steps:
1. Check the helper is **online** using Redis key `helper:online:{helperId}`.
2. Load task IDs from Redis sorted set `jobs:published`.
3. For each ID, fetch `job:{taskId}` (task data) in parallel.
4. Validate tasks against the database in **one query** (using `WHERE id IN (...)` and status in `['in_queue','published']`).
5. Clean up any stale Redis entries **in background**.
6. Use association lists from Redis:
   - `helper:{helperId}:associated_tasks`
   - `task:{taskId}:associated_helpers`
   to only show tasks meant for this helper.
7. For all remaining tasks, batch-load actions from `task:{taskId}:actions` to filter out tasks this helper already **rejected** or **passed**.
8. For tasks that require location, compute distances from helper → task using Google Maps Distance Matrix in **batches** (up to 25 destinations per call); fallback to Haversine formula if API is not available.

Why this is performant and safe:
- Uses **Redis** for fast reads and **one DB query** to validate tasks.
- Distance calculations are **batched**, not one call per task.
- All heavy work is read-only, so there is no race on writes.

### 4.2 `acceptTask`
**Goal:** Let a helper accept a task in a **race‑free** way (only one helper wins) and generate an OTP.

Main safety pattern:
1. Start a **SERIALIZABLE transaction**.
2. Load the task with `FOR UPDATE` row lock.
3. If no task → rollback and 404.
4. Check Redis `job:{taskId}` exists; if not, rollback and 404.
5. Ensure task status is in `['in_queue','published']` and `assignedHelperId` is `null`.
6. Set `assignedHelperId`, set status to `assigned`, store OTP, and save inside transaction.
7. Delete TaskQueue row and mark helper as unavailable inside the same transaction.
8. Update Redis **before commit**:
   - Delete `job:{taskId}`.
   - Remove taskId from `jobs:published`.
   - Remove helper from `helper:online:{helperId}` and `helpers:available`.
   - Clear `task:{taskId}:actions`.
9. If Redis update fails, rollback transaction (no half-assigned tasks).
10. Commit transaction.
11. In **background** (setImmediate), store tracking locations and send notifications.

Why this is race‑free and industry level:
- Database row lock + strict transaction isolation ensures only one helper sees the task as free and wins the assignment.
- Redis cache is updated **before** commit; if Redis fails, nothing is committed and the task stays unassigned.
- Expensive extras (tracking + notifications) are async so they do not slow down the HTTP response.

### 4.3 `rejectTask`
- Marks that a helper **rejected** a task using Redis list at `task:{taskId}:actions`.
- Prevents the same helper from acting twice on the same task.
- Updates association keys:
  - `helper:{helperId}:associated_tasks` (removes the task).
  - `task:{taskId}:associated_helpers` (removes the helper).
- Starts a **background reassignment**:
  - Finds another nearby helper using `findAndAssociateNearestHelper`.
  - Updates `task:{taskId}:associated_helpers` and that helper’s `helper:{newHelperId}:associated_tasks`.
- Uses a **Redis lock key** `task:{taskId}:reassign_lock` with short TTL to ensure only **one** reassignment job runs at a time, even if many helpers reject at once.

### 4.4 `updateRejectionReason`
- Lets a helper later add or change the rejection reason.
- Reads and writes `task:{taskId}:actions` in Redis.
- Notifies the helpseeker with the updated reason.

### 4.5 `passTask`
- Similar to `rejectTask`, but marks the action as **passed**.
- Updates association keys to remove the helper from that task.
- Triggers the **same background reassignment** logic with the same Redis lock `task:{taskId}:reassign_lock`.

### 4.6 `verifyOTPAndStartTask`
- The assigned helper submits an OTP for a task in `arrived` status.
- Validates:
  - Helper is the one assigned.
  - Task is in `arrived` state.
  - OTP matches and is not expired (24h).
- Sets status to `in_progress` and timestamps, sends notifications.

### 4.7 `getMyAcceptedTasks` and `getMyTaskDetails`
- Read the tasks assigned to the current helper, including helpseeker details and address.

---

## 5. Common Controller – Main Functions

File: `controllers/taskController/commonTaskController.js`

### 5.1 `getTaskById`
- Public read-only endpoint (for authenticated users) to view a task by `id`.
- Includes basic info about helpseeker (creator) and assigned helper.

### 5.2 `getMostPopularJobsInArea`
- Uses the user’s default address to find **popular job categories** around them.
- If the address has lat/lng:
  - Uses a SQL Haversine formula to count completed/in-progress/assigned tasks within a radius.
  - Groups by category and computes stats (count, min, max, avg budget).
- If there is only city/state:
  - Falls back to filtering by city/state in SQL.

---

## 6. Redis – Keys and Commands in Simple Words

### 6.1 Main Redis keys

- `job:{taskId}` – JSON of a published task used to show available jobs.
- `jobs:published` – **sorted set** of task IDs currently published/in queue.
- `helper:online:{helperId}` – JSON of an online helper (profile + addresses).
- `helpers:available` – **sorted set** of helper IDs currently online/available.
- `helper:{helperId}:associated_tasks` – list of task IDs shown/associated to that helper.
- `task:{taskId}:associated_helpers` – list of helper IDs currently associated to that task.
- `task:{taskId}:actions` – list of actions taken by helpers on that task (rejected/passed + reason + time).
- `tracking:task:{taskId}:helper:{helperId}` – temporary location data for helper on a task.
- `tracking:task:{taskId}:helpseeker:{helpseekerId}` – temporary location data for helpseeker on a task.
- `task:{taskId}:reassign_lock` – small lock key to prevent multiple reassignments at the same time.

### 6.2 Redis commands used

In simple words:
- `GET key` – read a value.
- `SET key value` – store a value.
- `SETEX key ttl value` – store a value with an **expiry time** (it auto-deletes after `ttl` seconds).
- `EXPIRE key ttl` – set expiry on an existing key.
- `DEL key` – delete a key.
- `ZADD key {score, member}` – add a member to a **sorted set** (score is used for ordering).
- `ZRANGE key 0 -1` – read all members from a sorted set.
- `ZREM key member` – remove a member from a sorted set.
- `ZCARD key` – count the number of members in a sorted set.

These are used to:
- Keep track of online helpers and published jobs very quickly.
- Avoid heavy database scans for simple “who is online / what jobs are open” questions.

---

## 7. Google Maps Integration in Simple Words

The project uses **Google Maps Distance Matrix API** to compute **real road distance and travel time** between two points.

Where it is used:
- `getNearbyHelpers` (helpseeker side): helpseeker → many helpers.
- `getAvailableTasks` and background matching: helper → many tasks.

Pattern:
- Build an origin string: `"lat,lng"`.
- Build multiple destination strings joined with `|`: `"lat1,lng1|lat2,lng2|..."`.
- Call the Distance Matrix API **once per batch** (up to 25 destinations) instead of one call per record.
- Use the returned distance and duration to:
  - Filter items within a max radius.
  - Sort helpers or tasks by nearest distance.
- A separate cache service (`distanceCacheService`) is used to store distances in Redis so repeated requests don’t keep hitting Google.

If Google Maps is not available (no key or error), the code falls back to a local **Haversine** function (straight-line distance).

---

## 8. Why This Design Is Race‑Free and Industry Level

**1. Strong database transactions where it matters**
- `acceptTask` and `publishTask` use **SERIALIZABLE** transactions + row locks.
- This ensures only one writer at a time can change critical fields (`status`, `assignedHelperId`, queue rows) for a given task.

**2. Idempotent operations**
- `publishTask` checks that the task is `draft` under a lock; if not, it refuses to publish again.
- `TaskQueue` entries for a task are cleaned and recreated inside the same transaction to avoid duplicates.

**3. Clear separation of fast path vs. heavy work**
- HTTP responses only wait for **minimal** DB and Redis operations.
- Slow work (distance calculations, notifications, socket broadcasts, reassignment) happens in **background** via `setImmediate`.

**4. Redis locks for soft concurrency cases**
- Reassignment after `rejectTask` and `passTask` is guarded by a small Redis lock `task:{taskId}:reassign_lock` so multiple helpers acting at the same time do not cause multiple reassignments.

**5. Cache + DB validation combo**
- Read‑heavy flows (like `getAvailableTasks`) read from Redis first for speed, then **validate** in the database using batch queries.
- Stale Redis data is automatically cleaned in background, which is a common, robust pattern.

**6. Defensive input validation and clear error codes**
- All critical endpoints validate IDs, statuses, and coordinates clearly.
- Clients get consistent HTTP status codes and messages.

Together, these patterns (transactions, locks, caching, async background jobs, and strong validation) are what you typically see in **production, industry‑grade** backend systems that need to handle high concurrency and keep response times fast.
