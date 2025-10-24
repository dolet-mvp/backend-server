const User = require("../../models/authModel/userModel");
const HelperProfile = require("../../models/helperModel/helperModel");
const { Op } = require("sequelize");

/**
 * Haversine formula to calculate distance between two points
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of Earth in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
};

/**
 * Find all online helpers within 10km radius of helpseeker's location
 * Returns helpers with their coordinates for map display
 */
const getNearbyOnlineHelpers = async (req, res) => {
  try {
    const { latitude, longitude, radius = 10 } = req.body;

    // Validate required fields
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);
    const searchRadius = parseFloat(radius);

    // Validate coordinates
    if (
      isNaN(userLat) ||
      isNaN(userLon) ||
      userLat < -90 ||
      userLat > 90 ||
      userLon < -180 ||
      userLon > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid latitude or longitude values",
      });
    }

    // Get all online helpers with their profiles
    const onlineHelpers = await User.findAll({
      where: {
        role: "helper",
        isVerified: true,
        isOnline: true, // Assuming you have an isOnline field
        currentLatitude: { [Op.ne]: null },
        currentLongitude: { [Op.ne]: null },
      },
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "phone",
        "profilePicture",
        "currentLatitude",
        "currentLongitude",
        "lastActiveAt",
      ],
      include: [
        {
          model: HelperProfile,
          as: "helperProfile",
          attributes: [
            "skills",
            "experience",
            "hourlyRate",
            "serviceRadius",
            "availabilityStatus",
            "rating",
            "completedTasks",
          ],
        },
      ],
    });

    // Filter helpers within the specified radius
    const nearbyHelpers = onlineHelpers
      .map((helper) => {
        const helperLat = parseFloat(helper.currentLatitude);
        const helperLon = parseFloat(helper.currentLongitude);

        const distance = calculateDistance(
          userLat,
          userLon,
          helperLat,
          helperLon
        );

        if (distance <= searchRadius) {
          return {
            id: helper.id,
            firstName: helper.firstName,
            lastName: helper.lastName,
            fullName: `${helper.firstName} ${helper.lastName}`,
            email: helper.email,
            phone: helper.phone,
            profilePicture: helper.profilePicture,
            location: {
              latitude: helperLat,
              longitude: helperLon,
            },
            distance: parseFloat(distance.toFixed(2)), // Distance in km
            lastActiveAt: helper.lastActiveAt,
            helperProfile: helper.helperProfile
              ? {
                  skills: helper.helperProfile.skills,
                  experience: helper.helperProfile.experience,
                  hourlyRate: helper.helperProfile.hourlyRate,
                  serviceRadius: helper.helperProfile.serviceRadius,
                  availabilityStatus: helper.helperProfile.availabilityStatus,
                  rating: helper.helperProfile.rating,
                  completedTasks: helper.helperProfile.completedTasks,
                }
              : null,
          };
        }
        return null;
      })
      .filter((helper) => helper !== null)
      .sort((a, b) => a.distance - b.distance); // Sort by distance (nearest first)

    return res.status(200).json({
      success: true,
      message: `Found ${nearbyHelpers.length} online helper(s) within ${searchRadius}km`,
      data: {
        userLocation: {
          latitude: userLat,
          longitude: userLon,
        },
        searchRadius: searchRadius,
        totalHelpers: nearbyHelpers.length,
        helpers: nearbyHelpers,
      },
    });
  } catch (error) {
    console.error("Get nearby online helpers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch nearby helpers",
      error: error.message,
    });
  }
};

/**
 * Update helper's online status and current location
 * Helpers should call this when they go online/offline or move
 */
const updateHelperLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude, isOnline } = req.body;

    if (req.user.role !== "helper") {
      return res.status(403).json({
        success: false,
        message: "Only helpers can update their location",
      });
    }

    const helper = await User.findByPk(userId);

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Update location and online status
    if (latitude !== undefined && longitude !== undefined) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);

      // Validate coordinates
      if (
        isNaN(lat) ||
        isNaN(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid latitude or longitude values",
        });
      }

      helper.currentLatitude = lat;
      helper.currentLongitude = lon;
    }

    if (isOnline !== undefined) {
      helper.isOnline = isOnline;
    }

    helper.lastActiveAt = new Date();
    await helper.save();

    return res.status(200).json({
      success: true,
      message: "Location and status updated successfully",
      data: {
        id: helper.id,
        location: {
          latitude: helper.currentLatitude,
          longitude: helper.currentLongitude,
        },
        isOnline: helper.isOnline,
        lastActiveAt: helper.lastActiveAt,
      },
    });
  } catch (error) {
    console.error("Update helper location error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update location",
      error: error.message,
    });
  }
};

/**
 * Get helpseeker's current location and find nearby helpers automatically
 * This can be called when helpseeker opens the app
 */
const getMyLocationAndNearbyHelpers = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Please provide your current location (latitude and longitude)",
      });
    }

    // Call the main function to get nearby helpers
    return await getNearbyOnlineHelpers(req, res);
  } catch (error) {
    console.error("Get location and nearby helpers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch nearby helpers",
      error: error.message,
    });
  }
};

module.exports = {
  getNearbyOnlineHelpers,
  updateHelperLocation,
  getMyLocationAndNearbyHelpers,
};
