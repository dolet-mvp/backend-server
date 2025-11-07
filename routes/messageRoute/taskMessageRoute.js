const express = require("express");
const router = express.Router();
const {
  sendTaskMessage,
  getTaskMessages,
  deleteTaskMessage,
  getMyTasksWithMessages,
} = require("../../controllers/messageController/taskMessageController");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Get all tasks with message counts
router.get(
  "/my-tasks",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMyTasksWithMessages
);

// Send message to a task
router.post(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  supabaseUpload.array("attachments", 5),
  sendTaskMessage
);

// Get messages for a task
router.get(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getTaskMessages
);

// Delete a message
router.delete(
  "/message/:messageId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  deleteTaskMessage
);

module.exports = router;
