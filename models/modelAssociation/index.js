const Helper = require("../authModel/helperModel");
const Helpseeker = require("../authModel/helpseekerModel");
const Admin = require("../authModel/adminModel");
const Address = require("../addressModel/addressModel");
const Task = require("../taskModel/taskModel");
const Bid = require("../bidModel/bidModel");
const Payment = require("../paymentModel/paymentModel");
const Rating = require("../ratingModel/ratingModel");
const TaskQueue = require("../queueModel/queueModel");
const Notification = require("../notificationModel/notificationModel");
const TaskTracking = require("../trackingModel/trackingModel");
const Message = require("../messageModel/messageModel");
const TaskMessage = require("../messageModel/taskMessageModel");
const SupportTicket = require("../supportModel/supportTicketModel");
const TicketReply = require("../supportModel/ticketReplyModel");
const DeviceToken = require("../deviceTokenModel/deviceToken");
const BlockedUser = require("../blockedUserModel/blockedUserModel");
const TaskRejection = require("../taskRejectionModel/taskRejectionModel");

Helper.hasMany(Address, {
  foreignKey: "helperId",
  as: "addresses",
  constraints: false,
});

Address.belongsTo(Helper, {
  foreignKey: "helperId",
  as: "helper",
  constraints: false,
});

// Helper -> Task as Assigned Helper (One-to-Many)
Helper.hasMany(Task, {
  foreignKey: "assignedHelperId",
  as: "assignedTasks",
});

Task.belongsTo(Helper, {
  foreignKey: "assignedHelperId",
  as: "assignedHelper",
});

// Helper -> Task as Pending Helper (One-to-Many)
Helper.hasMany(Task, {
  foreignKey: "pendingHelperId",
  as: "pendingTasks",
});

Task.belongsTo(Helper, {
  foreignKey: "pendingHelperId",
  as: "pendingHelper",
});

// Helper -> Bid (One-to-Many)
Helper.hasMany(Bid, {
  foreignKey: "helperId",
  as: "bids",
});

Bid.belongsTo(Helper, {
  foreignKey: "helperId",
  as: "helper",
});

// Helper -> Payment as Receiver (One-to-Many)
Helper.hasMany(Payment, {
  foreignKey: "receiverId",
  as: "receivedPayments",
});

Payment.belongsTo(Helper, {
  foreignKey: "receiverId",
  as: "receiver",
});

// Helper -> TaskTracking (One-to-Many)
Helper.hasMany(TaskTracking, {
  foreignKey: "helperId",
  as: "trackingData",
});

TaskTracking.belongsTo(Helper, {
  foreignKey: "helperId",
  as: "helper",
});

// Helper -> Notification (One-to-Many, Polymorphic)
Helper.hasMany(Notification, {
  foreignKey: "helperId",
  as: "notifications",
  constraints: false,
});

Notification.belongsTo(Helper, {
  foreignKey: "helperId",
  as: "helper",
  constraints: false,
});

// Helper -> Admin (Many-to-One for approval)
Helper.belongsTo(Admin, {
  foreignKey: "approvedBy",
  as: "approver",
});

Admin.hasMany(Helper, {
  foreignKey: "approvedBy",
  as: "approvedHelpers",
});


// Helpseeker -> Address (One-to-Many, Polymorphic)
Helpseeker.hasMany(Address, {
  foreignKey: "helpseekerId",
  as: "addresses",
  constraints: false,
});

Address.belongsTo(Helpseeker, {
  foreignKey: "helpseekerId",
  as: "helpseeker",
  constraints: false,
});

// Helpseeker -> Task as Creator (One-to-Many)
Helpseeker.hasMany(Task, {
  foreignKey: "helpseekerId",
  as: "createdTasks",
});

Task.belongsTo(Helpseeker, {
  foreignKey: "helpseekerId",
  as: "creator",
});

// Helpseeker -> Payment as Payer (One-to-Many)
Helpseeker.hasMany(Payment, {
  foreignKey: "payerId",
  as: "sentPayments",
});

Payment.belongsTo(Helpseeker, {
  foreignKey: "payerId",
  as: "payer",
});

// Helpseeker -> Notification (One-to-Many, Polymorphic)
Helpseeker.hasMany(Notification, {
  foreignKey: "helpseekerId",
  as: "notifications",
  constraints: false,
});

Notification.belongsTo(Helpseeker, {
  foreignKey: "helpseekerId",
  as: "helpseeker",
  constraints: false,
});


// Admin -> SupportTicket (One-to-Many)
Admin.hasMany(SupportTicket, {
  foreignKey: "assignedAdminId",
  as: "assignedTickets",
});

SupportTicket.belongsTo(Admin, {
  foreignKey: "assignedAdminId",
  as: "assignedAdmin",
});


// Task -> Bid (One-to-Many)
Task.hasMany(Bid, {
  foreignKey: "taskId",
  as: "bids",
});

Bid.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> Payment (One-to-Many)
Task.hasMany(Payment, {
  foreignKey: "taskId",
  as: "payments",
});

Payment.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> Rating (One-to-Many)
Task.hasMany(Rating, {
  foreignKey: "taskId",
  as: "ratings",
});

Rating.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> TaskQueue (One-to-One)
Task.hasOne(TaskQueue, {
  foreignKey: "taskId",
  as: "queueStatus",
});

TaskQueue.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> Notification (One-to-Many)
Task.hasMany(Notification, {
  foreignKey: "taskId",
  as: "notifications",
});

