const Task = require("../../models/taskModel/taskModel");
const User = require("../../models/authModel/userModel");
const Address = require("../../models/addressModel/addressModel");
const { Sequelize } = require("sequelize");

// Get single task details (Common for both Helper and Helpseeker)
const getTaskById = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findByPk(taskId, {
      include: [
        {
          model: User,
          as: "creator",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
        {
          model: User,
          as: "assignedHelper",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    res.status(200).json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error("Get task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch task",
      error: error.message,
    });
  }
};

const getMostPopularJobsInArea = async (req, res) => {
  try {
    const userId = req.user.id;
    const radius = 50; 

    const userAddress = await Address.findOne({
      where: {
        userId,
        isDefault: true,
      },
    });

    if (!userAddress) {
      return res.status(404).json({
        success: false,
        message: "Please add your default address to see popular jobs in your area",
      });
    }

    const { latitude, longitude, city, state } = userAddress;

    // If no lat/long, fall back to city/state matching
    let locationFilter = {};
    let searchMethod = "";

    if (latitude && longitude) {
      // Use radius-based search with Haversine formula
      // Formula: distance = 6371 * acos(cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1)) + sin(radians(lat1)) * sin(radians(lat2)))
      searchMethod = "radius";
      
      const tasksInRadius = await Task.findAll({
        attributes: [
          "id",
          "category",
          "budget",
          "location",
          [
            Sequelize.literal(`
              6371 * acos(
                cos(radians(${latitude})) * 
                cos(radians(CAST(location->>'lat' AS DECIMAL))) * 
                cos(radians(CAST(location->>'lng' AS DECIMAL)) - radians(${longitude})) + 
                sin(radians(${latitude})) * 
                sin(radians(CAST(location->>'lat' AS DECIMAL)))
              )
            `),
            "distance",
          ],
        ],
        where: {
          status: ["completed", "in_progress", "assigned"],
          locationRequired: true,
          location: {
            [Sequelize.Op.ne]: null,
          },
          [Sequelize.Op.and]: Sequelize.literal(`
            6371 * acos(
              cos(radians(${latitude})) * 
              cos(radians(CAST(location->>'lat' AS DECIMAL))) * 
              cos(radians(CAST(location->>'lng' AS DECIMAL)) - radians(${longitude})) + 
              sin(radians(${latitude})) * 
              sin(radians(CAST(location->>'lat' AS DECIMAL)))
            ) <= ${radius}
          `),
        },
        raw: true,
      });

      // Group by category and calculate stats
      const categoryStats = tasksInRadius.reduce((acc, task) => {
        if (!acc[task.category]) {
          acc[task.category] = {
            category: task.category,
            tasks: [],
            count: 0,
          };
        }
        acc[task.category].tasks.push(parseFloat(task.budget));
        acc[task.category].count++;
        return acc;
      }, {});

      // Calculate statistics for each category
      const popularJobs = Object.values(categoryStats)
        .map((cat) => ({
          category: cat.category,
          taskCount: cat.count,
          averageBudget: (
            cat.tasks.reduce((a, b) => a + b, 0) / cat.tasks.length
          ).toFixed(2),
          minBudget: Math.min(...cat.tasks).toFixed(2),
          maxBudget: Math.max(...cat.tasks).toFixed(2),
        }))
        .sort((a, b) => b.taskCount - a.taskCount)
        .slice(0, 10);

      // Get active tasks count for top 5 categories
      const categoriesWithDetails = await Promise.all(
        popularJobs.slice(0, 5).map(async (job) => {
          const activeTasksInRadius = await Task.findAll({
            attributes: [
              [
                Sequelize.literal(`
                  6371 * acos(
                    cos(radians(${latitude})) * 
                    cos(radians(CAST(location->>'lat' AS DECIMAL))) * 
                    cos(radians(CAST(location->>'lng' AS DECIMAL)) - radians(${longitude})) + 
                    sin(radians(${latitude})) * 
                    sin(radians(CAST(location->>'lat' AS DECIMAL)))
                  )
                `),
                "distance",
              ],
            ],
            where: {
              category: job.category,
              status: "published",
              locationRequired: true,
              location: {
                [Sequelize.Op.ne]: null,
              },
              [Sequelize.Op.and]: Sequelize.literal(`
                6371 * acos(
                  cos(radians(${latitude})) * 
                  cos(radians(CAST(location->>'lat' AS DECIMAL))) * 
                  cos(radians(CAST(location->>'lng' AS DECIMAL)) - radians(${longitude})) + 
                  sin(radians(${latitude})) * 
                  sin(radians(CAST(location->>'lat' AS DECIMAL)))
                ) <= ${radius}
              `),
            },
            raw: true,
          });

          return {
            category: job.category,
            totalCompleted: parseInt(job.taskCount),
            averageBudget: parseFloat(job.averageBudget),
            budgetRange: {
              min: parseFloat(job.minBudget),
              max: parseFloat(job.maxBudget),
            },
            activeTasksInCategory: activeTasksInRadius.length,
          };
        })
      );

      const totalTasksInArea = tasksInRadius.length;

      return res.status(200).json({
        success: true,
        message: "Most popular jobs in your area retrieved successfully",
        data: {
          location: {
            address: `${city}, ${state}`,
            coordinates: { latitude, longitude },
            radius: `${radius} km`,
            searchMethod: "GPS Radius",
          },
          totalTasksInArea,
          popularJobs: categoriesWithDetails,
          allCategories: popularJobs.map((job) => ({
            category: job.category,
            count: parseInt(job.taskCount),
          })),
        },
      });
    } else if (city || state) {
      // Fallback to city/state matching if no coordinates
      searchMethod = "city-state";
      
      if (city && state) {
        locationFilter[Sequelize.Op.and] = [
          Sequelize.where(
            Sequelize.fn("lower", Sequelize.cast(Sequelize.col("location"), "jsonb->>'city'")),
            Sequelize.fn("lower", city)
          ),
          Sequelize.where(
            Sequelize.fn("lower", Sequelize.cast(Sequelize.col("location"), "jsonb->>'state'")),
            Sequelize.fn("lower", state)
          ),
        ];
      } else if (city) {
        locationFilter[Sequelize.Op.and] = [
          Sequelize.where(
            Sequelize.fn("lower", Sequelize.cast(Sequelize.col("location"), "jsonb->>'city'")),
            Sequelize.fn("lower", city)
          ),
        ];
      } else if (state) {
        locationFilter[Sequelize.Op.and] = [
          Sequelize.where(
            Sequelize.fn("lower", Sequelize.cast(Sequelize.col("location"), "jsonb->>'state'")),
            Sequelize.fn("lower", state)
          ),
        ];
      }

      const popularJobs = await Task.findAll({
        attributes: [
          "category",
          [Sequelize.fn("COUNT", Sequelize.col("category")), "taskCount"],
          [Sequelize.fn("AVG", Sequelize.col("budget")), "averageBudget"],
          [Sequelize.fn("MIN", Sequelize.col("budget")), "minBudget"],
          [Sequelize.fn("MAX", Sequelize.col("budget")), "maxBudget"],
        ],
        where: {
          ...locationFilter,
          status: ["completed", "in_progress", "assigned"],
          locationRequired: true,
        },
        group: ["category"],
        order: [[Sequelize.literal("taskCount"), "DESC"]],
        limit: 10,
        raw: true,
      });

      const categoriesWithDetails = await Promise.all(
        popularJobs.slice(0, 5).map(async (job) => {
          const recentTasks = await Task.count({
            where: {
              ...locationFilter,
              category: job.category,
              status: "published",
            },
          });

          return {
            category: job.category,
            totalCompleted: parseInt(job.taskCount),
            averageBudget: parseFloat(job.averageBudget).toFixed(2),
            budgetRange: {
              min: parseFloat(job.minBudget).toFixed(2),
              max: parseFloat(job.maxBudget).toFixed(2),
            },
            activeTasksInCategory: recentTasks,
          };
        })
      );

      const areaStats = await Task.count({
        where: {
          ...locationFilter,
          status: ["completed", "in_progress", "assigned"],
        },
      });

      return res.status(200).json({
        success: true,
        message: "Most popular jobs in your area retrieved successfully",
        data: {
          location: {
            address: `${city}, ${state}`,
            coordinates: null,
            radius: `${radius} km (city/state based)`,
            searchMethod: "City/State Match",
          },
          totalTasksInArea: areaStats,
          popularJobs: categoriesWithDetails,
          allCategories: popularJobs.map((job) => ({
            category: job.category,
            count: parseInt(job.taskCount),
          })),
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Your address doesn't have enough location information. Please update your address with city/state or coordinates.",
      });
    }
  } catch (error) {
    console.error("Get popular jobs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch popular jobs in your area",
      error: error.message,
    });
  }
};

module.exports = {
  getTaskById,
  getMostPopularJobsInArea,
};
