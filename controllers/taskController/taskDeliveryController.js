const {
  acknowledgeTaskDelivery,
  getDeliveryStatus,
  getPendingDeliveries,
} = require("../../services/taskDeliveryService");

/**
 * Acknowledge receipt of task notification by helper
 * POST /api/tasks/:taskId/acknowledge
 */
const acknowledgeTaskReceipt = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helperId = req.user?.id;
    const { receivedVia, timestamp, deviceInfo } = req.body;

    if (!helperId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    console.log(`📨 [ACK] Acknowledgment received for task ${taskId} from helper ${helperId}`);

    const metadata = {
      receivedVia: receivedVia || "unknown", // 'socket', 'push', 'both'
      acknowledgedAt: timestamp || new Date().toISOString(),
      deviceInfo: deviceInfo || null,
    };

    const result = await acknowledgeTaskDelivery(taskId, helperId, metadata);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          taskId,
          helperId,
          acknowledgedAt: result.acknowledgedAt,
          attemptCount: result.attemptCount,
          alreadyAcknowledged: result.alreadyAcknowledged || false,
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("❌ [ACK] Error acknowledging task receipt:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to acknowledge task receipt",
      error: error.message,
    });
  }
};

/**
 * Get delivery status for a specific task-helper pair
 * GET /api/tasks/:taskId/delivery-status
 */
const getTaskDeliveryStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helperId = req.user?.id;

    if (!helperId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const status = await getDeliveryStatus(taskId, helperId);

    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("❌ Error getting delivery status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get delivery status",
      error: error.message,
    });
  }
};

/**
 * Get all pending deliveries (Admin only)
 * GET /api/admin/tasks/pending-deliveries
 */
const getAllPendingDeliveries = async (req, res) => {
  try {
    const pendingDeliveries = await getPendingDeliveries();

    return res.status(200).json({
      success: true,
      data: {
        count: pendingDeliveries.length,
        deliveries: pendingDeliveries,
      },
    });
  } catch (error) {
    console.error("❌ Error getting pending deliveries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get pending deliveries",
      error: error.message,
    });
  }
};

module.exports = {
  acknowledgeTaskReceipt,
  getTaskDeliveryStatus,
  getAllPendingDeliveries,
};