Notification.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> TaskTracking (One-to-Many)
Task.hasMany(TaskTracking, {
  foreignKey: "taskId",
  as: "trackingHistory",
});

TaskTracking.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> Message (One-to-Many)
Task.hasMany(Message, {
  foreignKey: "taskId",
  as: "messages",
});

Message.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Task -> TaskMessage (One-to-Many)
Task.hasMany(TaskMessage, {
  foreignKey: "taskId",
  as: "taskMessages",
});

TaskMessage.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// TaskMessage -> Helper (Polymorphic sender)
TaskMessage.belongsTo(Helper, {
  foreignKey: "senderId",
  as: "senderHelper",
  constraints: false,
});

Helper.hasMany(TaskMessage, {
  foreignKey: "senderId",
  as: "sentMessages",
  constraints: false,
});

// TaskMessage -> Helpseeker (Polymorphic sender)
TaskMessage.belongsTo(Helpseeker, {
  foreignKey: "senderId",
  as: "senderHelpseeker",
  constraints: false,
});

Helpseeker.hasMany(TaskMessage, {
  foreignKey: "senderId",
  as: "sentMessages",
  constraints: false,
});

// Rating -> Helper as Reviewer (Polymorphic)
Rating.belongsTo(Helper, {
  foreignKey: "reviewerId",
  as: "reviewerHelper",
  constraints: false,
});

Helper.hasMany(Rating, {
  foreignKey: "reviewerId",
  as: "givenRatings",
  constraints: false,
});

// Rating -> Helpseeker as Reviewer (Polymorphic)
Rating.belongsTo(Helpseeker, {
  foreignKey: "reviewerId",
  as: "reviewerHelpseeker",
  constraints: false,
});

Helpseeker.hasMany(Rating, {
  foreignKey: "reviewerId",
  as: "givenRatings",
  constraints: false,
});

// Rating -> Helper as Reviewee (Polymorphic)
Rating.belongsTo(Helper, {
  foreignKey: "revieweeId",
  as: "revieweeHelper",
  constraints: false,
});

Helper.hasMany(Rating, {
  foreignKey: "revieweeId",
  as: "receivedRatings",
  constraints: false,
});

// Rating -> Helpseeker as Reviewee (Polymorphic)
Rating.belongsTo(Helpseeker, {
  foreignKey: "revieweeId",
  as: "revieweeHelpseeker",
  constraints: false,
});

Helpseeker.hasMany(Rating, {
  foreignKey: "revieweeId",
  as: "receivedRatings",
  constraints: false,
});


// Bid -> Bid (Self-referencing for Counter Offers)
Bid.hasMany(Bid, {
  foreignKey: "originalBidId",
  as: "counterOffers",
});

Bid.belongsTo(Bid, {
  foreignKey: "originalBidId",
  as: "originalBid",
});


// SupportTicket -> TicketReply (One-to-Many)
SupportTicket.hasMany(TicketReply, {
  foreignKey: "ticketId",
  as: "replies",
});

TicketReply.belongsTo(SupportTicket, {
  foreignKey: "ticketId",
  as: "ticket",
});


// DeviceToken -> Helper (Many-to-One, Polymorphic)
DeviceToken.belongsTo(Helper, {
  foreignKey: "helperId",
  as: "helper",
  constraints: false,
});

Helper.hasMany(DeviceToken, {
  foreignKey: "helperId",
  as: "deviceTokens",
  constraints: false,
});

// DeviceToken -> Helpseeker (Many-to-One, Polymorphic)
DeviceToken.belongsTo(Helpseeker, {
  foreignKey: "helpseekerId",
  as: "helpseeker",
  constraints: false,
});

Helpseeker.hasMany(DeviceToken, {
  foreignKey: "helpseekerId",
  as: "deviceTokens",
  constraints: false,
});

// BlockedUser associations
// Admin who blocked the user
Admin.hasMany(BlockedUser, {
  foreignKey: "blockedBy",
  as: "blockedUsers",
  constraints: false,
});

BlockedUser.belongsTo(Admin, {
  foreignKey: "blockedBy",
  as: "blocker",
  constraints: false,
});

// Admin who unblocked the user
Admin.hasMany(BlockedUser, {
  foreignKey: "unblockedBy",
  as: "unblockedUsers",
  constraints: false,
});

BlockedUser.belongsTo(Admin, {
  foreignKey: "unblockedBy",
  as: "unblocker",
  constraints: false,
});

// TaskRejection associations
// Task -> TaskRejection (One-to-Many)
Task.hasMany(TaskRejection, {
  foreignKey: "taskId",
  as: "rejections",
});

TaskRejection.belongsTo(Task, {
  foreignKey: "taskId",
  as: "task",
});

// Helper -> TaskRejection (One-to-Many)
Helper.hasMany(TaskRejection, {
  foreignKey: "helperId",
  as: "rejectedTasks",
});

TaskRejection.belongsTo(Helper, {
  foreignKey: "helperId",
  as: "helper",
});


module.exports = {
  Helper,
  Helpseeker,
  Admin,
  Address,
  Task,
  Bid,
  Payment,
  Rating,
  TaskQueue,
  Notification,
  TaskTracking,
  Message,
  TaskMessage,
  SupportTicket,
  TicketReply,
  DeviceToken,
  BlockedUser,
  TaskRejection,
};
