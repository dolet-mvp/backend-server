const express = require("express");
const router = express.Router();
const {
  sendTaskMessage,
  getTaskMessages,
  deleteTaskMessage,
  getMyTasksWithMessages,
} = require("../../controllers/messageController/taskMessageController");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");


// Get all tasks with message counts
router.get("/my-tasks", getMyTasksWithMessages);

router.post(
  "/task/:taskId",
  supabaseUpload.array("attachments", 5),
  sendTaskMessage
);

router.get("/task/:taskId", getTaskMessages);
router.delete("/message/:messageId", deleteTaskMessage);

module.exports = router;
