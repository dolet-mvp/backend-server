# Dolet App Backend Server

A comprehensive Node.js/Express backend server for the Dolet application - a modern platform connecting help seekers with helpers for various tasks and services. Features include task management, real-time tracking, bidding system, payments via Razorpay, ratings, and notifications.

## Table of Contents
- [Project Overview](#project-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Features](#features)
- [Authentication & Authorization](#authentication--authorization)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [AI-Powered Task Generation](#ai-powered-task-generation)
- [Scheduled Task Publishing](#scheduled-task-publishing)
- [Task Messaging System](#task-messaging-system)
- [Visual Flow Diagrams](#visual-flow-diagrams)
- [Recent Updates](#recent-updates)

## Project Overview

Dolet is a full-featured marketplace platform that enables:
- **Helpseekers**: Post tasks with AI assistance, schedule future publishing, manage budgets, approve helpers via OTP, track progress, message helpers, and make payments
- **Helpers**: Browse tasks, place bids, accept tasks with OTP verification, track work progress, communicate with helpseekers, request payments
- **AI Features**: Natural language task generation with Google Gemini, smart field extraction, auto-categorization
- **Automation**: Scheduled task publishing with cron jobs, auto-publish at specified times
- **Real-time Features**: Location tracking, in-app messaging, notifications, ratings, and payment processing

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js v5.1.0
- **Database**: PostgreSQL with UUID primary keys
- **ORM**: Sequelize v6.37.7
- **Authentication**: JSON Web Tokens (JWT) with httpOnly cookies
- **File Storage**: Supabase Storage
- **Payment Gateway**: Razorpay v2.9.6
- **AI Integration**: Google Gemini API (Gemini Pro)
- **Task Scheduler**: node-cron v3.0.3 (for scheduled task publishing)
- **Email Service**: Nodemailer v7.0.9
- **Password Security**: bcryptjs v3.0.2
- **File Upload**: Multer v2.0.2
- **HTTP Client**: Axios (for AI API calls)
- **Additional**: cookie-parser, cors, dotenv

## Project Structure

```
backend-server/
├── config/
│   ├── nodemailerConfig/
│   │   └── nodemailer.js          # Email service configuration
│   ├── supabaseConfig/
│   │   └── supabase.js            # Supabase client setup
│   └── uploadConfig/
│       └── supabaseUpload.js      # File upload middleware
├── controllers/
│   ├── addressController/
│   │   └── address.js             # Address CRUD operations
│   ├── authController/
│   │   └── userController.js      # Registration & authentication
│   ├── bidController/
│   │   └── bidController.js       # Bidding system with OTP
│   ├── helperController/
│   │   └── helperController.js    # Helper profiles & search
│   ├── notificationController/
│   │   └── notificationController.js  # Notification management
│   ├── paymentController/
│   │   └── paymentController.js   # Razorpay payment processing
│   ├── profileController/
│   │   └── profileController.js   # User profile management
│   ├── ratingController/
│   │   └── ratingController.js    # Rating & review system
│   ├── supportController/
│   │   └── supportController.js   # Support ticket system
│   ├── taskController/
│   │   ├── commonTaskController.js     # Shared task operations
│   │   ├── helperTaskController.js     # Helper-specific tasks
│   │   └── helpseekerTaskController.js # Helpseeker task management
│   └── trackingController/
│       └── trackingController.js  # Real-time location tracking
├── dbConnection/
│   ├── dbConfig.js                # PostgreSQL connection
│   └── dbSync.js                  # Database synchronization
├── middleware/
│   ├── authMiddleware.js          # JWT verification
│   └── roleMiddleware.js          # Role-based access control
├── models/
│   ├── addressModel/
│   │   └── addressModel.js        # User addresses
│   ├── associationModel/
│   │   └── association.js         # Model relationships
│   ├── authModel/
│   │   └── userModel.js           # User entity
│   ├── bidModel/
│   │   └── bidModel.js            # Bid entity
│   ├── helperModel/
│   │   └── helperModel.js         # Helper profiles
│   ├── messageModel/
│   │   └── messageModel.js        # Messaging system
│   ├── notificationModel/
│   │   └── notificationModel.js   # Notifications
│   ├── paymentModel/
│   │   └── paymentModel.js        # Payment records
│   ├── queueModel/
│   │   └── queueModel.js          # Task queue
│   ├── ratingModel/
│   │   └── ratingModel.js         # Ratings & reviews
│   ├── supportModel/
│   │   ├── supportTicketModel.js  # Support tickets
│   │   └── ticketReplyModel.js    # Ticket replies
│   ├── taskModel/
│   │   └── taskModel.js           # Task entity
│   └── trackingModel/
│       └── trackingModel.js       # Location tracking
├── routes/
│   ├── addressRoute/
│   ├── authRoute/
│   ├── bidRoute/
│   ├── helperRoute/
│   ├── notificationRoute/
│   ├── paymentRoute/
│   ├── profileRoute/
│   ├── ratingRoute/
│   ├── supportRoute/
│   ├── taskRoute/
│   └── trackingRoute/
├── services/
│   └── authServices.js            # Auth utilities
├── server.js                      # Main entry point
├── package.json
└── README.md
```

## API Endpoints

### Authentication Routes (`/api/auth`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/register` | User registration | No |
| POST | `/api/auth/login` | User login | No |
| POST | `/api/auth/logout` | User logout | Yes |

### Profile Management (`/api/user`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| GET | `/api/user/profile` | Get user profile | Yes | All |
| PATCH | `/api/user/profile` | Update profile (with photo) | Yes | All |

### Address Management (`/api/user/address`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/user/address/add` | Create new address | Yes | All |
| GET | `/api/user/address` | Get all user addresses | Yes | All |
| GET | `/api/user/address/default` | Get default address | Yes | All |
| GET | `/api/user/address/:addressId` | Get specific address | Yes | All |
| PUT | `/api/user/address/:addressId` | Update address | Yes | All |
| DELETE | `/api/user/address/:addressId` | Delete address | Yes | All |
| PATCH | `/api/user/address/:addressId/default` | Set as default | Yes | All |

### Task Routes - Helpseeker (`/api/tasks`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/tasks/create` | Create draft task (with attachments) | Yes | Helpseeker |
| PUT | `/api/tasks/:taskId` | Update draft task | Yes | Helpseeker |
| POST | `/api/tasks/:taskId/publish` | Publish task to queue | Yes | Helpseeker |
| POST | `/api/tasks/:taskId/schedule-publish` | Schedule task for future publishing | Yes | Helpseeker |
| DELETE | `/api/tasks/:taskId/cancel-schedule` | Cancel scheduled publish | Yes | Helpseeker |
| GET | `/api/tasks/my-tasks` | Get all my tasks | Yes | Helpseeker |
| DELETE | `/api/tasks/:taskId/cancel` | Cancel task | Yes | Helpseeker |
| PATCH | `/api/tasks/:taskId/increase-reward` | Increase budget | Yes | Helpseeker |
| GET | `/api/tasks/pending-helpers` | Tasks with pending requests | Yes | Helpseeker |
| GET | `/api/tasks/:taskId/pending-helper` | Get pending helper info | Yes | Helpseeker |
| POST | `/api/tasks/:taskId/approve-helper` | Approve helper (generate OTP) | Yes | Helpseeker |
| POST | `/api/tasks/:taskId/reject-helper` | Reject helper request | Yes | Helpseeker |
| POST | `/api/tasks/:taskId/regenerate-otp` | Regenerate OTP | Yes | Helpseeker |

### Task Routes - Helper (`/api/tasks`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| GET | `/api/tasks/available` | Browse available tasks | Yes | Helper |
| POST | `/api/tasks/:taskId/request-accept` | Request to accept task | Yes | Helper |
| POST | `/api/tasks/:taskId/verify-otp` | Verify OTP and start work | Yes | Helper |
| DELETE | `/api/tasks/:taskId/cancel-request` | Cancel acceptance request | Yes | Helper |

### Task Routes - Common (`/api/tasks`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| GET | `/api/tasks/popular-jobs` | Popular jobs in user's area (50km radius) | Yes | All |
| GET | `/api/tasks/:taskId` | Get single task details | Yes | All |

### Bid Routes (`/api/bids`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/bids/task/:taskId/place` | Place bid on task | Yes | Helper |
| GET | `/api/bids/my-bids` | Get my bids | Yes | Helper |
| DELETE | `/api/bids/:bidId/withdraw` | Withdraw bid | Yes | Helper |
| GET | `/api/bids/task/:taskId` | Get all bids for task | Yes | Helpseeker |
| PATCH | `/api/bids/:bidId/accept` | Accept bid (generates OTP) | Yes | Helpseeker |
| PATCH | `/api/bids/:bidId/reject` | Reject bid | Yes | Helpseeker |

### Tracking Routes (`/api/tracking`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/tracking/task/:taskId/on-the-way` | Update status: on the way | Yes | Helper |
| POST | `/api/tracking/task/:taskId/arrived` | Mark as arrived | Yes | Helper |
| POST | `/api/tracking/task/:taskId/start-work` | Start work | Yes | Helper |
| POST | `/api/tracking/task/:taskId/complete-work` | Mark work complete & generate OTP | Yes | Helper |
| POST | `/api/tracking/task/:taskId/verify-completion` | Verify OTP & finalize completion | Yes | Helper |
| PATCH | `/api/tracking/task/:taskId/location` | Update current location | Yes | Helper |
| GET | `/api/tracking/task/:taskId` | Get tracking info | Yes | All |

### Payment Routes (`/api/payments`) - Razorpay Integration
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/payments/task/:taskId/request` | Request payment (create Razorpay order) | Yes | Helper |
| POST | `/api/payments/verify` | Verify payment signature | Yes | Helpseeker |
| GET | `/api/payments/task/:taskId/request` | View payment request | Yes | Helpseeker |
| GET | `/api/payments/history` | Get payment history | Yes | All |
| POST | `/api/payments/:paymentId/refund` | Request refund | Yes | All |

### Rating Routes (`/api/ratings`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/ratings/task/:taskId` | Submit rating | Yes | All |
| GET | `/api/ratings/user/:userId` | Get user ratings | Yes | All |
| GET | `/api/ratings/task/:taskId` | Get task rating | Yes | All |
| GET | `/api/ratings/my-ratings` | Get my ratings | Yes | All |
| PATCH | `/api/ratings/:ratingId/visibility` | Toggle rating visibility | Yes | All |

### Notification Routes (`/api/notifications`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| GET | `/api/notifications` | Get all notifications | Yes | All |
| GET | `/api/notifications/unread-count` | Get unread count | Yes | All |
| PATCH | `/api/notifications/:notificationId/read` | Mark as read | Yes | All |
| PATCH | `/api/notifications/mark-all-read` | Mark all as read | Yes | All |
| DELETE | `/api/notifications/:notificationId` | Delete notification | Yes | All |
| DELETE | `/api/notifications/clear-read` | Clear read notifications | Yes | All |

### Support Ticket Routes (`/api/support`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/support/create` | Create new support ticket (with attachments) | Yes | All |
| GET | `/api/support/my-tickets` | Get all my tickets | Yes | All |
| GET | `/api/support/ticket/:ticketId` | Get ticket details | Yes | All |
| POST | `/api/support/ticket/:ticketId/reply` | Reply to ticket (with attachments) | Yes | All |
| POST | `/api/support/ticket/:ticketId/rate` | Rate ticket support (1-5) | Yes | All |
| GET | `/api/support/admin/tickets` | Get all tickets (admin dashboard) | Yes | Admin |
| PATCH | `/api/support/admin/ticket/:ticketId/update` | Update ticket status/priority/assign | Yes | Admin |
| GET | `/api/support/admin/statistics` | Get ticket statistics | Yes | Admin |

### AI Routes (`/api/ai`) - Gemini Integration
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| POST | `/api/ai/generate-task-json` | Generate task JSON from user description | Yes | All |

### Message Routes (`/api/messages`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| GET | `/api/messages/my-tasks` | Get all tasks with message counts | Yes | All |
| POST | `/api/messages/task/:taskId` | Send message (with attachments) | Yes | Task Participants |
| GET | `/api/messages/task/:taskId` | Get all messages for task (paginated) | Yes | Task Participants |
| DELETE | `/api/messages/message/:messageId` | Delete your own message | Yes | Sender |

### Helper Routes (`/api/helpers`)
| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| PATCH | `/api/helpers/profile` | Update helper profile (with documents) | Yes | Helper |
| GET | `/api/helpers/profile/me` | Get my helper profile | Yes | Helper |
| GET | `/api/helpers/profile/:userId` | Get helper profile by ID | Yes | All |
| PATCH | `/api/helpers/availability` | Toggle availability (auto-creates profile) | Yes | Helper |
| GET | `/api/helpers/search` | Search helpers | Yes | All |
| GET | `/api/helpers/available/count` | Get count of available helpers | Yes | All |
| GET | `/api/helpers/tasks/active` | Get my active tasks | Yes | Helper |
| GET | `/api/helpers/:userId/tasks/completed` | Get completed tasks | Yes | All |

### Health Check
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/health` | Server health status | No |

## Features

### Implemented Features

#### Authentication & Authorization
- User registration with email/password
- JWT-based authentication with httpOnly cookies
- Role-based access control (Helpseeker, Helper, Admin)
- Secure password hashing with bcryptjs

#### Task Management
- Create, update, publish, and cancel tasks
- Draft mode before publishing
- Task queue system for published tasks
- **Scheduled Task Publishing** (New!)
  - Schedule tasks to publish at future date/time
  - Automated cron job checks every minute
  - Auto-publish when scheduled time arrives
  - Cancel scheduled publish before it runs
  - Status tracking: draft → scheduled → in_queue
- Location-based task discovery
- Budget increase functionality
- Multi-format date support (DD-MM-YYYY, YYYY-MM-DD, ISO)
- Popular jobs in user's area (50km radius, GPS-based)

#### Helper Request & OTP Verification Flow
1. Helper requests to accept task
2. Helpseeker approves request → **OTP generated**
3. Helper verifies OTP → Work begins
- OTP regeneration capability
- 24-hour OTP expiry
- Secure verification process

#### Bidding System with OTP
- Helpers place bids on tasks
- Helpseekers accept/reject bids
- **OTP verification** when bid accepted
- Bid withdrawal capability
- Automatic rejection of other bids
- Budget range tracking

#### Real-time Tracking
- Location tracking (latitude/longitude)
- Status updates: On the way → Arrived → Work started → Completed
- Photo uploads on completion (Supabase Storage)
- Tracking history
- **OTP-based task completion verification** (New!)
  - Helper marks work as complete → OTP sent to helpseeker
  - Helpseeker verifies work → Shares OTP with helper
  - Helper submits OTP → Task finalized as completed
  - 30-minute OTP validity
  - Secure two-step completion process

#### Payment Integration (Razorpay)
- Helper requests payment after completion
- Razorpay order creation with QR code
- Multiple payment methods (UPI, Cards, Wallets)
- Signature verification (HMAC SHA256)
- Automatic earnings update
- Payment history tracking
- Refund system

#### Rating & Review System
- Mutual ratings (Helper ↔ Helpseeker)
- 5-star rating system with reviews
- Rating visibility control
- Average rating calculation
- Recent ratings display

#### Notification System
- Real-time notifications for:
  - Task status changes
  - Bid acceptance/rejection
  - Payment requests/completion
  - Helper requests
  - OTP generation
- Notification types: `task_created`, `task_assigned`, `bid_accepted`, `payment_requested`, etc.
- Unread count tracking
- Mark as read/delete functionality

#### Support Ticket System
- User ticket creation with:
  - Title, description, subject (8 categories)
  - File attachments (up to 5 files)
  - Priority levels (low, medium, high, urgent)
  - Unique ticket ID for tracking
- Email notifications:
  - Ticket creation confirmation to user
  - New ticket alert to admin
  - Reply notifications
  - Status change updates
- Admin dashboard:
  - View all tickets with filters
  - Assign tickets to admins
  - Update status (open → in_progress → waiting_for_response → resolved → closed)
  - Internal notes (visible only to admins)
- Reply system with attachments
- Ticket rating (1-5 stars) with feedback
- Statistics and reporting
- Status workflow management
- Support subjects: technical_issue, payment_issue, account_issue, task_issue, feature_request, bug_report, general_inquiry, other

#### Profile Management
- User profile with photo upload
- Helper profiles with:
  - Skills & experience
  - Hourly rate
  - Service radius
  - Availability status
  - Document uploads (certifications, ID)
- Auto-create helper profile on availability toggle

#### Address Management
- Multiple addresses per user
- Default address system
- GPS coordinates support
- Address types (home, work, other)
- Full CRUD operations

#### Search & Discovery
- Helper search with filters
- Available helper count
- Location-based task filtering (Haversine formula)
- Popular job categories in area
- Budget insights and active job counts

#### AI-Powered Task Generation (Gemini API)
- User provides task description in natural language
- AI analyzes and structures data into task fields
- Extracts: title, category, budget, duration, priority, steps
- Returns JSON for frontend editing
- Combines user description with prewritten guidelines
- Smart field mapping to Task model
- Gemini Pro integration

#### Task Messaging System
- Direct messaging between helpseeker and helper
- One conversation per task
- Message features:
  - Text messages with timestamps
  - File attachments (up to 5 per message)
  - Message deletion (sender only)
  - Pagination support (50 messages/page)
- Access control: Only task participants can message
- Cannot send messages on completed tasks (read-only)
- Notifications for new messages
- Message count tracking per task
- List all tasks with message previews

### Technical Features
- UUID primary keys for security
- File uploads to Supabase Storage
- Multi-file upload support
- CORS configuration for React Native
- Database synchronization
- Model associations (One-to-Many, Many-to-Many)
- Error handling and validation
- Sequelize query optimization

## Authentication & Authorization

### Middleware Chain
```javascript
Request → authMiddleware (JWT verification) → roleMiddleware (Role check) → Controller
```

### User Roles
- **Helpseeker**: Post tasks, manage budgets, approve helpers, make payments
- **Helper**: Browse tasks, bid, accept work, track progress, request payments
- **Admin**: Full system access (planned)

### Token Management
- JWT tokens stored in httpOnly cookies
- Automatic token verification on protected routes
- Token includes: `userId`, `role`, `email`

## Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=8181
FRONTEND_URL=http://localhost:3000

# Database Configuration
DB_NAME=dolet_db
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_BUCKET_NAME=dolet-files

# Razorpay Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Google Gemini AI Configuration
GEMINI_API_KEY=your_google_gemini_api_key

# Email Configuration (Nodemailer)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
```

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- Supabase account (for file storage)
- Razorpay account (for payments)
- Google AI Studio account (for Gemini API key)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd backend-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

**Get your Gemini API Key:**
- Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
- Create a new API key
- Add to `.env` as `GEMINI_API_KEY=your_key_here`

4. **Set up PostgreSQL database**
```bash
createdb dolet_db
```

5. **Run database migrations** (if applicable)
```bash
# Database will auto-sync on first run
```

6. **Start the server**

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Server will start on `http://localhost:8181`

### Testing the API

Use Postman, Thunder Client, or curl to test endpoints:

```bash
# Health check
curl http://localhost:8181/api/health

# Register user
curl -X POST http://localhost:8181/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","fullName":"John Doe","role":"helpseeker"}'
```

## AI-Powered Task Generation

### Overview
The platform integrates Google's Gemini AI to help users create structured task listings from natural language descriptions. Users simply describe what they need in plain text, and the AI extracts relevant information to populate task fields.

### How It Works

1. **User Input**: User provides a task description in natural language
2. **AI Processing**: Backend sends description + prewritten guidelines to Gemini API
3. **Structured Output**: AI returns JSON with extracted task fields
4. **User Editing**: Frontend displays the AI-generated task for user review/editing

### API Endpoint

**POST** `/api/ai/generate-task-json`

**Request Body:**
```json
{
  "description": "I need someone to stand in a bank line at SBI Besu branch on my behalf. When my number comes, call me. Budget: 1000 rupees. Urgent task, takes about 1 hour."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "title": "Stand in Bank Line at SBI Besu Branch",
    "description": "Need someone to wait in bank queue...",
    "category": "Errands & Tasks",
    "budget": 1000,
    "estimatedDuration": 60,
    "priority": "urgent",
    "location": {
      "address": "SBI Besu Branch, Shibpur"
    },
    "steps": [
      {
        "title": "Wait in bank line",
        "description": "Stand in queue at SBI Besu branch",
        "order": 1
      },
      {
        "title": "Call when number comes",
        "description": "Contact helpseeker when turn arrives",
        "order": 2
      }
    ],
    "skillsRequired": null,
    "requirements": null
  }
}
```

### Fields Extracted
- **title**: Short task title
- **description**: Detailed description
- **category**: Task category
- **budget**: Estimated budget
- **estimatedDuration**: Time in minutes
- **priority**: low, medium, high, urgent
- **location**: Address and coordinates
- **steps**: Array of task milestones
- **skillsRequired**: Required skills (if mentioned)

### Benefits
- ✅ Faster task creation
- ✅ Structured data from unstructured input
- ✅ Consistent task quality
- ✅ Better task categorization
- ✅ Auto-generated steps/milestones

## Scheduled Task Publishing

### Overview
Helpseekers can schedule their tasks to be automatically published at a specific date and time in the future. A background cron job runs every minute to check for tasks that are due to be published and automatically moves them to the task queue.

### Features

#### Scheduling
- **Schedule Future Publishing**: Set exact date and time for task to go live
- **Cancel Schedule**: Remove scheduled publish before it executes
- **Status Tracking**: Task status shows `draft` → `scheduled` → `in_queue`
- **Automated Publishing**: Cron job auto-publishes at scheduled time
- **Validation**: Scheduled time must be in the future

#### How It Works

1. **Create & Schedule Task**
   ```
   POST /api/tasks/create          # Create draft task
   POST /api/tasks/:taskId/schedule-publish
   Body: { "scheduledPublishAt": "2025-10-25T10:00:00Z" }
   ```

2. **Background Processing**
   - Cron job runs every minute (`* * * * *`)
   - Checks for tasks where `scheduledPublishAt ≤ current time`
   - Auto-publishes eligible tasks to queue
   - Creates notifications for helpseeker
   - Updates task status to `in_queue`

3. **Cancel if Needed**
   ```
   DELETE /api/tasks/:taskId/cancel-schedule
   ```

### API Endpoints

#### Schedule Task for Publishing
**POST** `/api/tasks/:taskId/schedule-publish`

**Requirements:**
- Task must be in `draft` status
- Scheduled time must be in the future
- Only task creator can schedule

**Request Body:**
```json
{
  "scheduledPublishAt": "2025-10-25T15:30:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task scheduled for publishing",
  "data": {
    "id": "task-uuid",
    "title": "Help with moving",
    "status": "draft",
    "isScheduled": true,
    "scheduledPublishAt": "2025-10-25T15:30:00Z"
  }
}
```

#### Cancel Scheduled Publishing
**DELETE** `/api/tasks/:taskId/cancel-schedule`

**Response:**
```json
{
  "success": true,
  "message": "Scheduled publish cancelled",
  "data": {
    "id": "task-uuid",
    "isScheduled": false,
    "scheduledPublishAt": null
  }
}
```

### Database Fields
- `scheduledPublishAt` (DATE): Target publish date/time
- `isScheduled` (BOOLEAN): Whether task is scheduled
- `publishedAt` (DATE): Actual publish timestamp

### Use Cases
- Schedule task posting during peak helper activity hours
- Set up tasks in advance for future needs
- Coordinate task publishing with helper availability
- Plan task workflows ahead of time

### Technical Details
- **Cron Schedule**: Runs every minute
- **Service**: `services/taskSchedulerService.js`
- **Initialization**: Auto-starts with server
- **Logging**: Console logs each scheduled task published

## Task Messaging System

### Overview
Direct messaging between helpseeker and helper for each assigned task. Messages are preserved even after task completion for reference.

### Features

#### Message Types
- **Text Messages**: Standard text communication
- **File Attachments**: Upload up to 5 files per message (images, documents)
- **Timestamps**: All messages timestamped
- **Read Status**: Track message delivery

#### Access Control
- Only task creator (helpseeker) and assigned helper can message
- No messages allowed on unassigned tasks
- Cannot send new messages after task completion (read-only)
- Each user can only see their own task conversations

#### Message Management
- **Send**: Text with optional attachments
- **View**: Paginated message history (50 per page)
- **Delete**: Senders can delete their own messages
- **Count**: Track unread/total message counts

### API Endpoints

#### 1. Get All Tasks with Messages
**GET** `/api/messages/my-tasks`

Returns all tasks where you're involved, with message counts.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "task-uuid",
      "title": "Help with moving",
      "status": "in_progress",
      "creator": { "id": "...", "firstName": "John" },
      "assignedHelper": { "id": "...", "firstName": "Jane" },
      "messageCount": 15,
      "lastMessage": {
        "message": "When should I arrive?",
        "createdAt": "2025-10-22T10:30:00Z"
      }
    }
  ]
}
```

#### 2. Send Message
**POST** `/api/messages/task/:taskId`

**Request (multipart/form-data):**
```
message: "I'll arrive at 3 PM"
attachments: [file1.jpg, file2.pdf]
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "id": "message-uuid",
    "message": "I'll arrive at 3 PM",
    "attachments": ["url1", "url2"],
    "sender": { "firstName": "John", "lastName": "Doe" },
    "createdAt": "2025-10-22T14:30:00Z"
  }
}
```

#### 3. Get Task Messages
**GET** `/api/messages/task/:taskId?page=1&limit=50`

**Response:**
```json
{
  "success": true,
  "data": {
    "messages": [...],
    "pagination": {
      "total": 15,
      "page": 1,
      "limit": 50,
      "totalPages": 1
    },
    "task": {
      "id": "task-uuid",
      "title": "Help with moving",
      "status": "in_progress"
    }
  }
}
```

#### 4. Delete Message
**DELETE** `/api/messages/message/:messageId`

Only the sender can delete their own messages.

### Use Cases

**During Task:**
- Coordinate meeting times
- Share location updates
- Send photos of work progress
- Clarify requirements
- Update status

**After Completion:**
- Reference conversation history
- Dispute resolution
- Review work agreements
- Future reference

### Notifications
Users receive in-app notifications for:
- New messages received
- Message replies
- Task assignment (messaging enabled)

## Visual Flow Diagrams

### Complete Application Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOLET PLATFORM ARCHITECTURE                   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐                                    ┌──────────────┐
│              │                                    │              │
│  HELPSEEKER  │                                    │    HELPER    │
│              │                                    │              │
└──────┬───────┘                                    └──────┬───────┘
       │                                                   │
       │ 1. Register/Login                                │ 1. Register/Login
       │    (JWT Auth)                                    │    (JWT Auth)
       ▼                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION LAYER                          │
│  • JWT Token Generation                                          │
│  • Role-based Access Control                                     │
│  • httpOnly Cookie Storage                                       │
└──────────────────────────────────────────────────────────────────┘
       │                                                   │
       │                                                   │
       ▼                                                   ▼
┌─────────────────────┐                          ┌────────────────────┐
│  HELPSEEKER FLOW    │                          │   HELPER FLOW      │
│                     │                          │                    │
│ 2. Create Task      │                          │ 2. Browse Tasks    │
│    • Title, desc    │                          │    • Filter by     │
│    • Budget, loc    │                          │      location      │
│    • Attachments    │                          │    • View popular  │
│    • Category       │                          │      jobs nearby   │
│                     │                          │                    │
│ 3. Publish Task     │                          │ 3A. Place Bid      │
│    → Task Queue     │◄─────────────────────────┤     • Bid amount   │
│                     │                          │     • Start date   │
│                     │                          │     • Message      │
│ 4A. Receive Bids    │                          │                    │
│     • View all      │                          │ OR                 │
│     • Compare       │                          │                    │
│                     │                          │ 3B. Direct Request │
│ 5A. Accept Bid      │                          │     • Request to   │
│      OTP Generated│                          │       accept task  │
│     • Share with    │                          │                    │
│       helper        │                          │ 4. Receive OTP     │
│                     │                          │    from helpseeker │
│ OR                  │                          │                    │
│                     │                          │ 5. Verify OTP      │
│ 4B. Approve Request │                          │     Start Work   │
│      OTP Generated│                          │                    │
│                     │                          │                    │
└─────────┬───────────┘                          └──────────┬─────────┘
          │                                                 │
          │              6. WORK IN PROGRESS                │
          │                                                 │
          ▼◄────────────────────────────────────────────────▼
┌──────────────────────────────────────────────────────────────────┐
│                    TRACKING & MONITORING                          │
│                                                                   │
│  Helper Status Updates:                                          │
│  ┌────────┐   ┌─────────┐   ┌───────────┐   ┌───────────┐     │
│  │On Way  │ → │ Arrived │ → │Work Start │ → │ Complete  │     │
│  └────────┘   └─────────┘   └───────────┘   └───────────┘     │
│                                                                   │
│  • Real-time GPS location tracking                               │
│  • Photo upload on completion (Supabase)                        │
│  • Status notifications to helpseeker                           │
└──────────────────────────────────────────────────────────────────┘
          │                                                 │
          │           7. PAYMENT PROCESSING                 │
          │                                                 │
          ▼◄────────────────────────────────────────────────▼
┌──────────────────────────────────────────────────────────────────┐
│                    RAZORPAY PAYMENT FLOW                          │
│                                                                   │
│  Helper: Request Payment                                         │
│         ↓                                                         │
│  Create Razorpay Order (₹ amount)                               │
│         ↓                                                         │
│  Helpseeker: Opens Razorpay                                      │
│         ↓                                                         │
│  Pay via UPI/Card/Wallet                                        │
│         ↓                                                         │
│  Verify Signature (HMAC SHA256)                                 │
│         ↓                                                         │
│   Payment Verified                                             │
│         ↓                                                         │
│  Update Helper Earnings                                          │
│         ↓                                                         │
│  Notify Both Parties                                            │
└──────────────────────────────────────────────────────────────────┘
          │                                                 │
          │           8. RATING & FEEDBACK                  │
          │                                                 │
          ▼◄────────────────────────────────────────────────▼
┌──────────────────────────────────────────────────────────────────┐
│                    RATING SYSTEM                                  │
│                                                                   │
│  Helpseeker rates Helper  ←────────→  Helper rates Helpseeker   │
│                                                                   │
│  • 1-5 Star Rating                                               │
│  • Written Review                                                │
│  • Visibility Control                                            │
│  • Average Rating Calculation                                    │
└──────────────────────────────────────────────────────────────────┘
```

###  OTP Verification Flow (Helper Request & Bid Acceptance)

```
┌─────────────────────────────────────────────────────────────────────┐
│              OTP VERIFICATION FLOW (Two Scenarios)                   │
└─────────────────────────────────────────────────────────────────────┘

SCENARIO A: Direct Helper Request
═══════════════════════════════════

┌─────────────┐                              ┌─────────────┐
│   HELPER    │                              │ HELPSEEKER  │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │ 1. POST /tasks/:taskId/request-accept     │
       │    (Request to accept task)               │
       ├──────────────────────────────────────────►│
       │                                            │
       │    Task.pendingHelperId = helper.id       │
       │    Status: in_queue                       │
       │                                            │
       │◄──────────────────────────────────────────┤
       │ Notification: "Request sent"              │
       │                                            │
       │                                            │
       │                  2. POST /tasks/:taskId/approve-helper
       │                     (Approve helper request)
       │                                            │
       │                      Generate OTP (123456)
       │                     Task.verificationOtp = "123456"
       │                     Task.assignedHelperId = helper.id
       │                     Task.status = "assigned"
       │                                            │
       │◄──────────────────────────────────────────┤
       │ Notification:                             │ Notification:
       │ "Ask helpseeker for OTP"                  │ "Your OTP: 123456"
       │                                            │
       │                                            │
       │ 3. Helper asks for OTP                    │
       │    from helpseeker                        │
       │                                            │
       │ 4. POST /tasks/:taskId/verify-otp         │
       │    { "otp": "123456" }                    │
       ├──────────────────────────────────────────►│
       │                                            │
       │     Verify OTP                          │
       │    Task.isOtpVerified = true              │
       │    Task.status = "in_progress"            │
       │    Tracking record created                │
       │                                            │
       │◄──────────────────────────────────────────┤
       │ Success: "Work started"                   │
       │                                            │
       ▼                                            ▼


SCENARIO B: Bid Acceptance Flow
════════════════════════════════

┌─────────────┐                              ┌─────────────┐
│   HELPER    │                              │ HELPSEEKER  │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │ 1. POST /bids/task/:taskId/place          │
       │    (Place bid on task)                    │
       │    { bidAmount, proposedStartDate }       │
       ├──────────────────────────────────────────►│
       │                                            │
       │    Bid.status = "pending"                 │
       │                                            │
       │◄──────────────────────────────────────────┤
       │ Notification: "Bid submitted"             │
       │                                            │
       │                                            │
       │                  2. PATCH /bids/:bidId/accept
       │                     (Accept bid)          │
       │                                            │
       │                      Generate OTP (654321)
       │                     Bid.status = "accepted"
       │                     Task.verificationOtp = "654321"
       │                     Task.assignedHelperId = helper.id
       │                     Task.status = "assigned"
       │                     Reject other bids     │
       │                                            │
       │◄──────────────────────────────────────────┤
       │ Notification:                             │ Notification:
       │ "Bid accepted!                            │ "Bid accepted"
       │  Ask helpseeker for OTP"                  │ "Your OTP: 654321"
       │                                            │
       │                                            │
       │ 3. Helper asks for OTP                    │
       │    from helpseeker                        │
       │                                            │
       │ 4. POST /tasks/:taskId/verify-otp         │
       │    { "otp": "654321" }                    │
       ├──────────────────────────────────────────►│
       │                                            │
       │     Verify OTP                          │
       │    Task.isOtpVerified = true              │
       │    Task.status = "in_progress"            │
       │    Tracking record created                │
       │                                            │
       │◄──────────────────────────────────────────┤
       │ Success: "Work started"                   │
       │                                            │
       ▼                                            ▼

Key Points:
• Both flows use the SAME /tasks/:taskId/verify-otp endpoint
• OTP is 6-digit random number
• OTP expires after 24 hours
• Can regenerate OTP if needed: POST /tasks/:taskId/regenerate-otp
• Helper MUST verify OTP before starting work
```

###  Razorpay Payment Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                   RAZORPAY PAYMENT INTEGRATION                    │
└──────────────────────────────────────────────────────────────────┘

┌─────────────┐                                    ┌─────────────┐
│   HELPER    │                                    │ HELPSEEKER  │
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │ 1. Complete Task                                │
       │    Status: completed                            │
       │                                                  │
       │ 2. POST /payment/task/:taskId/request           │
       │    (Request payment)                            │
       ├─────────────────────────────────────────────────►
       │                                                  │
       │    Create Razorpay Order                        │
       │    ┌──────────────────────────┐                │
       │    │ Razorpay API             │                │
       │    │ • amount: task.budget    │                │
       │    │ • currency: INR          │                │
       │    │ • receipt: task_id       │                │
       │    └──────────────────────────┘                │
       │                                                  │
       │◄─────────────────────────────────────────────────
       │ Payment.status = "pending"                      │
       │ Payment.razorpayOrderId = "order_xxx"          │
       │                                                  │
       │                                                  │
       │                    Notification: "Payment request received"
       │                                                  │
       │                    3. GET /payment/task/:taskId/request
       │                       (View payment details)    │
       │                                                  │
       │                       Returns:                  │
       │                       • Amount                  │
       │                       • Helper info             │
       │                       • Razorpay order ID       │
       │                       • Payment options         │
       │                                                  │
       │                    4. Open Razorpay Checkout    │
       │                       (Frontend)                │
       │                                                  │
       │                    ┌──────────────────────┐    │
       │                    │  RAZORPAY CHECKOUT   │    │
       │                    │                       │    │
       │                    │  • UPI (GPay, PhonePe)│   │
       │                    │  • Cards (Debit/Credit)   │
       │                    │  • Wallets (Paytm)   │    │
       │                    │  • Net Banking       │    │
       │                    │  • QR Code           │    │
       │                    └──────────────────────┘    │
       │                                                  │
       │                    5. Complete Payment          │
       │                       Razorpay generates:       │
       │                       • razorpay_payment_id     │
       │                       • razorpay_order_id       │
       │                       • razorpay_signature      │
       │                                                  │
       │                    6. POST /payment/verify      │
       │                       { payment_id, order_id,   │
       │                         signature, taskId }     │
       │                                                  ├────────┐
       │                                                  │        │
       │                       Verify Signature          │        │
       │                       ┌──────────────────────┐  │        │
       │                       │ HMAC SHA256          │  │        │
       │                       │ key = secret_key     │  │        │
       │                       │ message = order_id|  │  │        │
       │                       │           payment_id │  │        │
       │                       └──────────────────────┘  │        │
       │                                                  │        │
       │                       Signature Valid           │        │
       │                                                  │        │
       │                       Update Payment:           │        │
       │                       • status = "completed"    │        │
       │                       • razorpayPaymentId       │        │
       │                       • paidAt = now()          │        │
       │                                                  │        │
       │                       Update Task:              │        │
       │                       • paymentStatus =         │        │
       │                         "verified"              │        │
       │                                                  │        │
       │                       Update Helper:            │        │
       │                       • totalEarnings +=        │        │
       │                         task.budget             │        │
       │                       • completedTasks++        │        │
       │                                                  │◄───────┘
       │◄─────────────────────────────────────────────────
       │ Notification:                                   │ Notification:
       │ "Payment received"                             │ "Payment successful"
       │                                                  │
       ▼                                                  ▼

Security Features:
• HMAC SHA256 signature verification
• Razorpay webhook validation
• Atomic database transactions
• Idempotency checks
• Error handling & rollback
```

### Database Schema Relationships

```
┌──────────────────────────────────────────────────────────────────┐
│                    DATABASE RELATIONSHIPS                         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────┐
│     USER     │ (UUID Primary Key)
│──────────────│
│ id           │
│ fullName     │
│ email        │
│ password     │
│ role         │ (helpseeker/helper/admin)
│ profilePhoto │
└──────┬───────┘
       │
       │ ONE-TO-MANY
       │
       ├────────────────┬───────────────┬──────────────┐
       │                │               │              │
       ▼                ▼               ▼              ▼
┌───────────┐    ┌────────────┐  ┌──────────┐  ┌──────────────┐
│  ADDRESS  │    │    TASK    │  │   BID    │  │ HELPER       │
│───────────│    │────────────│  │──────────│  │ PROFILE      │
│ userId    │    │ userId     │  │ helperId │  │──────────────│
│ addressLine│   │ title      │  │ taskId   │  │ userId       │
│ city      │    │ category   │  │ bidAmount│  │ skills       │
│ state     │    │ budget     │  │ status   │  │ hourlyRate   │
│ latitude  │    │ status     │  └──────────┘  │ isAvailable  │
│ longitude │    │ location   │                │ documents    │
│ isDefault │    │ assigned   │                └──────────────┘
└───────────┘    │  HelperId  │
                 └──────┬─────┘
                        │
                        │ ONE-TO-MANY
                        │
      ┌─────────────────┼──────────────────┬────────────┐
      │                 │                  │            │
      ▼                 ▼                  ▼            ▼
┌────────────┐    ┌──────────┐      ┌──────────┐  ┌──────────┐
│  TRACKING  │    │ PAYMENT  │      │  RATING  │  │NOTIFICATION│
│────────────│    │──────────│      │──────────│  │──────────│
│ taskId     │    │ taskId   │      │ taskId   │  │ userId   │
│ status     │    │ helperId │      │ reviewerId│  │ taskId   │
│ latitude   │    │ amount   │      │ revieweeId│  │ type     │
│ longitude  │    │ razorpay │      │ rating   │  │ message  │
│ arrivedAt  │    │ OrderId  │      │ review   │  │ isRead   │
│ startedAt  │    │ status   │      │ type     │  └──────────┘
│ photos     │    └──────────┘      └──────────┘
└────────────┘

Key Relationships:
• User 1:N Address (One user, many addresses)
• User 1:N Task (One user creates many tasks)
• User 1:N Bid (One helper places many bids)
• User 1:1 HelperProfile (One-to-one profile)
• Task 1:N Bid (One task receives many bids)
• Task 1:1 Tracking (One task has one tracking record)
• Task 1:1 Payment (One task has one payment)
• Task 1:N Rating (One task can have multiple ratings)
• User 1:N Notification (One user receives many notifications)

All models use UUID as primary keys for enhanced security
```

### Task Status Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                      TASK STATUS LIFECYCLE                        │
└──────────────────────────────────────────────────────────────────┘

                    ┌─────────┐
                    │  DRAFT  │ ← Helpseeker creates task
                    └────┬────┘
                         │
                         │ POST /tasks/:taskId/publish
                         ▼
                  ┌─────────────┐
                  │  PUBLISHED  │ ← Task visible to helpers
                  └──────┬──────┘
                         │
                         │ Automatically added to queue
                         ▼
                  ┌─────────────┐
                  │  IN_QUEUE   │ ← Waiting for helper
                  └──────┬──────┘
                         │
                    ┌────┴────┐
                    │         │
      Helper Request│         │Bid Accepted
      (with OTP)    │         │(with OTP)
                    │         │
                    ▼         ▼
                  ┌─────────────┐
                  │  ASSIGNED   │ ← Helper assigned, awaiting OTP
                  └──────┬──────┘
                         │
                         │ POST /tasks/:taskId/verify-otp
                         ▼
                ┌──────────────────┐
                │  IN_PROGRESS     │ ← Work in progress
                │                  │
                │  Tracking:       │
                │  • On the way    │
                │  • Arrived       │
                │  • Work started  │
                └────────┬─────────┘
                         │
                         │ POST /tracking/task/:taskId/complete-work
                         ▼
                  ┌─────────────┐
                  │  COMPLETED  │ ← Work completed
                  └──────┬──────┘
                         │
                         │ POST /payment/task/:taskId/request
                         │ (Helper requests payment)
                         │
                         │ POST /payment/verify
                         │ (Payment verified)
                         ▼
                  ┌─────────────┐
                  │   PAID &    │ ← Transaction complete
                  │   RATED     │
                  └─────────────┘

Alternative Paths:
━━━━━━━━━━━━━━━━

  Any Status
      │
      │ DELETE /tasks/:taskId/cancel
      ▼
┌──────────┐
│CANCELLED │
└──────────┘

  Completed
      │
      │ Dispute raised
      ▼
┌──────────┐
│ DISPUTED │
└──────────┘
```

---



## License

This project is licensed under the ISC License.

## Authors

Dolet Development Team

## Support

For support, email support@dolet.com or open an issue in the repository.

---

## Recent Updates

### ✨ New Features

**Scheduled Task Publishing (node-cron)**
- Schedule tasks to auto-publish at specific date/time
- Background cron job runs every minute
- Auto-moves scheduled tasks to queue when time arrives
- Cancel scheduled publish before execution
- Status tracking: draft → scheduled → in_queue
- `/api/tasks/:taskId/schedule-publish` and `/api/tasks/:taskId/cancel-schedule` endpoints

**AI-Powered Task Generation (Gemini API)**
- Natural language to structured task data
- Auto-extraction of title, category, budget, steps
- Smart field mapping with user editing
- `/api/ai/generate-task-json` endpoint

**Task Messaging System**
- Direct messaging between task participants
- File attachments (up to 5 per message)
- Message history with pagination
- Preserved after task completion
- `/api/messages/*` endpoints

**Task Completion OTP Verification**
- Two-step completion verification
- Helper marks complete → OTP to helpseeker
- Helpseeker shares OTP → Task finalized
- 30-minute OTP validity
- Prevents premature task completion

### 📚 Documentation
- Complete API documentation for all features
- Scheduled task publishing guide with examples
- AI task generation guide
- Task messaging guide with examples
- OTP completion flow diagrams
- Updated environment variables
- Comprehensive route documentation

---

**Built with Node.js, Express, PostgreSQL, Razorpay, Google Gemini AI, and node-cron**