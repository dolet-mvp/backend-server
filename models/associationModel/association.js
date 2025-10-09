const User = require("../authModel/userModel");
const Address = require("../addressModel/addressModel");
const Task = require("../taskModel/taskModel");
const Bid = require("../bidModel/bidModel");
const Payment = require("../paymentModel/paymentModel");
const Rating = require("../ratingModel/ratingModel");
const TaskQueue = require("../queueModel/queueModel");
const Notification = require("../notificationModel/notificationModel");
const TaskTracking = require("../trackingModel/trackingModel");
const Message = require("../messageModel/messageModel");
const HelperProfile = require("../helperModel/helperModel");

// User - Address Associations
User.hasMany(Address, {
  foreignKey: "userId",
  as: "addresses",
  onDelete: "CASCADE",
});

Address.belongsTo(User, { 
  foreignKey: "userId", 
  as: "user" 
});

// User - Task Associations (as Task Creator)
User.hasMany(Task, {
  foreignKey: "userId",
  as: "createdTasks",
  onDelete: "CASCADE",
});

Task.belongsTo(User, { 
  foreignKey: "userId", 
  as: "creator" 
});

// User - Task Associations (as Assigned Helper)
User.hasMany(Task, {
  foreignKey: "assignedHelperId",
  as: "assignedTasks",
  onDelete: "SET NULL",
});

Task.belongsTo(User, { 
  foreignKey: "assignedHelperId", 
  as: "assignedHelper" 
});

// Task - Bid Associations
Task.hasMany(Bid, {
  foreignKey: "taskId",
  as: "bids",
  onDelete: "CASCADE",
});

Bid.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// User - Bid Associations (as Helper)
User.hasMany(Bid, {
  foreignKey: "helperId",
  as: "bids",
  onDelete: "CASCADE",
});

Bid.belongsTo(User, { 
  foreignKey: "helperId", 
  as: "helper" 
});

// Bid - Bid Associations (Counter Offers)
Bid.hasMany(Bid, {
  foreignKey: "originalBidId",
  as: "counterOffers",
  onDelete: "CASCADE",
});

Bid.belongsTo(Bid, { 
  foreignKey: "originalBidId", 
  as: "originalBid" 
});

// Task - Payment Associations
Task.hasMany(Payment, {
  foreignKey: "taskId",
  as: "payments",
  onDelete: "CASCADE",
});

Payment.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// User - Payment Associations (as Payer)
User.hasMany(Payment, {
  foreignKey: "payerId",
  as: "sentPayments",
  onDelete: "CASCADE",
});

Payment.belongsTo(User, { 
  foreignKey: "payerId", 
  as: "payer" 
});

// User - Payment Associations (as Receiver)
User.hasMany(Payment, {
  foreignKey: "receiverId",
  as: "receivedPayments",
  onDelete: "CASCADE",
});

Payment.belongsTo(User, { 
  foreignKey: "receiverId", 
  as: "receiver" 
});

// Task - Rating Associations
Task.hasMany(Rating, {
  foreignKey: "taskId",
  as: "ratings",
  onDelete: "CASCADE",
});

Rating.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// User - Rating Associations (as Reviewer)
User.hasMany(Rating, {
  foreignKey: "reviewerId",
  as: "givenRatings",
  onDelete: "CASCADE",
});

Rating.belongsTo(User, { 
  foreignKey: "reviewerId", 
  as: "reviewer" 
});

// User - Rating Associations (as Reviewee)
User.hasMany(Rating, {
  foreignKey: "revieweeId",
  as: "receivedRatings",
  onDelete: "CASCADE",
});

Rating.belongsTo(User, { 
  foreignKey: "revieweeId", 
  as: "reviewee" 
});

// Task - TaskQueue Associations
Task.hasOne(TaskQueue, {
  foreignKey: "taskId",
  as: "queueStatus",
  onDelete: "CASCADE",
});

TaskQueue.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// User - Notification Associations
User.hasMany(Notification, {
  foreignKey: "userId",
  as: "notifications",
  onDelete: "CASCADE",
});

Notification.belongsTo(User, { 
  foreignKey: "userId", 
  as: "user" 
});

// Task - Notification Associations
Task.hasMany(Notification, {
  foreignKey: "taskId",
  as: "notifications",
  onDelete: "CASCADE",
});

Notification.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// Task - TaskTracking Associations
Task.hasMany(TaskTracking, {
  foreignKey: "taskId",
  as: "trackingHistory",
  onDelete: "CASCADE",
});

TaskTracking.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// User - TaskTracking Associations (as Helper)
User.hasMany(TaskTracking, {
  foreignKey: "helperId",
  as: "trackingData",
  onDelete: "CASCADE",
});

TaskTracking.belongsTo(User, { 
  foreignKey: "helperId", 
  as: "helper" 
});

// Task - Message Associations
Task.hasMany(Message, {
  foreignKey: "taskId",
  as: "messages",
  onDelete: "CASCADE",
});

Message.belongsTo(Task, { 
  foreignKey: "taskId", 
  as: "task" 
});

// User - Message Associations (as Sender)
User.hasMany(Message, {
  foreignKey: "senderId",
  as: "sentMessages",
  onDelete: "CASCADE",
});

Message.belongsTo(User, { 
  foreignKey: "senderId", 
  as: "sender" 
});

// User - Message Associations (as Receiver)
User.hasMany(Message, {
  foreignKey: "receiverId",
  as: "receivedMessages",
  onDelete: "CASCADE",
});

Message.belongsTo(User, { 
  foreignKey: "receiverId", 
  as: "receiver" 
});

// User - HelperProfile Associations
User.hasOne(HelperProfile, {
  foreignKey: "userId",
  as: "helperProfile",
  onDelete: "CASCADE",
});

HelperProfile.belongsTo(User, { 
  foreignKey: "userId", 
  as: "user" 
});
