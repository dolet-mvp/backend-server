const Rating = require("../../models/ratingModel/ratingModel");
const Task = require("../../models/taskModel/taskModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Notification = require("../../models/notificationModel/notificationModel");
const { createNotification } = require("../../services/notificationService");

// Submit rating and review after task completion
const submitRating = async (req, res) => {
  try {
    const reviewerId = req.user.id;
    const { taskId } = req.params;
    const { rating, review } = req.body;

    // Validate rating value
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    const task = await Task.findByPk(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Can only rate completed tasks",
      });
    }

    // Determine reviewer type and reviewee
    let revieweeId;
    let reviewerType;
    let revieweeType;
    let ratingType;

    if (task.helpseekerId === reviewerId) {
      // Helpseeker rating helper
      revieweeId = task.assignedHelperId;
      reviewerType = "helpseeker";
      revieweeType = "helper";
      ratingType = "user_to_helper";
    } else if (task.assignedHelperId === reviewerId) {
      // Helper rating helpseeker
      revieweeId = task.helpseekerId;
      reviewerType = "helper";
      revieweeType = "helpseeker";
      ratingType = "helper_to_user";
    } else {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to rate this task",
      });
    }

    // Check if already rated
    const existingRating = await Rating.findOne({
      where: { taskId, reviewerId },
    });

    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: "You have already rated this task",
      });
    }

    const newRating = await Rating.create({
      taskId,
      reviewerId,
      revieweeId,
      reviewerType,
      revieweeType,
      rating,
      review,
      type: ratingType,
      isVisible: true,
    });

    // Update helper's average rating if rating a helper
    if (ratingType === "user_to_helper") {
      const helper = await Helper.findByPk(revieweeId);

      if (helper) {
        // Calculate new average
        const allRatings = await Rating.findAll({
          where: { revieweeId, revieweeType: "helper", type: "user_to_helper" },
        });

        const totalRating = allRatings.reduce(
          (sum, r) => sum + parseFloat(r.rating),
          0
        );
        const avgRating = totalRating / allRatings.length;

        helper.averageRating = avgRating.toFixed(1);
        await helper.save();
      }
    }

    // Notify reviewee
    await createNotification({
      userId: revieweeId,
      userType: revieweeType,
      taskId: task.id,
      title: "New Rating Received",
      message: `You received a ${rating}-star rating for "${task.title}"`,
      type: "rating_received",
      priority: "medium",
    });

    res.status(201).json({
      success: true,
      message: "Rating submitted successfully",
      data: newRating,
    });
  } catch (error) {
    console.error("Submit rating error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit rating",
      error: error.message,
    });
  }
};

// Get ratings for a specific user (helper or helpseeker)
const getUserRatings = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, userType } = req.query;

    const whereClause = { revieweeId: userId, isVisible: true };

    if (type) {
      whereClause.type = type;
    }
    
    if (userType) {
      whereClause.revieweeType = userType;
    }

    const ratings = await Rating.findAll({
      where: whereClause,
      include: [
        {
          model: Helper,
          as: "reviewerHelper",
          attributes: ["id", "fullName", "profilePhoto"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "reviewerHelpseeker",
          attributes: ["id", "fullName", "profilePhoto"],
          required: false,
        },
        {
          model: Task,
          as: "task",
          attributes: ["id", "title", "category"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Calculate statistics
    const totalRatings = ratings.length;
    const averageRating =
      totalRatings > 0
        ? (
            ratings.reduce((sum, r) => sum + parseFloat(r.rating), 0) /
            totalRatings
          ).toFixed(1)
        : 0;

    const ratingDistribution = {
      5: ratings.filter((r) => r.rating >= 4.5).length,
      4: ratings.filter((r) => r.rating >= 3.5 && r.rating < 4.5).length,
      3: ratings.filter((r) => r.rating >= 2.5 && r.rating < 3.5).length,
      2: ratings.filter((r) => r.rating >= 1.5 && r.rating < 2.5).length,
      1: ratings.filter((r) => r.rating < 1.5).length,
    };

    res.status(200).json({
      success: true,
      data: {
        ratings,
        statistics: {
          totalRatings,
          averageRating,
          ratingDistribution,
        },
      },
    });
  } catch (error) {
    console.error("Get user ratings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ratings",
      error: error.message,
    });
  }
};

// Get rating for a specific task
const getTaskRating = async (req, res) => {
  try {
    const { taskId } = req.params;

    const ratings = await Rating.findAll({
      where: { taskId },
      include: [
        {
          model: Helper,
          as: "reviewerHelper",
          attributes: ["id", "fullName", "profilePhoto"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "reviewerHelpseeker",
          attributes: ["id", "fullName", "profilePhoto"],
          required: false,
        },
        {
          model: Helper,
          as: "revieweeHelper",
          attributes: ["id", "fullName", "profilePhoto"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "revieweeHelpseeker",
          attributes: ["id", "fullName", "profilePhoto"],
          required: false,
        },
      ],
    });

    res.status(200).json({
      success: true,
      data: ratings,
    });
  } catch (error) {
    console.error("Get task rating error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch task rating",
      error: error.message,
    });
  }
};

// Get my ratings (given and received)
const getMyRatings = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;
    const { type } = req.query; // 'given' or 'received'

    let ratingsGiven = [];
    let ratingsReceived = [];

    if (!type || type === "given") {
      ratingsGiven = await Rating.findAll({
        where: { reviewerId: userId, reviewerType: userType },
        include: [
          {
            model: Helper,
            as: "revieweeHelper",
            attributes: ["id", "fullName", "profilePhoto"],
            required: false,
          },
          {
            model: Helpseeker,
            as: "revieweeHelpseeker",
            attributes: ["id", "fullName", "profilePhoto"],
            required: false,
          },
          {
            model: Task,
            as: "task",
            attributes: ["id", "title", "category"],
          },
        ],
        order: [["createdAt", "DESC"]],
      });
    }

    if (!type || type === "received") {
      ratingsReceived = await Rating.findAll({
        where: { revieweeId: userId, revieweeType: userType, isVisible: true },
        include: [
          {
            model: Helper,
            as: "reviewerHelper",
            attributes: ["id", "fullName", "profilePhoto"],
            required: false,
          },
          {
            model: Helpseeker,
            as: "reviewerHelpseeker",
            attributes: ["id", "fullName", "profilePhoto"],
            required: false,
          },
          {
            model: Task,
            as: "task",
            attributes: ["id", "title", "category"],
          },
        ],
        order: [["createdAt", "DESC"]],
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ratingsGiven,
        ratingsReceived,
      },
    });
  } catch (error) {
    console.error("Get my ratings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ratings",
      error: error.message,
    });
  }
};

// Update rating visibility
const toggleRatingVisibility = async (req, res) => {
  try {
    const { ratingId } = req.params;
    const userId = req.user.id;

    const rating = await Rating.findByPk(ratingId);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: "Rating not found",
      });
    }

    // Only reviewee can toggle visibility
    if (rating.revieweeId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to modify this rating",
      });
    }

    rating.isVisible = !rating.isVisible;
    await rating.save();

    res.status(200).json({
      success: true,
      message: `Rating ${rating.isVisible ? "shown" : "hidden"} successfully`,
      data: rating,
    });
  } catch (error) {
    console.error("Toggle rating visibility error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update rating visibility",
      error: error.message,
    });
  }
};

module.exports = {
  submitRating,
  getUserRatings,
  getTaskRating,
  getMyRatings,
  toggleRatingVisibility,
};
