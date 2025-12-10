#  Complete Architecture & Flow Diagram

## System Overview: Task Routes, Tracking Routes, Helper Routes Integration
This document provides a comprehensive view of how **taskRoute**, **trackingRoute**, and **helperRoute** work together with Redis, PostgreSQL, and Socket.io to create a real-time task management system.

---

## Table of Contents
1. [System Architecture Overview](#system-architecture-overview)
2. [Route Structure & Endpoints](#route-structure--endpoints)
3. [Redis Data Structures](#redis-data-structures)
4. [Complete Flow Diagrams](#complete-flow-diagrams)
5. [API Endpoint Details](#api-endpoint-details)
6. [Integration Points](#integration-points)

---

##  System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATIONS                              │
│                  (Mobile Apps / Web Dashboard)                           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ HTTP/HTTPS Requests
                                │ WebSocket Connections
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXPRESS.JS SERVER                                │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  taskRoute   │  │ helperRoute  │  │trackingRoute │                  │
│  │  /api/tasks  │  │ /api/helpers │  │ /api/tracking│                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                  │                  │                          │
│         └──────────────────┴──────────────────┘                          │
│                            │                                             │
│         ┌──────────────────┴──────────────────┐                          │
│         │   Authentication Middleware          │                          │
│         │   - checkForAuthenticationCookie()   │                          │
│         │   - checkUserType(['helper','...'])  │                          │
│         └──────────────────┬──────────────────┘                          │
│                            │                                             │
│         ┌──────────────────┴──────────────────┐                          │
│         │          CONTROLLERS                 │                          │
│         │  - helpseekerTaskController.js       │                          │
│         │  - helperTaskController.js           │                          │
│         │  - trackingController.js             │                          │
│         │  - helperController.js               │                          │
│         └──────────────────┬──────────────────┘                          │
│                            │                                             │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
                  ▼                     ▼
        ┌──────────────────┐  ┌──────────────────┐
        │   REDIS CACHE    │  │   POSTGRESQL DB  │
        │   (Upstash)      │  │   (Supabase)     │
        │                  │  │                  │
        │  Real-time Data  │  │  Persistent Data │
        │  - Online Helpers│  │  - Tasks         │
        │  - Task Queue    │  │  - Helpers       │
        │  - Associations  │  │  - Tracking      │
        │  - Actions       │  │  - Ratings       │
        │  - Locations     │  │  - Payments      │
        └──────────────────┘  └──────────────────┘
                  │
                  │ Real-time Updates
                  ▼
        ┌──────────────────┐
        │   SOCKET.IO      │
        │   Service        │
        │                  │
        │  - Helper Status │
        │  - Task Updates  │
        │  - Location Track│
        └──────────────────┘
```

---

## 🛣️ Route Structure & Endpoints

### 1️⃣ **taskRoute** (`/api/tasks`)

Main route that delegates to two sub-routes:

```
/api/tasks
├── / (helpseekerTaskRoute) → Task Creation & Management
│   ├── POST   /create                     → Create draft task
│   ├── PUT    /:taskId                    → Update draft task
│   ├── POST   /:taskId/publish            → Publish to queue
│   ├── POST   /:taskId/schedule-publish   → Schedule future publish
│   ├── DELETE /:taskId/cancel-schedule    → Cancel scheduled publish
│   ├── GET    /my-tasks                   → Get my created tasks
│   ├── GET    /nearby-helpers             → Find helpers in area
│   ├── DELETE /:taskId/cancel             → Cancel task
│   ├── PATCH  /:taskId/increase-reward    → Increase task budget
│   └── POST   /:taskId/regenerate-otp     → Regenerate task OTP
│
├── / (helperTaskRoute) → Task Discovery & Actions
│   ├── GET    /available                  → Get available tasks
│   ├── POST   /:taskId/accept             → Accept task (generates OTP)
│   ├── POST   /:taskId/reject             → Reject task
│   ├── PATCH  /:taskId/reject/reason      → Update rejection reason
│   ├── POST   /:taskId/pass               → Pass on task
│   ├── POST   /:taskId/verify-otp         → Verify OTP & start task
│   ├── GET    /helper/my-tasks            → Get my accepted tasks
│   └── GET    /helper/my-tasks/:taskId    → Get task details
│
└── Common
    ├── GET    /popular-jobs               → Popular jobs in area
    └── GET    /:taskId                    → Get task by ID
```

### 2️⃣ **helperRoute** (`/api/helpers`)

```
/api/helpers
├── GET    /availability                   → Get helper availability status
├── PATCH  /availability                   → Toggle online/offline
├── GET    /available/count                → Count available helpers
├── GET    /debug/redis                    → Debug Redis state
├── GET    /tasks/active                   → Get helper's active tasks
└── GET    /:userId/tasks/completed        → Get completed tasks
```

### 3️⃣ **trackingRoute** (`/api/tracking`)

```
/api/tracking
├── POST   /task/:taskId/on-the-way        → Helper on the way
├── POST   /task/:taskId/arrived           → Helper arrived
├── POST   /task/:taskId/complete-work     → Complete task (with photos)
├── PATCH  /task/:taskId/location          → Update helper location
├── GET    /task/:taskId                   → Get task tracking info
└── GET    /task/:taskId/location          → Get helper's current location
```

---

## 💾 Redis Data Structures

### **Key Patterns Used:**

```javascript
// 1. Online Helpers
helper:online:{helperId}
{
  id: "uuid",
  fullName: "string",
  email: "string",
  phone: "string",
  profilePhoto: "url",
  isAvailable: true,
  averageRating: 4.5,
  completedTasks: 10,
  addresses: [...],
  onlineAt: "ISO timestamp"
}
TTL: 43200 seconds (12 hours)

// 2. Available Helpers Sorted Set
helpers:available
- Score: timestamp (for ordering)
- Members: helper IDs
Purpose: Fast count of available helpers

// 3. Task Queue
job:{taskId}
{
  taskId: "uuid",
  title: "string",
  description: "string",
  location: { lat, lng },
  status: "in_queue",
  budget: number,
  helpseekerId: "uuid",
  createdAt: "ISO timestamp",
  ...
}
TTL: 2592000 seconds (30 days)

// 4. Task-Helper Associations (1-to-1)
task:{taskId}:associated_helpers
["helperId"]  // Array with 1 helper
TTL: 2592000 seconds (30 days)

// 5. Helper-Task Associations (1-to-many)
helper:{helperId}:associated_tasks
["taskId1", "taskId2", ...]  // Multiple tasks
TTL: 43200 seconds (12 hours)

// 6. Helper Actions on Tasks
task:{taskId}:actions
[
  {
    helperId: "uuid",
    action: "passed" | "rejected",
    reason: "string" (optional),
    timestamp: "ISO timestamp"
  }
]
TTL: 2592000 seconds (30 days)

// 7. Real-time Location Tracking
tracking:task:{taskId}:helper:{helperId}
{
  latitude: number,
  longitude: number,
  accuracy: number,
  timestamp: "ISO timestamp",
  speed: number,
  heading: number
}
TTL: 3600 seconds (1 hour)

tracking:task:{taskId}:helpseeker:{helpseekerId}
{
  latitude: number,
  longitude: number,
  accuracy: number,
  timestamp: "ISO timestamp"
}
TTL: 3600 seconds (1 hour)
```

---

## 🔄 Complete Flow Diagrams

### Flow 1: **Task Lifecycle (Helpseeker to Helper)**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TASK LIFECYCLE FLOW                                   │
└─────────────────────────────────────────────────────────────────────────┘

HELPSEEKER                          SYSTEM                         HELPER
    │                                 │                               │
    │ 1. POST /api/tasks/create       │                               │
    ├────────────────────────────────►│                               │
    │    (draft task created)         │                               │
    │                                 │ ─► PostgreSQL: Insert Task    │
    │                                 │    status: 'draft'            │
    │                                 │                               │
    │ 2. POST /tasks/:id/publish      │                               │
    ├────────────────────────────────►│                               │
    │                                 │                               │
    │                                 │ ─► Update PostgreSQL:         │
    │                                 │    status: 'in_queue'         │
    │                                 │                               │
    │                                 │ ─► Redis: SET job:{taskId}    │
    │                                 │    (task data)                │
    │                                 │                               │
    │                                 │ ─► associateHelpersWithTask() │
    │                                 │    • Get online helpers       │
    │                                 │    • Check acted helpers      │
    │                                 │    • Calculate distances      │
    │                                 │    • Find nearest (≤100km)    │
    │                                 │                               │
    │                                 │ ─► Redis: SET                 │
    │                                 │    task:{id}:associated_helpers│
    │                                 │    → ["helperId"]             │
    │                                 │                               │
    │                                 │ ─► Redis: SET                 │
    │                                 │    helper:{id}:associated_tasks│
    │                                 │    → ["taskId"]               │
    │                                 │                               │
    │                                 │ ─► Socket.io: Notify helper   │
    │                                 │    "new_task_available"       │
    │                                 │                               │
    │                                 │          3. GET /tasks/available
    │                                 │◄──────────────────────────────┤
    │                                 │                               │
    │                                 │ ─► Check Redis:               │
    │                                 │    helper:{id}:associated_tasks│
    │                                 │                               │
    │                                 │ ─► Filter out acted tasks     │
    │                                 │    (task:{id}:actions)        │
    │                                 │                               │
    │                                 │ ─► Return tasks ─────────────►│
    │                                 │                               │
    │                                 │     4. POST /tasks/:id/accept │
    │                                 │◄──────────────────────────────┤
    │                                 │                               │
    │                                 │ ─► Generate OTP               │
    │                                 │ ─► Update PostgreSQL:         │
    │                                 │    status: 'assigned'         │
    │                                 │    assignedHelperId           │
    │                                 │    otp, otpExpiry             │
    │                                 │                               │
    │                                 │ ─► Send OTP to Helpseeker     │
    │◄────────────────────────────────│    (via notification/email)   │
    │                                 │                               │
    │                                 │ ─► Return OTP ───────────────►│
    │                                 │                               │
    │ 5. Share OTP with Helper        │                               │
    │ (via phone/app)                 │                               │
    ├────────────────────────────────────────────────────────────────►│
    │                                 │                               │
    │                                 │  6. POST /tasks/:id/verify-otp│
    │                                 │◄──────────────────────────────┤
    │                                 │     {otp: "123456"}           │
    │                                 │                               │
    │                                 │ ─► Verify OTP                 │
    │                                 │ ─► Update PostgreSQL:         │
    │                                 │    status: 'in_progress'      │
    │                                 │    startedAt: timestamp       │
    │                                 │                               │
    │                                 │ ─► Socket.io: Notify both     │
    │◄────────────────────────────────│    "task_started"             │
    │                                 │                               │
    │                                 │         [TASK IN PROGRESS]    │
    │                                 │                               │
```

### Flow 2: **Helper Availability Toggle & Task Association**

```
┌─────────────────────────────────────────────────────────────────────────┐
│              HELPER AVAILABILITY & TASK ASSOCIATION                      │
└─────────────────────────────────────────────────────────────────────────┘

HELPER                              REDIS                       POSTGRESQL
  │                                   │                               │
  │ 1. PATCH /helpers/availability    │                               │
  │    (toggle online)                │                               │
  ├──────────────────────────────────►│                               │
  │                                   │                               │
  │                                   │ ◄─── Update DB: ──────────────┤
  │                                   │      isAvailable = true       │
  │                                   │                               │
  │◄─── Store in Redis ───────────────┤                               │
  │     SET helper:online:{id}        │                               │
  │     TTL: 43200s                   │                               │
  │                                   │                               │
  │◄─── Add to sorted set ────────────┤                               │
  │     ZADD helpers:available        │                               │
  │     score: timestamp              │                               │
  │                                   │                               │
  │◄─── Find nearest task ────────────┤                               │
  │     KEYS job:*                    │                               │
  │     For each task:                │                               │
  │       ✅ Check not acted          │                               │
  │          (task:{id}:actions)      │                               │
  │       ✅ Check not associated     │                               │
  │       ✅ Calculate distance       │                               │
  │       ✅ Filter ≤50km             │                               │
  │                                   │                               │
  │◄─── Associate with nearest ───────┤                               │
  │     SET task:{id}:associated_helpers                              │
  │     → [helperId]                  │                               │
  │                                   │                               │
  │     SET helper:{id}:associated_tasks                              │
  │     → [taskId]                    │                               │
  │                                   │                               │
  │◄─── Socket.io broadcast ──────────┤                               │
  │     "helper_online"               │                               │
  │                                   │                               │
  │                                                                   │
  │ 2. PATCH /helpers/availability    │                               │
  │    (toggle offline)               │                               │
  ├──────────────────────────────────►│                               │
  │                                   │                               │
  │                                   │ ◄─── Update DB: ──────────────┤
  │                                   │      isAvailable = false      │
  │                                   │                               │
  │◄─── Remove from Redis ────────────┤                               │
  │     DEL helper:online:{id}        │                               │
  │     ZREM helpers:available        │                               │
  │                                   │                               │
  │◄─── Get associated tasks ─────────┤                               │
  │     GET helper:{id}:associated_tasks                              │
  │     → [task1, task2, ...]         │                               │
  │                                   │                               │
  │◄─── Reassign tasks ───────────────┤                               │
  │     For each task:                │                               │
  │       • Remove from task:{id}:    │                               │
  │         associated_helpers        │                               │
  │       • Find replacement helper   │                               │
  │       • Update associations       │                               │
  │                                   │                               │
  │◄─── Delete helper tasks ──────────┤                               │
  │     DEL helper:{id}:associated_tasks                              │
  │                                   │                               │
  │◄─── Socket.io broadcast ──────────┤                               │
  │     "helper_offline"              │                               │
  │                                   │                               │
```

### Flow 3: **Task Actions (Accept, Reject, Pass)**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      TASK ACTIONS FLOW                                   │
└─────────────────────────────────────────────────────────────────────────┘

ACTION                            REDIS                         RESULT
  │                                 │                               │
  │                                                                 │
┌─┴──────────────────────────┐                                     │
│  POST /tasks/:id/reject    │                                     │
└─┬──────────────────────────┘                                     │
  │                                                                 │
  ├──► Check hasHelperActedOnTask()                                │
  │    GET task:{id}:actions                                       │
  │    If acted → Return 409 Conflict                              │
  │                                                                 │
  ├──► Store action in Redis                                       │
  │    SET task:{id}:actions                                       │
  │    → [{helperId, action:"rejected", reason, timestamp}]        │
  │                                                                 │
  ├──► Remove associations                                         │
  │    DEL task:{id}:associated_helpers                            │
  │    UPDATE helper:{id}:associated_tasks (remove taskId)         │
  │                                                                 │
  ├──► Find replacement helper                                     │
  │    • Get online helpers                                        │
  │    • Exclude acted helpers                                     │
  │    • Calculate distances                                       │
  │    • Associate nearest helper                                  │
  │                                                                 │
  ├──► Find other tasks for THIS helper                            │
  │    associateTasksWithHelper()                                  │
  │    • Get published tasks                                       │
  │    • Filter acted tasks                                        │
  │    • Filter already associated                                 │
  │    • Calculate distances                                       │
  │    • Associate nearest task                                    │
  │                                                                 │
  └──► Return success ────────────────────────────────────────────►│
                                                                    │
                                                                    │
┌─┴──────────────────────────┐                                     │
│  POST /tasks/:id/pass      │                                     │
└─┬──────────────────────────┘                                     │
  │                                                                 │
  │  [SAME FLOW AS REJECT]                                         │
  │  Stores action: "passed"                                       │
  │  Reason: "Helper passed on this task"                          │
  │                                                                 │
  └──► Return success ────────────────────────────────────────────►│
                                                                    │
                                                                    │
┌─┴──────────────────────────┐                                     │
│  POST /tasks/:id/accept    │                                     │
└─┬──────────────────────────┘                                     │
  │                                                                 │
  ├──► Check hasHelperActedOnTask()                                │
  │    If acted → Return 409 Conflict                              │
  │                                                                 │
  ├──► Check task status = 'in_queue'                              │
  │                                                                 │
  ├──► Generate 6-digit OTP                                        │
  │    otpExpiry = 15 minutes                                      │
  │                                                                 │
  ├──► Update PostgreSQL                                           │
  │    status: 'assigned'                                          │
  │    assignedHelperId: helperId                                  │
  │    otp: encrypted OTP                                          │
  │    otpExpiry: timestamp                                        │
  │                                                                 │
  ├──► Remove from Redis queue                                     │
  │    DEL job:{taskId}                                            │
  │                                                                 │
  ├──► Send OTP notification                                       │
  │    • Email to helpseeker                                       │
  │    • Push notification                                         │
  │    • Socket.io event                                           │
  │                                                                 │
  └──► Return OTP ────────────────────────────────────────────────►│
       (for development/testing)                                   │
```

### Flow 4: **Real-time Tracking**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REAL-TIME TRACKING FLOW                               │
└─────────────────────────────────────────────────────────────────────────┘

HELPER                        REDIS                         HELPSEEKER
  │                             │                                 │
  │ 1. POST /tracking/task/:id/on-the-way                         │
  ├────────────────────────────►│                                 │
  │                             │                                 │
  │     Update PostgreSQL ◄─────┤                                 │
  │     taskStatus: 'on_the_way'│                                 │
  │                             │                                 │
  │     Socket.io broadcast ────┼────────────────────────────────►│
  │     "task_status_update"    │    Notification: "Helper is     │
  │                             │     on the way!"                │
  │                             │                                 │
  │ 2. PATCH /tracking/task/:id/location                          │
  │    {latitude, longitude}    │                                 │
  ├────────────────────────────►│                                 │
  │                             │                                 │
  │     Store in Redis ◄────────┤                                 │
  │     SET tracking:task:{id}: │                                 │
  │         helper:{helperId}   │                                 │
  │     {lat, lng, timestamp}   │                                 │
  │     TTL: 3600s              │                                 │
  │                             │                                 │
  │     Update PostgreSQL ◄─────┤                                 │
  │     currentLatitude,        │                                 │
  │     currentLongitude        │                                 │
  │                             │                                 │
  │     Socket.io broadcast ────┼────────────────────────────────►│
  │     "location_update"       │    Map updates in real-time     │
  │                             │                                 │
  │                             │  GET /tracking/task/:id/location│
  │                             │◄────────────────────────────────┤
  │                             │                                 │
  │                             │  Get from Redis: ───────────────┤
  │                             │  tracking:task:{id}:helper:{id} │
  │                             │  Return {lat, lng, timestamp}   │
  │                             │                                 │
  │ 3. POST /tracking/task/:id/arrived                            │
  ├────────────────────────────►│                                 │
  │                             │                                 │
  │     Update PostgreSQL ◄─────┤                                 │
  │     taskStatus: 'arrived'   │                                 │
  │     arrivedAt: timestamp    │                                 │
  │                             │                                 │
  │     Socket.io broadcast ────┼────────────────────────────────►│
  │     "helper_arrived"        │    Notification: "Helper has    │
  │                             │     arrived!"                   │
  │                             │                                 │
  │ 4. POST /tracking/task/:id/complete-work                      │
  │    {photos: [file1, file2]} │                                 │
  ├────────────────────────────►│                                 │
  │                             │                                 │
  │     Upload to Supabase ◄────┤                                 │
  │     Storage (photos)        │                                 │
  │                             │                                 │
  │     Update PostgreSQL ◄─────┤                                 │
  │     taskStatus: 'completed' │                                 │
  │     completedAt: timestamp  │                                 │
  │     completionPhotos: [urls]│                                 │
  │                             │                                 │
  │     Clean up Redis ◄────────┤                                 │
  │     DEL tracking:task:{id}: │                                 │
  │         helper:{helperId}   │                                 │
  │     DEL tracking:task:{id}: │                                 │
  │         helpseeker:{id}     │                                 │
  │     DEL task:{id}:          │                                 │
  │         associated_helpers  │                                 │
  │     DEL helper:{id}:        │                                 │
  │         associated_tasks    │                                 │
  │     DEL job:{taskId}        │                                 │
  │                             │                                 │
  │     Mark helper available ◄─┤                                 │
  │     SET helper:online:{id}  │                                 │
  │     ZADD helpers:available  │                                 │
  │                             │                                 │
  │     Socket.io broadcast ────┼────────────────────────────────►│
  │     "task_completed"        │    "Please rate the helper"     │
  │                             │                                 │
```

---

## 📡 API Endpoint Details

### **Task Routes**

#### **POST /api/tasks/create** (Helpseeker)
- **Purpose:** Create a new draft task
- **Auth:** Helpseeker or Helper
- **Body:** Task details (title, description, location, budget, steps, attachments)
- **Flow:**
  1. Upload attachments to Supabase Storage
  2. Create task in PostgreSQL with status='draft'
  3. Return created task
- **Redis:** No Redis interaction
- **Socket:** No broadcast

---

#### **POST /api/tasks/:taskId/publish** (Helpseeker)
- **Purpose:** Publish task to queue and find nearest helper
- **Auth:** Helpseeker or Helper
- **Flow:**
  1. Validate task exists and status='draft'
  2. Update PostgreSQL: status='in_queue', publishedAt=now
  3. Store in Redis: `job:{taskId}` with task data (TTL: 30 days)
  4. **Run associateHelpersWithTask():**
     - Get all online helpers from Redis (`helper:online:*`)
     - Get helpers who acted on task (`task:{taskId}:actions`)
     - Filter out acted helpers
     - Calculate distances using Google Maps API
     - Find nearest helper within 100km
     - Store: `task:{taskId}:associated_helpers` → [helperId]
     - Store: `helper:{helperId}:associated_tasks` → [taskId]
  5. Socket.io: Broadcast to associated helper "new_task_available"
- **Redis Keys:**
  - `job:{taskId}` → Task data
  - `task:{taskId}:associated_helpers` → [helperId]
  - `helper:{helperId}:associated_tasks` → [taskId]

---

#### **GET /api/tasks/available** (Helper)
- **Purpose:** Get list of available tasks for helper
- **Auth:** Helper or Helpseeker
- **Query:** `?radius=50&latitude=26.92&longitude=75.82`
- **Flow:**
  1. Get helper's associated tasks: `helper:{helperId}:associated_tasks`
  2. For each task, verify status='in_queue' in PostgreSQL
  3. Filter out tasks where helper acted: `task:{taskId}:actions`
  4. Calculate distances (within 100km max)
  5. Return sorted by distance
- **Redis Keys:**
  - `helper:{helperId}:associated_tasks`
  - `job:{taskId}` (for verification)
  - `task:{taskId}:actions` (for filtering)

---

#### **POST /api/tasks/:taskId/accept** (Helper)
- **Purpose:** Accept task and generate OTP
- **Auth:** Helper or Helpseeker
- **Flow:**
  1. Check `hasHelperActedOnTask()` → If yes, return 409
  2. Verify task status='in_queue'
  3. Generate 6-digit OTP
  4. Update PostgreSQL:
     - status='assigned'
     - assignedHelperId=helperId
     - otp=encrypted OTP
     - otpExpiry=15 mins from now
  5. Delete from Redis: `job:{taskId}`
  6. Send OTP to helpseeker (notification)
  7. Socket.io: "task_assigned" to both users
- **Redis Keys:**
  - `task:{taskId}:actions` (check only)
  - `job:{taskId}` (delete)

---

#### **POST /api/tasks/:taskId/reject** (Helper)
- **Purpose:** Reject task and reassign to another helper
- **Auth:** Helper or Helpseeker
- **Body:** `{reason: "optional text"}`
- **Flow:**
  1. Check `hasHelperActedOnTask()` → If yes, return 409
  2. Store action: `task:{taskId}:actions` → {helperId, action:"rejected", reason, timestamp}
  3. Remove associations:
     - Delete `task:{taskId}:associated_helpers`
     - Update `helper:{helperId}:associated_tasks` (remove taskId)
  4. **Find replacement helper:**
     - Run `findAndAssociateNearestHelper(taskId, excludeHelperId)`
     - Updates task associations with new helper
  5. **Find other tasks for this helper:**
     - Run `associateTasksWithHelper(helperId, excludeTaskId)`
     - Associates helper with another available task
  6. Socket.io: Notify new helper "new_task_available"
- **Redis Keys:**
  - `task:{taskId}:actions` → Add rejection
  - `task:{taskId}:associated_helpers` → Remove helper
  - `helper:{helperId}:associated_tasks` → Remove task, add new task

---

#### **POST /api/tasks/:taskId/pass** (Helper)
- **Purpose:** Pass on task without explicit rejection
- **Auth:** Helper
- **Flow:** Same as reject, but action="passed", reason="Helper passed on this task"
- **Redis Keys:** Same as reject

---

#### **POST /api/tasks/:taskId/verify-otp** (Helper)
- **Purpose:** Verify OTP and start task
- **Auth:** Helper or Helpseeker
- **Body:** `{otp: "123456"}`
- **Flow:**
  1. Verify task status='assigned' and assignedHelperId matches
  2. Verify OTP matches and not expired
  3. Update PostgreSQL:
     - status='in_progress'
     - startedAt=now
     - Clear otp and otpExpiry
  4. Socket.io: "task_started" to both users
- **Redis:** No Redis interaction
- **Socket:** "task_started"

---

### **Helper Routes**

#### **PATCH /api/helpers/availability** (Helper)
- **Purpose:** Toggle helper online/offline status
- **Auth:** Helper
- **Flow (Going Online):**
  1. Update PostgreSQL: isAvailable=true
  2. Store in Redis: `helper:online:{helperId}` with full helper data (TTL: 12h)
  3. Add to sorted set: `ZADD helpers:available {score: timestamp, member: helperId}`
  4. **Find nearest available task:**
     - Get all tasks: `KEYS job:*`
     - For each task:
       - ✅ Check helper hasn't acted (`task:{taskId}:actions`)
       - ✅ Check task not already associated
       - ✅ Calculate distance (Google Maps API)
       - ✅ Filter within 50km
     - Associate with nearest task
  5. Socket.io: Broadcast "helper_online"
- **Flow (Going Offline):**
  1. Update PostgreSQL: isAvailable=false
  2. Delete from Redis:
     - `DEL helper:online:{helperId}`
     - `ZREM helpers:available {helperId}`
  3. Get associated tasks: `helper:{helperId}:associated_tasks`
  4. **Reassign each task:**
     - Remove from `task:{taskId}:associated_helpers`
     - Find replacement helper
     - Update new helper's associations
  5. Delete: `helper:{helperId}:associated_tasks`
  6. Socket.io: Broadcast "helper_offline"
- **Redis Keys:**
  - `helper:online:{helperId}`
  - `helpers:available` (sorted set)
  - `helper:{helperId}:associated_tasks`
  - `task:{taskId}:associated_helpers`
  - `job:*` (scan for available tasks)

---

#### **GET /api/helpers/available/count** (All Users)
- **Purpose:** Get count of currently available helpers
- **Auth:** Helper, Helpseeker, or Admin
- **Flow:**
  1. `ZCARD helpers:available` → Returns count
  2. Return count
- **Redis Keys:**
  - `helpers:available` (sorted set)

---

#### **GET /api/helpers/debug/redis** (Debug)
- **Purpose:** Debug Redis state (all keys and values)
- **Auth:** None (should be protected in production)
- **Flow:**
  1. Get all Redis keys
  2. Get values for each key
  3. Return formatted JSON
- **Redis:** Scans all keys

---

### **Tracking Routes**

#### **POST /api/tracking/task/:taskId/on-the-way** (Helper)
- **Purpose:** Mark that helper is on the way
- **Auth:** Helper
- **Flow:**
  1. Verify task status='in_progress' and helper is assigned
  2. Update PostgreSQL: taskStatus='on_the_way'
  3. Socket.io: "task_status_update" to helpseeker
- **Redis:** No Redis interaction
- **Socket:** "task_status_update"

---

#### **PATCH /api/tracking/task/:taskId/location** (Helper)
- **Purpose:** Update helper's current location in real-time
- **Auth:** Helper
- **Body:** `{latitude, longitude, accuracy, speed, heading}`
- **Flow:**
  1. Verify task in progress and helper assigned
  2. Store in Redis:
     - `tracking:task:{taskId}:helper:{helperId}`
     - Value: {lat, lng, accuracy, timestamp, speed, heading}
     - TTL: 1 hour
  3. Update PostgreSQL: currentLatitude, currentLongitude
  4. Socket.io: "location_update" to helpseeker (for live map)
- **Redis Keys:**
  - `tracking:task:{taskId}:helper:{helperId}` → Location data (1h TTL)

---

#### **GET /api/tracking/task/:taskId/location** (Helper & Helpseeker)
- **Purpose:** Get current helper location for task
- **Auth:** Helper or Helpseeker
- **Flow:**
  1. Verify task exists and user is authorized
  2. Get from Redis: `tracking:task:{taskId}:helper:{helperId}`
  3. If not in Redis, get from PostgreSQL (currentLatitude/Longitude)
  4. Return location data
- **Redis Keys:**
  - `tracking:task:{taskId}:helper:{helperId}` (read)

---

#### **POST /api/tracking/task/:taskId/arrived** (Helper)
- **Purpose:** Mark that helper has arrived at location
- **Auth:** Helper
- **Flow:**
  1. Verify task and helper
  2. Update PostgreSQL:
     - taskStatus='arrived'
     - arrivedAt=now
  3. Socket.io: "helper_arrived" to helpseeker
- **Redis:** No Redis interaction
- **Socket:** "helper_arrived"

---

#### **POST /api/tracking/task/:taskId/complete-work** (Helper)
- **Purpose:** Complete task with proof photos
- **Auth:** Helper
- **Body:** Multipart form-data with photos (max 10)
- **Flow:**
  1. Verify task and helper
  2. Upload photos to Supabase Storage
  3. Update PostgreSQL:
     - taskStatus='completed'
     - completedAt=now
     - completionPhotos=[urls]
  4. **Clean up Redis:**
     - `DEL tracking:task:{taskId}:helper:{helperId}`
     - `DEL tracking:task:{taskId}:helpseeker:{helpseekerId}`
     - `DEL task:{taskId}:associated_helpers`
     - `DEL helper:{helperId}:associated_tasks` (remove this taskId)
     - `DEL job:{taskId}`
  5. **Mark helper as available again:**
     - `SET helper:online:{helperId}` (if still online)
     - `ZADD helpers:available`
  6. Socket.io: "task_completed" to helpseeker
  7. Trigger rating/payment flow
- **Redis Keys (Deleted):**
  - `tracking:task:{taskId}:helper:{helperId}`
  - `tracking:task:{taskId}:helpseeker:{helpseekerId}`
  - `task:{taskId}:associated_helpers`
  - `helper:{helperId}:associated_tasks`
  - `job:{taskId}`

---

## 🔗 Integration Points

### **1. Task Publication → Helper Association**

```
publishTask()
   │
   ├─► PostgreSQL: Update status='in_queue'
   │
   ├─► Redis: SET job:{taskId}
   │
   └─► associateHelpersWithTask()
          │
          ├─► Redis: GET helper:online:*
          │
          ├─► Redis: GET task:{taskId}:actions
          │
          ├─► Google Maps API: Calculate distances
          │
          ├─► Redis: SET task:{taskId}:associated_helpers
          │
          ├─► Redis: SET helper:{helperId}:associated_tasks
          │
          └─► Socket.io: Notify helper
```

---

### **2. Helper Goes Online → Task Association**

```
toggleAvailability() [online]
   │
   ├─► PostgreSQL: Update isAvailable=true
   │
   ├─► Redis: SET helper:online:{helperId}
   │
   ├─► Redis: ZADD helpers:available
   │
   ├─► Find nearest available task:
   │      │
   │      ├─► Redis: KEYS job:*
   │      │
   │      ├─► Redis: GET task:{taskId}:actions (filter acted)
   │      │
   │      ├─► Google Maps API: Calculate distances
   │      │
   │      ├─► Redis: SET task:{taskId}:associated_helpers
   │      │
   │      └─► Redis: SET helper:{helperId}:associated_tasks
   │
   └─► Socket.io: Broadcast "helper_online"
```

---

### **3. Task Rejection → Reassignment Flow**

```
rejectTask()
   │
   ├─► Redis: GET task:{taskId}:actions (check if acted)
   │
   ├─► Redis: SET task:{taskId}:actions (add rejection)
   │
   ├─► Redis: DEL task:{taskId}:associated_helpers
   │
   ├─► Redis: UPDATE helper:{helperId}:associated_tasks
   │
   ├─► findAndAssociateNearestHelper()
   │      │
   │      ├─► Redis: GET helper:online:*
   │      │
   │      ├─► Filter out acted helpers
   │      │
   │      ├─► Google Maps API: Calculate distances
   │      │
   │      ├─► Redis: SET task:{taskId}:associated_helpers (new helper)
   │      │
   │      └─► Socket.io: Notify new helper
   │
   └─► associateTasksWithHelper() (find other tasks for rejecting helper)
          │
          ├─► Redis: KEYS job:*
          │
          ├─► Filter acted tasks
          │
          ├─► Google Maps API: Calculate distances
          │
          └─► Redis: SET helper:{helperId}:associated_tasks (new task)
```

---

### **4. Task Completion → Cleanup Flow**

```
completeWork()
   │
   ├─► Supabase Storage: Upload photos
   │
   ├─► PostgreSQL: Update status='completed'
   │
   ├─► Redis Cleanup:
   │      │
   │      ├─► DEL tracking:task:{taskId}:helper:{helperId}
   │      │
   │      ├─► DEL tracking:task:{taskId}:helpseeker:{helpseekerId}
   │      │
   │      ├─► DEL task:{taskId}:associated_helpers
   │      │
   │      ├─► UPDATE helper:{helperId}:associated_tasks (remove taskId)
   │      │
   │      └─► DEL job:{taskId}
   │
   ├─► Mark helper available again:
   │      │
   │      ├─► SET helper:online:{helperId}
   │      │
   │      └─► ZADD helpers:available
   │
   ├─► Socket.io: "task_completed"
   │
   └─► Trigger rating/payment flow
```

---

### **5. Real-time Location Tracking Flow**

```
Helper App                         Backend                      Helpseeker App
    │                                 │                               │
    │ Every 5-10 seconds              │                               │
    │ PATCH /tracking/location        │                               │
    ├────────────────────────────────►│                               │
    │ {lat, lng, accuracy}            │                               │
    │                                 │                               │
    │                                 │ ─► Redis: SET                 │
    │                                 │    tracking:task:X:helper:Y   │
    │                                 │    TTL: 1 hour                │
    │                                 │                               │
    │                                 │ ─► PostgreSQL: Update         │
    │                                 │    currentLatitude/Longitude  │
    │                                 │                               │
    │                                 │ ─► Socket.io: Emit            │
    │                                 │    "location_update"          │
    │                                 ├──────────────────────────────►│
    │                                 │                               │
    │                                 │                    Map updates │
    │                                 │                    marker in   │
    │                                 │                    real-time   │
    │                                 │                               │
```

---

## 📊 Data Flow Summary

### **PostgreSQL (Persistent Data)**
- Tasks (all statuses)
- Helpers (profiles, ratings)
- Helpseekers (profiles)
- Tracking records (historical)
- Payments
- Ratings
- Notifications

### **Redis (Real-time/Cache Data)**
- Online helpers (`helper:online:*`)
- Available helpers count (`helpers:available`)
- Task queue (`job:*`)
- Task-Helper associations (`task:*:associated_helpers`, `helper:*:associated_tasks`)
- Helper actions (`task:*:actions`)
- Real-time locations (`tracking:task:*:helper:*`, `tracking:task:*:helpseeker:*`)

### **Socket.io Events**
- `helper_online` / `helper_offline`
- `new_task_available`
- `task_assigned`
- `task_started`
- `task_status_update` (on_the_way, arrived)
- `location_update` (real-time tracking)
- `task_completed`
- `helper_arrived`

---

## 🔐 Authentication & Authorization

All routes use:
1. `checkForAuthenticationCookie()` → Verifies JWT token
2. `checkUserType(['helper', 'helpseeker', 'admin'])` → Role-based access

---

## ⚡ Performance Optimizations

1. **Redis for speed:**
   - Online helpers stored in Redis (fast lookup)
   - Task queue in Redis (instant access)
   - Location data in Redis (real-time updates)

2. **TTL management:**
   - Helper online: 12 hours
   - Task queue: 30 days
   - Locations: 1 hour
   - Associations: 12-30 days

3. **Google Maps API:**
   - Batch distance calculations
   - Haversine fallback for estimates
   - 100km max radius cap (prevents unnecessary API calls)

4. **Socket.io:**
   - Real-time updates without polling
   - Targeted broadcasts (only to relevant users)

---

## 🎯 Key Business Rules

1. **1-to-1 Task-Helper Association:**
   - Each task associated with ONLY 1 helper at a time
   - Each helper can have MULTIPLE tasks associated

2. **Action Deduplication:**
   - Helper can only act on a task ONCE (pass, reject, or accept)
   - Prevents re-showing same task after action

3. **Distance Limits:**
   - Task associations: ≤100km (with env cap)
   - Prevents unrealistic assignments

4. **Automatic Reassignment:**
   - When helper rejects/passes: Find new helper + new task for rejecting helper
   - When helper goes offline: Reassign their tasks

5. **OTP Security:**
   - 6-digit OTP
   - 15-minute expiry
   - One-time use only

---

## 🔄 State Transitions

### **Task Status Flow:**
```
draft → in_queue → assigned → in_progress → 
  → on_the_way → arrived → completed
               ↓
           cancelled
```

### **Helper Status Flow:**
```
offline ⇄ online (available) → assigned_to_task → 
  → task_in_progress → available_again
```

---

## 📝 Notes

- All Redis keys use TTL to prevent memory bloat
- Socket.io provides real-time updates without database polling
- Google Maps API ensures accurate distance calculations
- System automatically handles helper/task reassignments
- Action tracking prevents duplicate actions and improves UX

---

**End of Architecture Documentation** 🎉
