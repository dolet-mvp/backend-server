
const express = require('express');
const router = express.Router();
const {
  getEndpointStats,
  getCriticalRequests,
  getPerformanceSummary,
  clearPerformanceData
} = require('../../middleware/performanceMonitor');
const { getCacheStats } = require('../../services/distanceCacheService');

/**
 * GET /api/performance/stats
 * Get performance summary for all endpoints
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getPerformanceSummary();
    
    res.status(200).json({
      success: true,
      data: {
        totalEndpoints: stats.length,
        endpoints: stats,
        slowestEndpoints: stats.slice(0, 10), // Top 10 slowest
      }
    });
  } catch (error) {
    console.error('Error fetching performance stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance statistics',
      error: error.message
    });
  }
});


router.get('/endpoint-stats', async (req, res) => {
  try {
    const endpoint = req.query.path;
    
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Please provide endpoint path in query parameter: ?path=/api/tasks/available'
      });
    }
    
    const stats = await getEndpointStats(endpoint);
    
    if (!stats) {
      return res.status(404).json({
        success: false,
        message: 'No statistics found for this endpoint'
      });
    }
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching endpoint stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch endpoint statistics',
      error: error.message
    });
  }
});

/**
 * GET /api/performance/critical
 * Get critical slow requests (>5 seconds)
 */
router.get('/critical', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const criticalRequests = await getCriticalRequests(limit);
    
    res.status(200).json({
      success: true,
      data: {
        count: criticalRequests.length,
        requests: criticalRequests
      }
    });
  } catch (error) {
    console.error('Error fetching critical requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch critical requests',
      error: error.message
    });
  }
});

router.get('/cache', async (req, res) => {
  try {
    const cacheStats = await getCacheStats();
    
    res.status(200).json({
      success: true,
      data: cacheStats
    });
  } catch (error) {
    console.error('Error fetching cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cache statistics',
      error: error.message
    });
  }
});


router.delete('/clear', async (req, res) => {
  try {
    const deletedCount = await clearPerformanceData();
    
    res.status(200).json({
      success: true,
      message: 'Performance data cleared successfully',
      data: {
        deletedRecords: deletedCount
      }
    });
  } catch (error) {
    console.error('Error clearing performance data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear performance data',
      error: error.message
    });
  }
});


router.get('/health', async (req, res) => {
  try {
    const summary = await getPerformanceSummary();
    const criticalRequests = await getCriticalRequests(5);
    const cacheStats = await getCacheStats();
    
    // Calculate overall health score
    const avgResponseTime = summary.length > 0
      ? Math.round(summary.reduce((sum, s) => sum + s.avgDuration, 0) / summary.length)
      : 0;
    
    const healthScore = avgResponseTime < 500 ? 'EXCELLENT' :
                       avgResponseTime < 1000 ? 'GOOD' :
                       avgResponseTime < 2000 ? 'FAIR' : 'POOR';
    
    res.status(200).json({
      success: true,
      data: {
        healthScore,
        avgResponseTime: `${avgResponseTime}ms`,
        totalEndpoints: summary.length,
        criticalRequestsCount: criticalRequests.length,
        cacheStats,
        slowestEndpoints: summary.slice(0, 5).map(s => ({
          endpoint: s.endpoint,
          avgDuration: `${s.avgDuration}ms`,
          count: s.count
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching health stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch health statistics',
      error: error.message
    });
  }
});

module.exports = router;
